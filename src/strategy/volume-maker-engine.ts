import type { MakerConfig } from "../config";
import type { ExchangeAdapter } from "../exchanges/adapter";
import type {
  AsterAccountSnapshot,
  AsterDepth,
  AsterOrder,
  AsterTicker,
} from "../exchanges/types";
import { formatPriceToString } from "../utils/math";
import { createTradeLog, type TradeLogEntry } from "../logging/trade-log";
import { extractMessage, isInsufficientBalanceError, isUnknownOrderError, isRateLimitError } from "../utils/errors";
import { getPosition } from "../utils/strategy";
import type { PositionSnapshot } from "../utils/strategy";
import { computePositionPnl } from "../utils/pnl";
import { getTopPrices, getMidOrLast } from "../utils/price";
import { calcStopLossPrice, calcTakeProfitPriceFromLoss } from "../utils/strategy";
import { placeStopLossOrder, placeOrder, unlockOperating } from "../core/order-coordinator";
import type { OrderLockMap, OrderPendingMap, OrderTimerMap } from "../core/order-coordinator";
import { makeOrderPlan } from "../core/lib/order-plan";
import { safeCancelOrder } from "../core/lib/orders";
import { RateLimitController } from "../core/lib/rate-limit";
import { StrategyEventEmitter } from "./common/event-emitter";
import { safeSubscribe, type LogHandler } from "./common/subscriptions";
import { SessionVolumeTracker } from "./common/session-volume";

interface DesiredOrder {
  side: "BUY" | "SELL";
  price: string;
  amount: number;
  reduceOnly: boolean;
}

interface FeeStats {
  totalMakerFees: number;
  totalTakerFees: number;
  netFees: number;
  estimatedMakerFeeRate: number;
  estimatedTakerFeeRate: number;
}

export interface VolumeMakerEngineSnapshot {
  ready: boolean;
  symbol: string;
  topBid: number | null;
  topAsk: number | null;
  spread: number | null;
  position: PositionSnapshot;
  pnl: number;
  accountUnrealized: number;
  sessionVolume: number;
  openOrders: AsterOrder[];
  desiredOrders: DesiredOrder[];
  tradeLog: TradeLogEntry[];
  lastUpdated: number | null;
  feedStatus: {
    account: boolean;
    orders: boolean;
    depth: boolean;
    ticker: boolean;
  };
  feeStats: FeeStats;
  totalFilledVolume: number;
  avgFillPrice: number;
  orderPressure: {
    buyOrders: number;
    sellOrders: number;
    totalOrders: number;
  };
}

type MakerEvent = "update";
type MakerListener = (snapshot: VolumeMakerEngineSnapshot) => void;

const EPS = 1e-5;
const INSUFFICIENT_BALANCE_COOLDOWN_MS = 15_000;

// Volume maker specific constants
const MIN_SPREAD_TICKS = 1; // Minimum spread in price ticks for aggressive market making
const MAX_SPREAD_TICKS = 3; // Maximum spread to ensure we're always at top of book
const VOLUME_REFRESH_INTERVAL_MS = 100; // Faster refresh for volume generation
const MAX_ORDERS_PER_SIDE = 5; // Multiple orders per side for volume layering
const ORDER_SIZE_MULTIPLIER = [1, 0.8, 0.6, 0.4, 0.2]; // Descending sizes for depth

export class VolumeMakerEngine {
  private accountSnapshot: AsterAccountSnapshot | null = null;
  private depthSnapshot: AsterDepth | null = null;
  private tickerSnapshot: AsterTicker | null = null;
  private openOrders: AsterOrder[] = [];

  private readonly locks: OrderLockMap = {};
  private readonly timers: OrderTimerMap = {};
  private readonly pending: OrderPendingMap = {};
  private readonly pendingCancelOrders = new Set<string>();

