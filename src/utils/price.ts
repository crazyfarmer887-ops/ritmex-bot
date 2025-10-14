import type { AsterDepth, AsterTicker } from "../exchanges/types";

export function getTopPrices(depth?: AsterDepth | null): { topBid: number | null; topAsk: number | null } {
  const bid = Number(depth?.bids?.[0]?.[0]);
  const ask = Number(depth?.asks?.[0]?.[0]);
  // Treat non-positive or invalid prices as unavailable
  const sanitizedBid = Number.isFinite(bid) && bid > 0 ? bid : null;
  const sanitizedAsk = Number.isFinite(ask) && ask > 0 ? ask : null;
  return {
    topBid: sanitizedBid,
    topAsk: sanitizedAsk,
  };
}

export function getMidOrLast(depth?: AsterDepth | null, ticker?: AsterTicker | null): number | null {
  const { topBid, topAsk } = getTopPrices(depth);
  if (topBid != null && topAsk != null) return (topBid + topAsk) / 2;
  const last = Number(ticker?.lastPrice);
  return Number.isFinite(last) ? last : null;
}


