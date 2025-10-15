import type { ExchangeAdapter } from "../exchanges/adapter";
import type { AsterOrder, CreateOrderParams } from "../exchanges/types";
import { roundDownToTick, roundQtyDownToStep, formatPriceToString } from "../utils/math";
import { calcStopLossPrice } from "../utils/strategy";
import { isUnknownOrderError } from "../utils/errors";
import { isOrderPriceAllowedByMark } from "../utils/strategy";

export type OrderLockMap = Record<string, boolean>;
export type OrderTimerMap = Record<string, ReturnType<typeof setTimeout> | null>;
export type OrderPendingMap = Record<string, string | null>;
export type LogHandler = (type: string, detail: string) => void;

type OrderGuardOptions = {
  markPrice?: number | null;
  expectedPrice?: number | null;
  maxPct?: number;
};

function enforceMarkPriceGuard(
  side: "BUY" | "SELL",
  toCheckPrice: number | null | undefined,
  guard: OrderGuardOptions | undefined,
  log: LogHandler,
  context: string
): boolean {
  if (!guard || guard.maxPct == null) return true;
  const allowed = isOrderPriceAllowedByMark({
    side,
    orderPrice: toCheckPrice,
    markPrice: guard.markPrice,
    maxPct: guard.maxPct,
  });
  if (!allowed) {
    const priceStr = Number.isFinite(Number(toCheckPrice)) ? Number(toCheckPrice).toFixed(2) : String(toCheckPrice);
    const markStr = Number.isFinite(Number(guard.markPrice)) ? Number(guard.markPrice).toFixed(2) : String(guard.markPrice);
    log(
      "info",
      `${context} 保护触发：side=${side} price=${priceStr} mark=${markStr} 超过 ${(guard.maxPct! * 100).toFixed(2)}%`
    );
    return false;
  }
  return true;
}

export function isOperating(locks: OrderLockMap, type: string): boolean {
  return Boolean(locks[type]);
}

export function lockOperating(
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  type: string,
  log: LogHandler,
  timeout = 3000
): void {
  locks[type] = true;
  if (timers[type]) {
    clearTimeout(timers[type]!);
  }
  timers[type] = setTimeout(() => {
    locks[type] = false;
    pendings[type] = null;
    log("info", `${type} 操作超时自动解锁`);
  }, timeout);
}

export function unlockOperating(
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  type: string
): void {
  locks[type] = false;
  pendings[type] = null;
  if (timers[type]) {
    clearTimeout(timers[type]!);
  }
  timers[type] = null;
}

export async function deduplicateOrders(
  adapter: ExchangeAdapter,
  symbol: string,
  openOrders: AsterOrder[],
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  type: string,
  side: string,
  log: LogHandler
): Promise<void> {
  // Treat STOP orders on some exchanges (e.g., Lighter) as LIMIT with stopPrice populated.
  const sameTypeOrders = openOrders.filter((o) => {
    const normalizedType = String(o.type).toUpperCase();
    const isStopLike = Number.isFinite(Number(o.stopPrice)) && Number(o.stopPrice) > 0;
    const matchesStop = type === "STOP_MARKET" && isStopLike && o.side === side;
    const exactMatch = normalizedType === type && o.side === side;
    return exactMatch || matchesStop;
  });
  if (sameTypeOrders.length <= 1) return;
  sameTypeOrders.sort((a, b) => {
    const ta = b.updateTime || b.time || 0;
    const tb = a.updateTime || a.time || 0;
    return ta - tb;
  });
  const toCancel = sameTypeOrders.slice(1);
  const orderIdList = toCancel.map((o) => o.orderId);
  if (!orderIdList.length) return;
  try {
    lockOperating(locks, timers, pendings, type, log);
    await adapter.cancelOrders({ symbol, orderIdList });
    log("order", `去重撤销重复 ${type} 单: ${orderIdList.join(",")}`);
  } catch (err) {
    if (isUnknownOrderError(err)) {
      log("order", "去重时发现订单已不存在，跳过删除");
    } else {
      log("error", `去重撤单失败: ${String(err)}`);
    }
  } finally {
    unlockOperating(locks, timers, pendings, type);
  }
}

