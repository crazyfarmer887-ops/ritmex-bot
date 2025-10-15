import { describe, expect, it, vi } from "vitest";
import type { ExchangeAdapter } from "../src/exchanges/adapter";
import type { AsterOrder } from "../src/exchanges/types";
import type { OrderLockMap, OrderTimerMap, OrderPendingMap } from "../src/core/order-coordinator";
import {
  deduplicateOrders,
  placeOrder,
  placeMarketOrder,
  placeStopLossOrder,
  placeTrailingStopOrder,
  marketClose,
  unlockOperating,
  placeAtomicDualWithStops,
} from "../src/core/order-coordinator";

const baseOrder: AsterOrder = {
  orderId: 1,
  clientOrderId: "client",
  symbol: "BTCUSDT",
  side: "BUY",
  type: "LIMIT",
  status: "NEW",
  price: "100",
  origQty: "1",
  executedQty: "0",
  stopPrice: "0",
  time: Date.now(),
  updateTime: Date.now(),
  reduceOnly: false,
  closePosition: false,
};

function createMockExchange(overrides: Partial<ExchangeAdapter> = {}): ExchangeAdapter {
  return {
    id: "mock",
    supportsTrailingStops: () => true,
    watchAccount: () => undefined,
    watchOrders: () => undefined,
    watchDepth: () => undefined,
    watchTicker: () => undefined,
    watchKlines: () => undefined,
    createOrder: vi.fn(async () => baseOrder),
    cancelOrder: vi.fn(async () => undefined),
    cancelOrders: vi.fn(async () => undefined),
    cancelAllOrders: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("order-coordinator", () => {
  it("deduplicates orders by type and side", async () => {
    const adapter = createMockExchange();
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();
    const openOrders: AsterOrder[] = [
      { ...baseOrder, orderId: 1 },
      { ...baseOrder, orderId: 2 },
    ];
    await deduplicateOrders(adapter, "BTCUSDT", openOrders, locks, timers, pending, "LIMIT", "BUY", log);
    expect(adapter.cancelOrders).toHaveBeenCalledWith({ symbol: "BTCUSDT", orderIdList: [2] });
    expect(log).toHaveBeenCalledWith("order", expect.stringContaining("去重撤销重复"));
  });

  it("places limit orders and records pending id", async () => {
    const adapter = createMockExchange();
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();
    await placeOrder(
      adapter,
      "BTCUSDT",
      [],
      locks,
      timers,
      pending,
      "BUY",
      "100",
      1,
      log,
      false
    );
    expect(adapter.createOrder).toHaveBeenCalled();
    expect(pending.MARKET).toBeUndefined();
    expect(pending["LIMIT:BUY:OPEN"]).toBe(String(baseOrder.orderId));
  });

  it("places market order and unlocks after completion", async () => {
    const adapter = createMockExchange();
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();
    await placeMarketOrder(
      adapter,
      "BTCUSDT",
      [],
      locks,
      timers,
      pending,
      "SELL",
      1,
      log,
      true
    );
    expect(adapter.createOrder).toHaveBeenCalled();
    expect(pending["MARKET:SELL:CLOSE"]).toBe(String(baseOrder.orderId));
  });

  it("places stop loss order only when valid", async () => {
    const adapter = createMockExchange();
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();
    await placeStopLossOrder(
      adapter,
      "BTCUSDT",
      [],
      locks,
      timers,
      pending,
      "SELL",
      99,
      1,
      100,
      log
    );
    expect(adapter.createOrder).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("stop", expect.stringContaining("STOP_MARKET"));
  });

  it("places trailing stop order", async () => {
    const adapter = createMockExchange();
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();
    await placeTrailingStopOrder(
      adapter,
      "BTCUSDT",
      [],
      locks,
      timers,
      pending,
      "SELL",
      101,
      1,
      0.2,
      log
    );
    expect(adapter.createOrder).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("order", expect.stringContaining("挂动态止盈单"));
  });

  it("market close cancels open orders before placing close order", async () => {
    const adapter = createMockExchange();
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();
    await marketClose(
      adapter,
      "BTCUSDT",
      [{ ...baseOrder, orderId: 2 }],
      locks,
      timers,
      pending,
      "SELL",
      1,
      log
    );
    expect(adapter.createOrder).toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("close", expect.stringContaining("市价平仓"));
  });

  it("places atomic dual with optional stops using bulk when available", async () => {
    const createdOrders: AsterOrder[] = [
      { ...baseOrder, orderId: 11, side: "BUY", price: "100", type: "LIMIT" },
      { ...baseOrder, orderId: 12, side: "SELL", price: "101", type: "LIMIT" },
      { ...baseOrder, orderId: 13, side: "SELL", type: "STOP_MARKET", stopPrice: "99" },
      { ...baseOrder, orderId: 14, side: "BUY", type: "STOP_MARKET", stopPrice: "102", },
    ];
    const adapter = createMockExchange({
      id: "grvt",
      // @ts-expect-error test-only hook
      createBulkOrders: vi.fn(async () => createdOrders),
    } as any);
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();
    const result = await placeAtomicDualWithStops(
      adapter,
      "BTCUSDT",
      [],
      locks,
      timers,
      pending,
      { price: "100", amount: 1 },
      { price: "101", amount: 1 },
      log,
      { markPrice: 100.5, maxPct: 0.1, lossLimitUsd: 1, priceTick: 0.1, qtyStep: 0.001, attachStops: true }
    );
    expect((adapter as any).createBulkOrders).toHaveBeenCalled();
    expect(result?.length).toBe(4);
    expect(log).toHaveBeenCalledWith("order", expect.stringContaining("GRVT 原子挂单"));
  });

  it("allows concurrent OPEN and CLOSE LIMIT operations (independent locks)", async () => {
    const createOrder = vi.fn(async (p: any) => ({ ...baseOrder, orderId: Math.random(), side: p.side, type: p.type, reduceOnly: p.reduceOnly === "true" } as AsterOrder));
    const adapter = createMockExchange({ createOrder } as any);
    const locks: OrderLockMap = {};
    const timers: OrderTimerMap = {};
    const pending: OrderPendingMap = {};
    const log = vi.fn();

    const p1 = placeOrder(adapter, "BTCUSDT", [], locks, timers, pending, "BUY", "100", 1, log, false);
    const p2 = placeOrder(adapter, "BTCUSDT", [], locks, timers, pending, "SELL", "101", 1, log, true);
    await Promise.all([p1, p2]);

    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(Object.keys(pending).some((k) => k.startsWith("LIMIT:BUY:OPEN"))).toBe(true);
    expect(Object.keys(pending).some((k) => k.startsWith("LIMIT:SELL:CLOSE"))).toBe(true);
  });

  it("unlockOperating clears timers and pending", () => {
    const locks: OrderLockMap = { LIMIT: true };
    const fakeTimer = {} as ReturnType<typeof setTimeout>;
    const timers: OrderTimerMap = { LIMIT: fakeTimer };
    const pending: OrderPendingMap = { LIMIT: "123" };
    unlockOperating(locks, timers, pending, "LIMIT");
    expect(locks.LIMIT).toBe(false);
    expect(pending.LIMIT).toBeNull();
    expect(timers.LIMIT).toBeNull();
  });
});
