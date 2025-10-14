import { describe, expect, it } from "vitest";
import { shouldStopLoss } from "../src/utils/risk";
import type { PositionSnapshot } from "../src/utils/strategy";

const posLong: PositionSnapshot = { positionAmt: 1, entryPrice: 100, unrealizedProfit: 0, markPrice: null };
const posShort: PositionSnapshot = { positionAmt: -1, entryPrice: 100, unrealizedProfit: 0, markPrice: null };

describe("shouldStopLoss ignores non-positive close price", () => {
  it("returns false when bid/ask is 0", () => {
    expect(shouldStopLoss(posLong, 0 as any, 101, 1)).toBe(false);
    expect(shouldStopLoss(posShort, 99, 0 as any, 1)).toBe(false);
  });

  it("evaluates when close price is positive", () => {
    expect(shouldStopLoss(posLong, 90, 91, 5)).toBe(true);
    expect(shouldStopLoss(posShort, 109, 110, 5)).toBe(true);
  });
});
