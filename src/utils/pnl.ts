import type { PositionSnapshot } from "./strategy";

export function computePositionPnl(
  position: PositionSnapshot,
  bestBid?: number | null,
  bestAsk?: number | null
): number {
  let priceForPnl = position.positionAmt > 0 ? bestBid : bestAsk;
  // When quotes are zero/negative or missing, try falling back to markPrice; otherwise return 0
  if (!Number.isFinite(priceForPnl as number) || (priceForPnl as number) <= 0) {
    priceForPnl = position.markPrice;
  }
  if (!Number.isFinite(priceForPnl as number) || (priceForPnl as number) <= 0) return 0;
  const absAmt = Math.abs(position.positionAmt);
  return position.positionAmt > 0
    ? ((priceForPnl as number) - position.entryPrice) * absAmt
    : (position.entryPrice - (priceForPnl as number)) * absAmt;
}


