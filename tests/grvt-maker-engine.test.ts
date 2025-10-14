import { describe, it, expect, vi } from "vitest";
import { GrvtMakerEngine } from "../src/strategy/grvt-maker-engine";
import type { ExchangeAdapter } from "../src/exchanges/adapter";
import type { MakerConfig } from "../src/config";

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
