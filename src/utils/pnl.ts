import type { PositionSnapshot } from "./strategy";

export function computePositionPnl(
  position: PositionSnapshot,
  bestBid?: number | null,
  bestAsk?: number | null
): number {
  const priceForPnl = position.positionAmt > 0 ? bestBid : bestAsk;
  const priceNum = Number(priceForPnl);
  // Guard: invalid or non-positive reference price yields 0 PnL
  if (!Number.isFinite(priceNum) || priceNum <= 0) return 0;
  const absAmt = Math.abs(position.positionAmt);
  return position.positionAmt > 0
    ? (priceNum - position.entryPrice) * absAmt
    : (position.entryPrice - priceNum) * absAmt;
}