type PlaceOrderOptions = {
  priceTick: number;
  qtyStep: number;
  skipDedupe?: boolean;
};

export async function placeOrder(
  adapter: ExchangeAdapter,
  symbol: string,
  openOrders: AsterOrder[],
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  side: "BUY" | "SELL",
  price: string, // 改为字符串价格
  amount: number,
  log: LogHandler,
  reduceOnly = false,
  guard?: OrderGuardOptions,
  opts?: PlaceOrderOptions
): Promise<AsterOrder | undefined> {
  const type = "LIMIT";
  if (isOperating(locks, type)) return;
  const priceNum = Number(price);
  if (!enforceMarkPriceGuard(side, priceNum, guard, log, "限价单")) return;
  const priceTick = opts?.priceTick ?? 0.1;
  const qtyStep = opts?.qtyStep ?? 0.001;
  const params: CreateOrderParams = {
    symbol,
    side,
    type,
    quantity: roundQtyDownToStep(amount, qtyStep),
    price: priceNum, // 直接使用字符串转换的数字，不再格式化
    timeInForce: "GTX",
  };
  if (reduceOnly) params.reduceOnly = "true";
  if (!opts?.skipDedupe) {
    await deduplicateOrders(adapter, symbol, openOrders, locks, timers, pendings, type, side, log);
  }
  lockOperating(locks, timers, pendings, type, log);
  try {
    const order = await adapter.createOrder(params);
    pendings[type] = String(order.orderId);
    log("order", `挂限价单: ${side} @ ${params.price} 数量 ${params.quantity} reduceOnly=${reduceOnly}`);
    return order;
  } catch (err) {
    unlockOperating(locks, timers, pendings, type);
    if (isUnknownOrderError(err)) {
      log("order", "订单已成交或被撤销，跳过新单");
      return undefined;
    }
    throw err;
  }
}

export async function placeMarketOrder(
  adapter: ExchangeAdapter,
  symbol: string,
  openOrders: AsterOrder[],
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  side: "BUY" | "SELL",
  amount: number,
  log: LogHandler,
  reduceOnly = false,
  guard?: OrderGuardOptions,
  opts?: { qtyStep: number }
): Promise<AsterOrder | undefined> {
  // Enforce LIMIT-only trading: emulate market with IOC LIMIT at expected price
  const lockKey = "LIMIT"; // use LIMIT lock namespace going forward
  if (isOperating(locks, lockKey)) return;
  const expected = guard?.expectedPrice ?? guard?.markPrice ?? null;
  if (!enforceMarkPriceGuard(side, expected, guard, log, "市价单")) return;
  const limitPrice = Number(expected);
  if (!Number.isFinite(limitPrice)) {
    log("error", "无法确定限价价格以替代市价单，已跳过");
    return undefined;
  }
  const qtyStep = opts?.qtyStep ?? 0.001;
  const params: CreateOrderParams = {
    symbol,
    side,
    type: "LIMIT",
    quantity: roundQtyDownToStep(amount, qtyStep),
    price: limitPrice,
    timeInForce: "IOC",
  };
  if (reduceOnly) params.reduceOnly = "true";
  await deduplicateOrders(adapter, symbol, openOrders, locks, timers, pendings, "LIMIT", side, log);
  lockOperating(locks, timers, pendings, lockKey, log);
  try {
    const order = await adapter.createOrder(params);
    pendings[lockKey] = String(order.orderId);
    // Retain log wording for compatibility while using LIMIT under the hood
    log("order", `市价单: ${side} 数量 ${params.quantity} reduceOnly=${reduceOnly}`);
    return order;
  } catch (err) {
    unlockOperating(locks, timers, pendings, lockKey);
    if (isUnknownOrderError(err)) {
      log("order", "市价单失败但订单已不存在，忽略");
      return undefined;
    }
    throw err;
  }
}