  private readonly tradeLog: ReturnType<typeof createTradeLog>;
  private readonly events = new StrategyEventEmitter<MakerEvent, VolumeMakerEngineSnapshot>();
  private readonly sessionVolume = new SessionVolumeTracker();

  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private desiredOrders: DesiredOrder[] = [];
  private accountUnrealized = 0;
  private initialOrderSnapshotReady = false;
  private initialOrderResetDone = false;
  private entryPricePendingLogged = false;
  private readinessLogged = {
    account: false,
    depth: false,
    ticker: false,
    orders: false,
  };
  private feedArrived = {
    account: false,
    depth: false,
    ticker: false,
    orders: false,
  };
  private feedStatus = {
    account: false,
    depth: false,
    ticker: false,
    orders: false,
  };
  private insufficientBalanceCooldownUntil = 0;
  private insufficientBalanceNotified = false;
  private lastInsufficientMessage: string | null = null;
  private lastDesiredSummary: string | null = null;
  private readonly rateLimit: RateLimitController;

  // Volume tracking
  private totalFilledVolume = 0;
  private totalBuyVolume = 0;
  private totalSellVolume = 0;
  private fillCount = 0;
  private avgFillPrice = 0;

  // Fee tracking
  private feeStats: FeeStats = {
    totalMakerFees: 0,
    totalTakerFees: 0,
    netFees: 0,
    estimatedMakerFeeRate: -0.0002, // Assume -0.02% maker rebate (negative fee)
    estimatedTakerFeeRate: 0.0005,  // Assume 0.05% taker fee
  };

  constructor(private readonly config: MakerConfig, private readonly exchange: ExchangeAdapter) {
    this.tradeLog = createTradeLog(this.config.maxLogEntries);
    // Use faster refresh interval for volume generation
    const fastRefreshMs = Math.min(this.config.refreshIntervalMs, VOLUME_REFRESH_INTERVAL_MS);
    this.rateLimit = new RateLimitController(fastRefreshMs, (type, detail) =>
      this.tradeLog.push(type, detail)
    );
    this.bootstrap();
  }

