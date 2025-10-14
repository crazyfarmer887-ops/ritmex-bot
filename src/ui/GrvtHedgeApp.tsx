import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { GrvtHedgeUI } from "./grvt-hedge-ui";
import { GrvtHedgeEngine, type GrvtHedgeSnapshot } from "../strategy/grvt-hedge-engine";
import { buildAdapterFromEnv } from "../exchanges/resolve-from-env";
import { resolveExchangeId } from "../exchanges/create-adapter";

const GRVT_HEDGE_CONFIG = {
  symbol: process.env.GRVT_SYMBOL || "BTCUSDT",
  tradeAmount: Number(process.env.GRVT_TRADE_AMOUNT || "0.001"),
  spreadPct: Number(process.env.GRVT_SPREAD_PCT || "0.5"), // 0.5% spread
  stopLossPct: Number(process.env.GRVT_STOP_LOSS_PCT || "2"), // 2% stop loss
  priceTick: Number(process.env.GRVT_PRICE_TICK || "0.1"),
  qtyStep: Number(process.env.GRVT_QTY_STEP || "0.0001"),
  logContext: "GrvtHedge"
};

export function GrvtHedgeApp({ onExit }: { onExit: () => void }) {
  const [snapshot, setSnapshot] = useState<GrvtHedgeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<GrvtHedgeEngine | null>(null);

  useEffect(() => {
    const exchangeId = resolveExchangeId();
    if (exchangeId !== "grvt") {
      setError("GRVT Hedge strategy requires GRVT exchange (set EXCHANGE=grvt)");
      return;
    }

    try {
      const adapter = buildAdapterFromEnv({ exchangeId: "grvt", symbol: GRVT_HEDGE_CONFIG.symbol });
      const hedgeEngine = new GrvtHedgeEngine(adapter, GRVT_HEDGE_CONFIG);
      
      hedgeEngine.events.on("update", (snap: GrvtHedgeSnapshot) => {
        setSnapshot(snap);
      });

      setEngine(hedgeEngine);
      hedgeEngine.start();
      setSnapshot(hedgeEngine.getSnapshot());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }

    return () => {
      if (engine) {
        engine.stop();
      }
    };
  }, []);

  useInput((input) => {
    if (input === "q" || input === "Q") {
      if (engine) {
        engine.stop();
      }
      onExit();
    } else if (input === "s" || input === "S") {
      if (engine) {
        if (snapshot?.running) {
          engine.stop();
        } else {
          engine.start();
        }
      }
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">오류: {error}</Text>
        <Text color="gray">Q를 눌러 종료하세요.</Text>
      </Box>
    );
  }

  if (!snapshot) {
    return (
      <Box padding={1}>
        <Text color="gray">GRVT 헤지 전략 초기화 중...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <GrvtHedgeUI snapshot={snapshot} />
      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="gray">
          [S] 시작/중지 | [Q] 종료 | Spread: {GRVT_HEDGE_CONFIG.spreadPct}% | StopLoss: {GRVT_HEDGE_CONFIG.stopLossPct}%
        </Text>
      </Box>
    </Box>
  );
}