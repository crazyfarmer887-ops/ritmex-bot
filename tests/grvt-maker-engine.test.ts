import { describe, it, expect, vi } from "vitest";
import { GrvtMakerEngine } from "../src/strategy/grvt-maker-engine";
import type { ExchangeAdapter } from "../src/exchanges/adapter";
import type { MakerConfig } from "../src/config";
import type { AsterOrder, AsterAccountSnapshot, AsterDepth, AsterTicker } from "../src/exchanges/types";

describe("GrvtMakerEngine", () => {
  it("should instantiate with valid config and adapter", () => {
    const mockAdapter: ExchangeAdapter = {
      id: "grvt",
      supportsTrailingStops: () => false,
      watchAccount: vi.fn(),
      watchOrders: vi.fn(),
      watchDepth: vi.fn(),
      watchTicker: vi.fn(),
      watchKlines: vi.fn(),
      createOrder: vi.fn(),
      cancelOrder: vi.fn(),
      cancelOrders: vi.fn(),
      cancelAllOrders: vi.fn(),
    };

    const config: MakerConfig = {
      symbol: "BTC_USDT_Perp",
      tradeAmount: 0.001,
      bidOffset: 0.5,
      askOffset: 0.5,
      lossLimit: 10,
      priceTick: 0.01,
      maxCloseSlippagePct: 0.05,
      refreshIntervalMs: 1000,
      maxLogEntries: 50,
    };

    const engine = new GrvtMakerEngine(config, mockAdapter);
    expect(engine).toBeDefined();
    expect(engine.getSnapshot).toBeDefined();
    expect(engine.start).toBeDefined();
    expect(engine.stop).toBeDefined();
    expect(engine.on).toBeDefined();
    expect(engine.off).toBeDefined();
  });

  it("should have correct initial snapshot state", () => {
    const mockAdapter: ExchangeAdapter = {
      id: "grvt",
      supportsTrailingStops: () => false,
      watchAccount: vi.fn(),
      watchOrders: vi.fn(),
      watchDepth: vi.fn(),
      watchTicker: vi.fn(),
      watchKlines: vi.fn(),
      createOrder: vi.fn(),
      cancelOrder: vi.fn(),
      cancelOrders: vi.fn(),
      cancelAllOrders: vi.fn(),
    };

    const config: MakerConfig = {
      symbol: "BTC_USDT_Perp",
      tradeAmount: 0.001,
      bidOffset: 0.5,
      askOffset: 0.5,
      lossLimit: 10,
      priceTick: 0.01,
      maxCloseSlippagePct: 0.05,
      refreshIntervalMs: 1000,
      maxLogEntries: 50,
    };

    const engine = new GrvtMakerEngine(config, mockAdapter);
    const snapshot = engine.getSnapshot();

    expect(snapshot).toBeDefined();
    expect(snapshot.ready).toBe(false); // Not ready until feeds arrive
    expect(snapshot.symbol).toBe("BTC_USDT_Perp");
    expect(snapshot.openOrders).toEqual([]);
    expect(snapshot.desiredOrders).toEqual([]);
    expect(snapshot.tradeLog).toEqual([]);
    expect(snapshot.feedStatus.account).toBe(false);
    expect(snapshot.feedStatus.orders).toBe(false);
    expect(snapshot.feedStatus.depth).toBe(false);
    expect(snapshot.feedStatus.ticker).toBe(false);
  });

  it("places TP ladder when position exists and cancels all on flatten", async () => {
    const listeners: any = { account: null, orders: null, depth: null, ticker: null };
    const createdOrders: AsterOrder[] = [];
    const mockAdapter: ExchangeAdapter = {
      id: "grvt",
      supportsTrailingStops: () => false,
      watchAccount: (cb) => { listeners.account = cb; },
      watchOrders: (cb) => { listeners.orders = cb; },
      watchDepth: (_symbol, cb) => { listeners.depth = cb; },
      watchTicker: (_symbol, cb) => { listeners.ticker = cb; },
      watchKlines: vi.fn(),
      createOrder: vi.fn(async (params) => {
        const order: AsterOrder = {
          orderId: Math.floor(Math.random() * 1e6),
          clientOrderId: "",
          symbol: "BTC_USDT_Perp",
          side: params.side,
          type: params.type,
          status: "NEW",
          price: String(params.price ?? 0),
          origQty: String(params.quantity ?? 0),
          executedQty: "0",
          stopPrice: String(params.stopPrice ?? 0),
          time: Date.now(),
          updateTime: Date.now(),
          reduceOnly: params.reduceOnly === "true",
          closePosition: params.closePosition === "true",
          timeInForce: params.timeInForce,
        };
        createdOrders.push(order);
        // notify into orders stream
        if (listeners.orders) listeners.orders(createdOrders.slice());
        return order;
      }),
      cancelOrder: vi.fn(async () => undefined),
      cancelOrders: vi.fn(async () => undefined),
      cancelAllOrders: vi.fn(async () => { createdOrders.length = 0; if (listeners.orders) listeners.orders([]); }),
    } as unknown as ExchangeAdapter;

    const config: MakerConfig = {
      symbol: "BTC_USDT_Perp",
      tradeAmount: 0.01,
      bidOffset: 0,
      askOffset: 0,
      lossLimit: 10,
      priceTick: 0.01,
      maxCloseSlippagePct: 0.2,
      refreshIntervalMs: 10,
      maxLogEntries: 200,
      tpLadderStartUsd: 0.01,
      tpLadderStepUsd: 0.01,
      tpLadderCount: 3,
    } as any;

    const engine = new GrvtMakerEngine(config, mockAdapter);
    // feed readiness
    const account: AsterAccountSnapshot = {
      canTrade: true,
      canDeposit: true,
      canWithdraw: true,
      updateTime: Date.now(),
      totalWalletBalance: "0",
      totalUnrealizedProfit: "0",
      positions: [ { symbol: config.symbol, positionAmt: "1", entryPrice: "100", unrealizedProfit: "0", positionSide: "BOTH", updateTime: Date.now(), markPrice: "100" } ],
      assets: [],
    } as any;
    const depth: AsterDepth = { lastUpdateId: 1, bids: [["99.9","1"]], asks: [["100.1","1"]] } as any;
    const ticker: AsterTicker = { symbol: config.symbol, lastPrice: "100.0", openPrice: "", highPrice: "", lowPrice: "", volume: "", quoteVolume: "" } as any;
    // emit initial snapshots
    listeners.account && listeners.account(account);
    listeners.orders && listeners.orders([]);
    listeners.depth && listeners.depth(depth);
    listeners.ticker && listeners.ticker(ticker);

    // force a few ticks to process desired -> placement
    await (engine as any).tick();
    await (engine as any).tick();
    await (engine as any).tick();

    // Expect at least one reduce-only SELL TP placed (engine places 1 per tick)
    const sellLimits = createdOrders.filter((o) => o.type === "LIMIT" && o.side === "SELL");
    expect(sellLimits.length).toBeGreaterThanOrEqual(1);
    // flatten position -> simulate account position to 0
    const flatAccount: AsterAccountSnapshot = { ...account, positions: [] } as any;
    listeners.account && listeners.account(flatAccount);
    // allow position change handler to run via tick
    await (engine as any).tick();
    // engine should cancel all remaining orders via cancelAllOrders
    expect((mockAdapter.cancelAllOrders as any).mock.calls.length).toBeGreaterThan(0);
  });

  it("should expose event emitter interface", () => {
    const mockAdapter: ExchangeAdapter = {
      id: "grvt",
      supportsTrailingStops: () => false,
      watchAccount: vi.fn(),
      watchOrders: vi.fn(),
      watchDepth: vi.fn(),
      watchTicker: vi.fn(),
      watchKlines: vi.fn(),
      createOrder: vi.fn(),
      cancelOrder: vi.fn(),
      cancelOrders: vi.fn(),
      cancelAllOrders: vi.fn(),
    };

    const config: MakerConfig = {
      symbol: "BTC_USDT_Perp",
      tradeAmount: 0.001,
      bidOffset: 0.5,
      askOffset: 0.5,
      lossLimit: 10,
      priceTick: 0.01,
      maxCloseSlippagePct: 0.05,
      refreshIntervalMs: 1000,
      maxLogEntries: 50,
    };

    const engine = new GrvtMakerEngine(config, mockAdapter);
    const mockListener = vi.fn();

    engine.on("update", mockListener);
    engine.off("update", mockListener);

    // No assertions needed, just verifying the interface exists
    expect(true).toBe(true);
  });
});