  start(): void {
    if (this.timer) return;
    const fastRefreshMs = Math.min(this.config.refreshIntervalMs, VOLUME_REFRESH_INTERVAL_MS);
    this.timer = setInterval(() => {
      void this.tick();
    }, fastRefreshMs);
    this.tradeLog.push("info", `Volume Maker 시작 - 양방향 공격적 주문으로 거래량 극대화 및 네거티브 수수료 획득`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  on(event: MakerEvent, handler: MakerListener): void {
    this.events.on(event, handler);
  }

  off(event: MakerEvent, handler: MakerListener): void {
    this.events.off(event, handler);
  }

  getSnapshot(): VolumeMakerEngineSnapshot {
    return this.buildSnapshot();
  }

  private bootstrap(): void {
    const log: LogHandler = (type, detail) => this.tradeLog.push(type, detail);

    safeSubscribe<AsterAccountSnapshot>(
      this.exchange.watchAccount.bind(this.exchange),
      (snapshot) => {
        this.accountSnapshot = snapshot;
        const totalUnrealized = Number(snapshot.totalUnrealizedProfit ?? "0");
        if (Number.isFinite(totalUnrealized)) {
          this.accountUnrealized = totalUnrealized;
        }
        const position = getPosition(snapshot, this.config.symbol);
        this.sessionVolume.update(position, this.getReferencePrice());
        if (!this.feedArrived.account) {
          this.tradeLog.push("info", "계정 스냅샷 동기화 완료");
          this.feedArrived.account = true;
        }
        this.feedStatus.account = true;
        this.emitUpdate();
      },
      log,
      {
        subscribeFail: (error) => `계정 구독 실패: ${String(error)}`,
        processFail: (error) => `계정 처리 오류: ${String(error)}`,
      }
    );

    safeSubscribe<AsterOrder[]>(
      this.exchange.watchOrders.bind(this.exchange),
      (orders) => {
        this.syncLocksWithOrders(orders);
        const previousOrders = new Map(this.openOrders.map(o => [o.orderId, o]));
        this.openOrders = Array.isArray(orders)
          ? orders.filter((order) => order.type !== "MARKET" && order.symbol === this.config.symbol)
          : [];
        
        // Track filled orders for volume and fee calculation
        this.trackFilledOrders(previousOrders, this.openOrders);
        
        const currentIds = new Set(this.openOrders.map((order) => String(order.orderId)));
        for (const id of Array.from(this.pendingCancelOrders)) {
          if (!currentIds.has(id)) {
            this.pendingCancelOrders.delete(id);
          }
        }
        this.initialOrderSnapshotReady = true;
        if (!this.feedArrived.orders) {
          this.tradeLog.push("info", "주문 스냅샷 수신");
          this.feedArrived.orders = true;
        }
        this.feedStatus.orders = true;
        this.emitUpdate();
      },
      log,
      {
        subscribeFail: (error) => `주문 구독 실패: ${String(error)}`,
        processFail: (error) => `주문 처리 오류: ${String(error)}`,
      }
    );

    safeSubscribe<AsterDepth>(
      this.exchange.watchDepth.bind(this.exchange, this.config.symbol),
      (depth) => {
        this.depthSnapshot = depth;
        if (!this.feedArrived.depth) {
          this.tradeLog.push("info", "깊이 데이터 수신");
          this.feedArrived.depth = true;
        }
        this.feedStatus.depth = true;
        this.emitUpdate();
      },
      log,
      {
        subscribeFail: (error) => `깊이 구독 실패: ${String(error)}`,
        processFail: (error) => `깊이 처리 오류: ${String(error)}`,
      }
    );

    safeSubscribe<AsterTicker>(
      this.exchange.watchTicker.bind(this.exchange, this.config.symbol),
      (ticker) => {
        this.tickerSnapshot = ticker;
        if (!this.feedArrived.ticker) {
          this.tradeLog.push("info", "티커 준비 완료");
          this.feedArrived.ticker = true;
        }
        this.feedStatus.ticker = true;
        this.emitUpdate();
      },
      log,
      {
        subscribeFail: (error) => `티커 구독 실패: ${String(error)}`,
        processFail: (error) => `티커 처리 오류: ${String(error)}`,
      }
    );
  }

  private trackFilledOrders(previousOrders: Map<number, AsterOrder>, currentOrders: AsterOrder[]): void {
    const currentOrderMap = new Map(currentOrders.map(o => [o.orderId, o]));
    
    // Check for filled orders (disappeared from active orders)
    for (const [orderId, prevOrder] of previousOrders) {
      const currentOrder = currentOrderMap.get(orderId);
      
      // Order disappeared or fully filled
      if (!currentOrder || currentOrder.status === "FILLED") {
        const filledQty = prevOrder.origQty - (currentOrder?.leftQty || 0);
        const fillPrice = Number(prevOrder.price);
        
        if (filledQty > 0 && fillPrice > 0) {
          this.totalFilledVolume += filledQty;
          
          if (prevOrder.side === "BUY") {
            this.totalBuyVolume += filledQty;
          } else {
            this.totalSellVolume += filledQty;
          }
          
          this.fillCount++;
          // Update average fill price
          this.avgFillPrice = ((this.avgFillPrice * (this.fillCount - 1)) + fillPrice) / this.fillCount;
          
          // Estimate fees (negative for maker, positive for taker)
          const notionalValue = filledQty * fillPrice;
          const estimatedFee = notionalValue * this.feeStats.estimatedMakerFeeRate;
          this.feeStats.totalMakerFees += estimatedFee;
          this.feeStats.netFees += estimatedFee;
          
          this.tradeLog.push("trade", 
            `${prevOrder.side} 체결: ${filledQty} @ ${fillPrice} | 예상 메이커 수수료: ${estimatedFee.toFixed(4)} USDT (${estimatedFee < 0 ? '리베이트' : '비용'})`
          );
        }
      }
    }
  }

  private syncLocksWithOrders(orders: AsterOrder[] | null | undefined): void {
    const list = Array.isArray(orders) ? orders : [];
    Object.keys(this.pending).forEach((type) => {
      const pendingId = this.pending[type];
      if (!pendingId) return;
      const match = list.find((order) => String(order.orderId) === pendingId);
      if (!match || (match.status && match.status !== "NEW" && match.status !== "PARTIALLY_FILLED")) {
        unlockOperating(this.locks, this.timers, this.pending, type);
      }
    });
  }

  private isReady(): boolean {
    return Boolean(
      this.feedStatus.account &&
        this.feedStatus.depth &&
        this.feedStatus.ticker &&
        this.feedStatus.orders
    );
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    let hadRateLimit = false;
    try {
      const decision = this.rateLimit.beforeCycle();
      if (decision === "paused") {
        this.emitUpdate();
        return;
      }
      if (decision === "skip") {
        return;
      }
      if (!this.isReady()) {
        this.logReadinessBlockers();
        this.emitUpdate();
        return;
      }
      this.resetReadinessFlags();
      if (!(await this.ensureStartupOrderReset())) {
        this.emitUpdate();
        return;
      }

      const depth = this.depthSnapshot!;
      const { topBid, topAsk } = getTopPrices(depth);
      if (topBid == null || topAsk == null) {
        this.emitUpdate();
        return;
      }

      const position = getPosition(this.accountSnapshot, this.config.symbol);
      const absPosition = Math.abs(position.positionAmt);
      const desired: DesiredOrder[] = [];
      const insufficientActive = this.applyInsufficientBalanceState(Date.now());
      const canEnter = !this.rateLimit.shouldBlockEntries() && !insufficientActive;

      const priceDecimals = Math.max(0, Math.floor(Math.log10(1 / this.config.priceTick)));

      // Volume maker strategy: aggressive bilateral market making
      if (absPosition < EPS) {
        // No position - place aggressive bilateral orders
        if (canEnter) {
          // Generate multiple orders per side for volume layering
          for (let i = 0; i < MAX_ORDERS_PER_SIDE; i++) {
            const spreadTicks = MIN_SPREAD_TICKS + i;
            const bidPrice = formatPriceToString(topBid - (this.config.priceTick * spreadTicks), priceDecimals);
            const askPrice = formatPriceToString(topAsk + (this.config.priceTick * spreadTicks), priceDecimals);
            const orderSize = this.config.tradeAmount * ORDER_SIZE_MULTIPLIER[i];
            
            // Place both buy and sell orders simultaneously for maximum volume
            desired.push({ side: "BUY", price: bidPrice, amount: orderSize, reduceOnly: false });
            desired.push({ side: "SELL", price: askPrice, amount: orderSize, reduceOnly: false });
          }
        }
      } else {
        // Has position - try to close with profit while continuing to generate volume
        const hasEntryPrice = Number.isFinite(position.entryPrice) && Math.abs(position.entryPrice) > 1e-8;
        const direction: "long" | "short" = position.positionAmt > 0 ? "long" : "short";
        const closeSide: "BUY" | "SELL" = direction === "long" ? "SELL" : "BUY";
        
        if (hasEntryPrice) {
          // Place close order at minimal profit to quickly flip position
          const minProfitTicks = 2; // Minimum profit to cover potential taker fees
          const closePrice = direction === "long" 
            ? position.entryPrice + (this.config.priceTick * minProfitTicks)
            : position.entryPrice - (this.config.priceTick * minProfitTicks);
          const closePriceStr = formatPriceToString(closePrice, priceDecimals);
          desired.push({ side: closeSide, price: closePriceStr, amount: absPosition, reduceOnly: true });
          
          // Continue placing opposite side orders for volume
          if (canEnter) {
            const oppositePrice = direction === "long" 
              ? formatPriceToString(topBid - this.config.priceTick, priceDecimals)
              : formatPriceToString(topAsk + this.config.priceTick, priceDecimals);
            const oppositeSide = direction === "long" ? "BUY" : "SELL";
            desired.push({ side: oppositeSide, price: oppositePrice, amount: this.config.tradeAmount, reduceOnly: false });
          }
        } else {
          // No entry price - close at market price
          const closePrice = closeSide === "SELL" 
            ? formatPriceToString(topBid, priceDecimals)
            : formatPriceToString(topAsk, priceDecimals);
          desired.push({ side: closeSide, price: closePrice, amount: absPosition, reduceOnly: true });
        }
      }

      this.desiredOrders = desired;
      this.logDesiredOrders(desired);
      this.sessionVolume.update(position, this.getReferencePrice());
      
      // Sync orders with parallel placement for maximum speed
      await this.syncOrders(desired);
      await this.checkRisk(position, Number(topBid), Number(topAsk));
      this.emitUpdate();
    } catch (error) {
      if (isRateLimitError(error)) {
        hadRateLimit = true;
        this.rateLimit.registerRateLimit("volume-maker");
        await this.enforceRateLimitStop();
        this.tradeLog.push("warn", `Volume Maker 429: ${String(error)}`);
      } else {
        this.tradeLog.push("error", `볼륨 메이커 오류: ${String(error)}`);
      }
      this.emitUpdate();
    } finally {
      this.rateLimit.onCycleComplete(hadRateLimit);
      this.processing = false;
    }
  }

  private async enforceRateLimitStop(): Promise<void> {
    const position = getPosition(this.accountSnapshot, this.config.symbol);
    if (Math.abs(position.positionAmt) < EPS) return;
    const { topBid, topAsk } = getTopPrices(this.depthSnapshot);
    if (topBid == null || topAsk == null) return;
    
    await this.checkRisk(position, topBid, topAsk);
    await this.flushNonStopOrders();
  }

  private async ensureStartupOrderReset(): Promise<boolean> {
    if (this.initialOrderResetDone) return true;
    if (!this.initialOrderSnapshotReady) return false;
    if (!this.openOrders.length) {
      this.initialOrderResetDone = true;
      return true;
    }
    try {
      await this.exchange.cancelAllOrders({ symbol: this.config.symbol });
      this.pendingCancelOrders.clear();
      unlockOperating(this.locks, this.timers, this.pending, "LIMIT");
      this.openOrders = [];
      this.emitUpdate();
      this.tradeLog.push("order", "시작 시 기존 주문 정리");
      this.initialOrderResetDone = true;
      return true;
    } catch (error) {
      if (isUnknownOrderError(error)) {
        this.tradeLog.push("order", "기존 주문 없음");
        this.initialOrderResetDone = true;
        this.openOrders = [];
        this.emitUpdate();
        return true;
      }
      this.tradeLog.push("error", `초기화 실패: ${String(error)}`);
      return false;
    }
  }

  private async syncOrders(targets: DesiredOrder[]): Promise<void> {
    const availableOrders = this.openOrders.filter((o) => !this.pendingCancelOrders.has(String(o.orderId)));
    const openOrders = availableOrders.filter((order) => {
      const status = (order.status ?? "").toUpperCase();
      return !status.includes("CLOSED") && !status.includes("FILLED") && !status.includes("CANCELED");
    });
    
    const { toCancel, toPlace } = makeOrderPlan(openOrders, targets, {
      priceToleranceAbs: this.config.priceTick / 2,
    });

    // Cancel non-matching orders
    const cancelPromises = toCancel.map(async (order) => {
      if (this.pendingCancelOrders.has(String(order.orderId))) return;
      this.pendingCancelOrders.add(String(order.orderId));
      await safeCancelOrder(
        this.exchange,
        this.config.symbol,
        order,
        () => {
          this.tradeLog.push("order", `취소: ${order.side} @ ${order.price}`);
        },
        () => {
          this.pendingCancelOrders.delete(String(order.orderId));
          this.openOrders = this.openOrders.filter((existing) => existing.orderId !== order.orderId);
        },
        (error) => {
          this.tradeLog.push("error", `취소 실패: ${String(error)}`);
          this.pendingCancelOrders.delete(String(order.orderId));
          this.openOrders = this.openOrders.filter((existing) => existing.orderId !== order.orderId);
        }
      );
    });

    // Wait for cancellations to complete
    await Promise.all(cancelPromises);

    // Place new orders in parallel for maximum speed
    const placePromises = toPlace.map(async (target) => {
      if (!target || target.amount < EPS) return;
      try {
        await placeOrder(
          this.exchange,
          this.config.symbol,
          this.openOrders,
          this.locks,
          this.timers,
          this.pending,
          target.side,
          target.price,
          target.amount,
          (type, detail) => this.tradeLog.push(type, detail),
          target.reduceOnly,
          {
            markPrice: getPosition(this.accountSnapshot, this.config.symbol).markPrice,
            maxPct: this.config.maxCloseSlippagePct,
          },
          {
            priceTick: this.config.priceTick,
            qtyStep: 0.001,
            lockKey: `LIMIT_${target.side}_${Date.now()}`, // Unique lock key for parallel orders
          }
        );
      } catch (error) {
        if (isInsufficientBalanceError(error)) {
          this.registerInsufficientBalance(error);
        } else {
          this.tradeLog.push("error", `주문 실패 (${target.side} ${target.price}): ${extractMessage(error)}`);
        }
      }
    });

    // Execute all place orders in parallel
    await Promise.all(placePromises);
  }

  private async checkRisk(position: PositionSnapshot, bidPrice: number, askPrice: number): Promise<void> {
    const absPosition = Math.abs(position.positionAmt);
    if (absPosition < EPS) return;

    const hasEntryPrice = Number.isFinite(position.entryPrice) && Math.abs(position.entryPrice) > 1e-8;
    if (!hasEntryPrice) {
      if (!this.entryPricePendingLogged) {
        this.tradeLog.push("info", "포지션 진입가 대기 중");
        this.entryPricePendingLogged = true;
      }
      return;
    }
    this.entryPricePendingLogged = false;

    // Place stop loss but keep it wider to avoid premature exits
    await this.ensureStopLossOrder(position, (bidPrice + askPrice) / 2);
  }

  private async ensureStopLossOrder(position: PositionSnapshot, lastPrice: number | null): Promise<void> {
    const absPosition = Math.abs(position.positionAmt);
    if (absPosition < EPS) return;
    const direction: "long" | "short" = position.positionAmt > 0 ? "long" : "short";
    const stopSide: "BUY" | "SELL" = direction === "long" ? "SELL" : "BUY";
    
    // Use wider stop loss for volume strategy
    const widerLossLimit = this.config.lossLimit * 2; // Double the normal stop loss distance
    const targetStop = calcStopLossPrice(position.entryPrice, absPosition, direction, widerLossLimit);

    const currentStop = this.openOrders.find((o) => {
      const hasStopPrice = Number.isFinite(Number(o.stopPrice)) && Number(o.stopPrice) > 0;
      return o.side === stopSide && (String(o.type).toUpperCase() === "STOP_MARKET" || hasStopPrice);
    });

    const priceTick = Math.max(1e-9, this.config.priceTick);
    const roundedTarget = Math.round(targetStop / priceTick) * priceTick;

    const existing = Number(currentStop?.stopPrice);
    const needPlace = !currentStop;
    const needReplace = Number.isFinite(existing) && Math.abs(existing - roundedTarget) >= priceTick;

    if (needPlace || (needReplace && currentStop)) {
      if (currentStop) {
        try {
          await this.exchange.cancelOrder({ symbol: this.config.symbol, orderId: currentStop.orderId });
        } catch (err) {
          if (!isUnknownOrderError(err)) {
            this.tradeLog.push("error", `정지 주문 취소 실패: ${String(err)}`);
          }
        }
      }
      
      try {
        await placeStopLossOrder(
          this.exchange,
          this.config.symbol,
          this.openOrders,
          this.locks,
          this.timers,
          this.pending,
          stopSide,
          roundedTarget,
          absPosition,
          lastPrice,
          (type, detail) => this.tradeLog.push(type, detail),
          {
            markPrice: position.markPrice,
            maxPct: this.config.maxCloseSlippagePct,
          },
          { priceTick: this.config.priceTick, qtyStep: 0.001 }
        );
      } catch (err) {
        this.tradeLog.push("error", `정지 주문 실패: ${String(err)}`);
      }
    }
  }

  private async flushNonStopOrders(): Promise<void> {
    if (!this.openOrders.length) return;
    for (const order of this.openOrders) {
      const type = String(order.type).toUpperCase();
      const hasStopPrice = Number.isFinite(Number(order.stopPrice)) && Number(order.stopPrice) > 0;
      const isTriggerLike = type.includes("STOP") || type.includes("TAKE_PROFIT") || hasStopPrice;
      if (isTriggerLike) continue;
      if (this.pendingCancelOrders.has(String(order.orderId))) continue;
      this.pendingCancelOrders.add(String(order.orderId));
      await safeCancelOrder(
        this.exchange,
        this.config.symbol,
        order,
        () => {},
        () => {
          this.pendingCancelOrders.delete(String(order.orderId));
          this.openOrders = this.openOrders.filter((existing) => existing.orderId !== order.orderId);
        },
        (error) => {
          this.tradeLog.push("error", `주문 취소 실패: ${String(error)}`);
          this.pendingCancelOrders.delete(String(order.orderId));
          this.openOrders = this.openOrders.filter((existing) => existing.orderId !== order.orderId);
        }
      );
    }
  }

  private async flushOrders(): Promise<void> {
    if (!this.openOrders.length) return;
    for (const order of this.openOrders) {
      if (this.pendingCancelOrders.has(String(order.orderId))) continue;
      this.pendingCancelOrders.add(String(order.orderId));
      await safeCancelOrder(
        this.exchange,
        this.config.symbol,
        order,
        () => {},
        () => {
          this.tradeLog.push("order", "주문 취소됨");
          this.pendingCancelOrders.delete(String(order.orderId));
          this.openOrders = this.openOrders.filter((existing) => existing.orderId !== order.orderId);
        },
        (error) => {
          this.tradeLog.push("error", `주문 취소 실패: ${String(error)}`);
          this.pendingCancelOrders.delete(String(order.orderId));
          this.openOrders = this.openOrders.filter((existing) => existing.orderId !== order.orderId);
        }
      );
    }
  }

  private emitUpdate(): void {
    try {
      const snapshot = this.buildSnapshot();
      this.events.emit("update", snapshot, (error) => {
        this.tradeLog.push("error", `업데이트 오류: ${String(error)}`);
      });
    } catch (err) {
      this.tradeLog.push("error", `스냅샷 오류: ${String(err)}`);
    }
  }

  private buildSnapshot(): VolumeMakerEngineSnapshot {
    const position = getPosition(this.accountSnapshot, this.config.symbol);
    const { topBid, topAsk } = getTopPrices(this.depthSnapshot);
    const spread = topBid != null && topAsk != null ? topAsk - topBid : null;
    const pnl = computePositionPnl(position, topBid, topAsk);

    // Count orders by side
    const buyOrders = this.openOrders.filter(o => o.side === "BUY").length;
    const sellOrders = this.openOrders.filter(o => o.side === "SELL").length;

    return {
      ready: this.isReady(),
      symbol: this.config.symbol,
      topBid: topBid,
      topAsk: topAsk,
      spread,
      position,
      pnl,
      accountUnrealized: this.accountUnrealized,
      sessionVolume: this.sessionVolume.value,
      openOrders: this.openOrders,
      desiredOrders: this.desiredOrders,
      tradeLog: this.tradeLog.all(),
      lastUpdated: Date.now(),
      feedStatus: { ...this.feedStatus },
      feeStats: { ...this.feeStats },
      totalFilledVolume: this.totalFilledVolume,
      avgFillPrice: this.avgFillPrice,
      orderPressure: {
        buyOrders,
        sellOrders,
        totalOrders: buyOrders + sellOrders,
      },
    };
  }

  private getReferencePrice(): number | null {
    return getMidOrLast(this.depthSnapshot, this.tickerSnapshot);
  }

  private logReadinessBlockers(): void {
    if (!this.feedStatus.account && !this.readinessLogged.account) {
      this.tradeLog.push("info", "계정 대기 중");
      this.readinessLogged.account = true;
    }
    if (!this.feedStatus.depth && !this.readinessLogged.depth) {
      this.tradeLog.push("info", "깊이 대기 중");
      this.readinessLogged.depth = true;
    }
    if (!this.feedStatus.ticker && !this.readinessLogged.ticker) {
      this.tradeLog.push("info", "티커 대기 중");
      this.readinessLogged.ticker = true;
    }
    if (!this.feedStatus.orders && !this.readinessLogged.orders) {
      this.tradeLog.push("info", "주문 대기 중");
      this.readinessLogged.orders = true;
    }
  }

  private resetReadinessFlags(): void {
    this.readinessLogged = {
      account: false,
      depth: false,
      ticker: false,
      orders: false,
    };
  }

  private logDesiredOrders(desired: DesiredOrder[]): void {
    if (!desired.length) {
      if (this.lastDesiredSummary !== "none") {
        this.tradeLog.push("info", "대기 중");
        this.lastDesiredSummary = "none";
      }
      return;
    }
    const buyCount = desired.filter(o => o.side === "BUY").length;
    const sellCount = desired.filter(o => o.side === "SELL").length;
    const summary = `매수 ${buyCount}개, 매도 ${sellCount}개 주문`;
    if (summary !== this.lastDesiredSummary) {
      this.tradeLog.push("info", `목표: ${summary} | 총 거래량: ${this.totalFilledVolume.toFixed(4)} | 순 수수료: ${this.feeStats.netFees.toFixed(4)} USDT`);
      this.lastDesiredSummary = summary;
    }
  }

  private registerInsufficientBalance(error: unknown): void {
    const now = Date.now();
    const detail = extractMessage(error);
    const alreadyActive = now < this.insufficientBalanceCooldownUntil;
    if (alreadyActive && detail === this.lastInsufficientMessage) {
      this.insufficientBalanceCooldownUntil = now + INSUFFICIENT_BALANCE_COOLDOWN_MS;
      return;
    }
    this.insufficientBalanceCooldownUntil = now + INSUFFICIENT_BALANCE_COOLDOWN_MS;
    this.lastInsufficientMessage = detail;
    const seconds = Math.ceil(INSUFFICIENT_BALANCE_COOLDOWN_MS / 1000);
    this.tradeLog.push("warn", `잔액 부족, ${seconds}초 대기: ${detail}`);
    this.insufficientBalanceNotified = true;
  }

  private applyInsufficientBalanceState(now: number): boolean {
    const active = now < this.insufficientBalanceCooldownUntil;
    if (!active && this.insufficientBalanceNotified) {
      this.tradeLog.push("info", "잔액 복구, 재개");
      this.insufficientBalanceNotified = false;
      this.lastInsufficientMessage = null;
    }
    return active;
  }
}