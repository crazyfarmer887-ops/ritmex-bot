import { describe, expect, it } from "vitest";
import { getTopPrices } from "../src/utils/price";
import type { AsterDepth } from "../src/exchanges/types";

describe("getTopPrices sanitizes zero/non-positive top-of-book", () => {
  it("returns null when bid or ask is 0 or negative", () => {
    const depth: AsterDepth = {
      lastUpdateId: 1,
      bids: [["0", "1"]],
      asks: [["100", "1"]],
    } as any;
    const r1 = getTopPrices(depth);
    expect(r1.topBid).toBeNull();
    expect(r1.topAsk).toBe(100);

    const depth2: AsterDepth = {
      lastUpdateId: 1,
      bids: [["100", "1"]],
      asks: [["0", "1"]],
    } as any;
    const r2 = getTopPrices(depth2);
    expect(r2.topBid).toBe(100);
    expect(r2.topAsk).toBeNull();

    const depth3: AsterDepth = {
      lastUpdateId: 1,
      bids: [["-1", "1"]],
      asks: [["-2", "1"]],
    } as any;
    const r3 = getTopPrices(depth3);
    expect(r3.topBid).toBeNull();
    expect(r3.topAsk).toBeNull();
  });
});