export async function placeStopLossOrder(
  adapter: ExchangeAdapter,
  symbol: string,
  openOrders: AsterOrder[],
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  side: "BUY" | "SELL",
  stopPrice: number,
  quantity: number,
  lastPrice: number | null,
  log: LogHandler,
  guard?: OrderGuardOptions,
  opts?: { priceTick: number; qtyStep: number }
): Promise<AsterOrder | undefined> {
  const type = "STOP_MARKET";
  if (isOperating(locks, type)) return;
  if (!enforceMarkPriceGuard(side, stopPrice, guard, log, "止损单")) return;
  if (lastPrice != null) {
    if (side === "SELL" && stopPrice >= lastPrice) {
      log("error", `止损价 ${stopPrice} 高于或等于当前价 ${lastPrice}，取消挂单`);
      return;
    }
    if (side === "BUY" && stopPrice <= lastPrice) {
      log("error", `止损价 ${stopPrice} 低于或等于当前价 ${lastPrice}，取消挂单`);
      return;
    }
  }
  const priceTick = opts?.priceTick ?? 0.1;
  const qtyStep = opts?.qtyStep ?? 0.001;

  const params: CreateOrderParams = {
    symbol,
    side,
    type,
    quantity: roundQtyDownToStep(quantity, qtyStep),
    stopPrice: roundDownToTick(stopPrice, priceTick),
    // Always mark reduce-only semantics; some exchanges (e.g. Aster) ignore this on STOP
    reduceOnly: "true",
    // Some exchanges prefer explicit close-position semantics; gateways will normalize
    closePosition: "true",
    timeInForce: "GTC",
    // GRVT requires triggerType to match side semantics: BUY -> TAKE_PROFIT, SELL -> STOP_LOSS
    triggerType: side === "BUY" ? "TAKE_PROFIT" : "STOP_LOSS",
  };

  // Avoid forcing price for STOP_MARKET globally; keep this exchange-specific in gateways
  await deduplicateOrders(adapter, symbol, openOrders, locks, timers, pendings, type, side, log);
  lockOperating(locks, timers, pendings, type, log);
  try {
    const order = await adapter.createOrder(params);
    pendings[type] = String(order.orderId);
    log("stop", `挂止损单: ${side} STOP_MARKET @ ${params.stopPrice}`);
    return order;
  } catch (err) {
    unlockOperating(locks, timers, pendings, type);
    if (isUnknownOrderError(err)) {
      log("order", "止损单已失效，跳过");
      return undefined;
    }
    throw err;
  }
}

export async function placeTrailingStopOrder(
  adapter: ExchangeAdapter,
  symbol: string,
  openOrders: AsterOrder[],
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  side: "BUY" | "SELL",
  activationPrice: number,
  quantity: number,
  callbackRate: number,
  log: LogHandler,
  guard?: OrderGuardOptions,
  opts?: { priceTick: number; qtyStep: number }
): Promise<AsterOrder | undefined> {
  const type = "TRAILING_STOP_MARKET";
  if (isOperating(locks, type)) return;
  if (!enforceMarkPriceGuard(side, activationPrice, guard, log, "动态止盈单")) return;
  const priceTick = opts?.priceTick ?? 0.1;
  const qtyStep = opts?.qtyStep ?? 0.001;
  const params: CreateOrderParams = {
    symbol,
    side,
    type,
    quantity,
    reduceOnly: "true",
    activationPrice: roundDownToTick(activationPrice, priceTick),
    callbackRate,
    timeInForce: "GTC",
  };
  await deduplicateOrders(adapter, symbol, openOrders, locks, timers, pendings, type, side, log);
  lockOperating(locks, timers, pendings, type, log);
  try {
    const order = await adapter.createOrder(params);
    pendings[type] = String(order.orderId);
    log(
      "order",
      `挂动态止盈单: ${side} activation=${params.activationPrice} callbackRate=${callbackRate}`
    );
    return order;
  } catch (err) {
    unlockOperating(locks, timers, pendings, type);
    if (isUnknownOrderError(err)) {
      log("order", "动态止盈单已失效，跳过");
      return undefined;
    }
    throw err;
  }
}

