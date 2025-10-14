import { describe, expect, it } from "vitest";
import { computePositionPnl } from "../src/utils/pnl";
import type { PositionSnapshot } from "../src/utils/strategy";

const posLong: PositionSnapshot = { positionAmt: 1, entryPrice: 100, unrealizedProfit: 0, markPrice: null };
const posShort: PositionSnapshot = { positionAmt: -1, entryPrice: 100, unrealizedProfit: 0, markPrice: null };

describe("computePositionPnl guards against zero/invalid prices", () => {
  it("returns 0 when bid/ask is 0 or invalid", () => {
    expect(computePositionPnl(posLong, 0, 101)).toBe(0);
    expect(computePositionPnl(posLong, null as any, 101)).toBe(0);
    expect(computePositionPnl(posLong, NaN as any, 101)).toBe(0);

    expect(computePositionPnl(posShort, 99, 0)).toBe(0);
    expect(computePositionPnl(posShort, 99, null as any)).toBe(0);
    expect(computePositionPnl(posShort, 99, NaN as any)).toBe(0);
  });

  it("computes pnl when valid positive price provided", () => {
    expect(computePositionPnl(posLong, 110, 111)).toBeCloseTo(10, 8);
    // For short positions, PnL references bestAsk; set ask to 90
    expect(computePositionPnl(posShort, 90, 90)).toBeCloseTo(10, 8);
  });
});