type AtomicDualGuardOptions = OrderGuardOptions & {
  lossLimitUsd: number;
  priceTick: number;
  qtyStep: number;
  attachStops: boolean;
};

/**
 * Atomically place BUY and SELL limit orders together on GRVT, with optional OSO stop-loss per leg.
 * Falls back to sequential placement if bulk API is unavailable.
 */
export async function placeAtomicDualWithStops(
  adapter: ExchangeAdapter,
  symbol: string,
  openOrders: AsterOrder[],
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  buy: { price: string; amount: number },
  sell: { price: string; amount: number },
  log: LogHandler,
  guard: AtomicDualGuardOptions
): Promise<AsterOrder[] | undefined> {
  const type = "LIMIT";
  if (isOperating(locks, type)) return;

  const buyPrice = Number(buy.price);
  const sellPrice = Number(sell.price);
  if (!enforceMarkPriceGuard("BUY", buyPrice, guard, log, "原子挂单(BUY)")) return;
  if (!enforceMarkPriceGuard("SELL", sellPrice, guard, log, "原子挂单(SELL)")) return;

  // Deduplicate existing LIMITs per side before placement
  await deduplicateOrders(adapter, symbol, openOrders, locks, timers, pendings, type, "BUY", log);
  await deduplicateOrders(adapter, symbol, openOrders, locks, timers, pendings, type, "SELL", log);

  const hasBulk = (adapter as any)?.createBulkOrders && adapter.id === "grvt";
  lockOperating(locks, timers, pendings, type, log);

  try {
    const paramsList: CreateOrderParams[] = [];
    // Entry BUY
    paramsList.push({
      symbol,
      side: "BUY",
      type: "LIMIT",
      quantity: roundQtyDownToStep(buy.amount, guard.qtyStep),
      price: buyPrice,
      timeInForce: "GTX",
    });
    // Entry SELL
    paramsList.push({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: roundQtyDownToStep(sell.amount, guard.qtyStep),
      price: sellPrice,
      timeInForce: "GTX",
    });

    if (guard.attachStops) {
      // OSO stop for long (BUY entry): SELL STOP at entry - loss/qty
      const longQty = roundQtyDownToStep(buy.amount, guard.qtyStep);
      const longStop = roundDownToTick(
        calcStopLossPrice(buyPrice, longQty, "long", guard.lossLimitUsd),
        guard.priceTick
      );
      paramsList.push({
        symbol,
        side: "SELL",
        type: "STOP_MARKET",
        quantity: longQty,
        stopPrice: longStop,
        reduceOnly: "true",
        closePosition: "true",
        timeInForce: "GTC",
        triggerType: "STOP_LOSS",
      });

      // OSO stop for short (SELL entry): BUY STOP at entry + loss/qty
      const shortQty = roundQtyDownToStep(sell.amount, guard.qtyStep);
      const shortStop = roundDownToTick(
        calcStopLossPrice(sellPrice, shortQty, "short", guard.lossLimitUsd),
        guard.priceTick
      );
      paramsList.push({
        symbol,
        side: "BUY",
        type: "STOP_MARKET",
        quantity: shortQty,
        stopPrice: shortStop,
        reduceOnly: "true",
        closePosition: "true",
        timeInForce: "GTC",
        // GRVT uses TAKE_PROFIT for BUY-side triggers closing shorts
        triggerType: "TAKE_PROFIT",
      });
    }

    if (hasBulk) {
      try {
        const created: AsterOrder[] = await (adapter as any).createBulkOrders(paramsList);
        const ids = created.map((o) => String(o.orderId));
        pendings[type] = ids[0] ?? null;
        log(
          "order",
          `GRVT 原子挂单: BUY@${buyPrice} SELL@${sellPrice}` + (guard.attachStops ? " + OSO止损" : "")
        );
        return created;
      } catch (bulkError) {
        // Fallback to sequential if bulk API is not available
        log("warn", `GRVT 原子挂单失败，回退顺序挂单: ${String(bulkError)}`);
      }
    }

    // Fallback: sequential placement
    const placed: AsterOrder[] = [];
    const buyOrder = await adapter.createOrder({
      symbol,
      side: "BUY",
      type: "LIMIT",
      quantity: roundQtyDownToStep(buy.amount, guard.qtyStep),
      price: buyPrice,
      timeInForce: "GTX",
    });
    placed.push(buyOrder);
    const sellOrder = await adapter.createOrder({
      symbol,
      side: "SELL",
      type: "LIMIT",
      quantity: roundQtyDownToStep(sell.amount, guard.qtyStep),
      price: sellPrice,
      timeInForce: "GTX",
    });
    placed.push(sellOrder);

    if (guard.attachStops) {
      await adapter.createOrder({
        symbol,
        side: "SELL",
        type: "STOP_MARKET",
        quantity: roundQtyDownToStep(buy.amount, guard.qtyStep),
        stopPrice: roundDownToTick(
          calcStopLossPrice(buyPrice, roundQtyDownToStep(buy.amount, guard.qtyStep), "long", guard.lossLimitUsd),
          guard.priceTick
        ),
        reduceOnly: "true",
        closePosition: "true",
        timeInForce: "GTC",
        triggerType: "STOP_LOSS",
      });
      await adapter.createOrder({
        symbol,
        side: "BUY",
        type: "STOP_MARKET",
        quantity: roundQtyDownToStep(sell.amount, guard.qtyStep),
        stopPrice: roundDownToTick(
          calcStopLossPrice(sellPrice, roundQtyDownToStep(sell.amount, guard.qtyStep), "short", guard.lossLimitUsd),
          guard.priceTick
        ),
        reduceOnly: "true",
        closePosition: "true",
        timeInForce: "GTC",
        triggerType: "STOP_LOSS",
      });
    }

    const firstId = placed[0]?.orderId;
    pendings[type] = firstId != null ? String(firstId) : null;
    log("order", `顺序挂单: BUY@${buyPrice} SELL@${sellPrice}` + (guard.attachStops ? " + 止损" : ""));
    return placed;
  } catch (err) {
    unlockOperating(locks, timers, pendings, type);
    if (isUnknownOrderError(err)) {
      log("order", "原子挂单失败但订单已不存在，忽略");
      return undefined;
    }
    throw err;
  }
}

export async function marketClose(
  adapter: ExchangeAdapter,
  symbol: string,
  openOrders: AsterOrder[],
  locks: OrderLockMap,
  timers: OrderTimerMap,
  pendings: OrderPendingMap,
  side: "BUY" | "SELL",
  quantity: number,
  log: LogHandler,
  guard?: OrderGuardOptions,
  opts?: { qtyStep: number }
): Promise<void> {
  // Replace MARKET close with IOC LIMIT close at expected price
  const lockKey = "LIMIT";
  if (isOperating(locks, lockKey)) return;
  const expected = guard?.expectedPrice ?? guard?.markPrice ?? null;
  if (!enforceMarkPriceGuard(side, expected, guard, log, "市价平仓")) return;
  const limitPrice = Number(expected);
  if (!Number.isFinite(limitPrice)) {
    log("error", "无法确定平仓限价价格，已跳过");
    return;
  }

  const params: CreateOrderParams = {
    symbol,
    side,
    type: "LIMIT",
    quantity,
    price: limitPrice,
    timeInForce: "IOC",
    reduceOnly: "true",
  };

  await deduplicateOrders(adapter, symbol, openOrders, locks, timers, pendings, "LIMIT", side, log);
  lockOperating(locks, timers, pendings, lockKey, log);
  try {
    const order = await adapter.createOrder(params);
    pendings[lockKey] = String(order.orderId);
    // Keep log wording for continuity
    log("close", `市价平仓: ${side}`);
  } catch (err) {
    unlockOperating(locks, timers, pendings, lockKey);
    if (isUnknownOrderError(err)) {
      log("order", "市场平仓时订单已不存在");
      return;
    }
    throw err;
  }
}
