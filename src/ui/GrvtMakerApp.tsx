import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { GrvtMakerEngine, type GrvtMakerEngineSnapshot } from "../strategy/grvt-maker-engine";
import { makerConfig } from "../config";
import { buildAdapterFromEnv } from "../exchanges/resolve-from-env";
import { resolveExchangeId } from "../exchanges/create-adapter";
import { loadCopyrightFragments, verifyCopyrightIntegrity } from "../utils/copyright";
import { formatPrice } from "../utils/format";

interface GrvtMakerAppProps {
  onExit: () => void;
}

export function GrvtMakerApp({ onExit }: GrvtMakerAppProps) {
  const exchangeId = useMemo(() => resolveExchangeId(), []);
  const config = useMemo(() => makerConfig, []);
  const adapter = useMemo(() => buildAdapterFromEnv({ exchangeId, symbol: config.symbol }), [exchangeId, config.symbol]);
  const engine = useMemo(() => new GrvtMakerEngine(config, adapter), [config, adapter]);
  const [snapshot, setSnapshot] = useState<GrvtMakerEngineSnapshot | null>(null);
  const copyright = useMemo(() => loadCopyrightFragments(), []);
  const integrityOk = useMemo(() => verifyCopyrightIntegrity(), []);

  useEffect(() => {
    const handler = (snap: GrvtMakerEngineSnapshot) => setSnapshot(snap);
    engine.on("update", handler);
    engine.start();
    const initial = engine.getSnapshot();
    if (initial) setSnapshot(initial);
    return () => {
      engine.stop();
      engine.off("update", handler);
    };
  }, [engine]);

  if (!snapshot) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">🔄 GRVT 마켓 메이킹 전략 로딩 중...</Text>
      </Box>
    );
  }

  const { position, openOrders, desiredOrders, tradeLog, topBid, topAsk, spread, pnl, accountUnrealized, sessionVolume, feedStatus } =
    snapshot;

  const posAbs = Math.abs(position.positionAmt);
  const posLabel = position.positionAmt > 0 ? "📈 롱" : position.positionAmt < 0 ? "📉 숏" : "평탄";
  const posColor = position.positionAmt > 0 ? "green" : position.positionAmt < 0 ? "red" : "gray";

  // 找出止损单
  const stopOrders = openOrders.filter((o) => {
    const hasStopPrice = Number.isFinite(Number(o.stopPrice)) && Number(o.stopPrice) > 0;
    return String(o.type).toUpperCase() === "STOP_MARKET" || hasStopPrice;
  });

  // 找出入场单
  const entryOrders = openOrders.filter((o) => {
    const hasStopPrice = Number.isFinite(Number(o.stopPrice)) && Number(o.stopPrice) > 0;
    const isStop = String(o.type).toUpperCase() === "STOP_MARKET" || hasStopPrice;
    return !isStop && !o.reduceOnly;
  });

  // 找出平仓单
  const closeOrders = openOrders.filter((o) => {
    const hasStopPrice = Number.isFinite(Number(o.stopPrice)) && Number(o.stopPrice) > 0;
    const isStop = String(o.type).toUpperCase() === "STOP_MARKET" || hasStopPrice;
    return !isStop && o.reduceOnly;
  });

  const feedStatusText = [
    feedStatus.account ? "✓계정" : "✗계정",
    feedStatus.orders ? "✓주문" : "✗주문",
    feedStatus.depth ? "✓호가" : "✗호가",
    feedStatus.ticker ? "✓시세" : "✗시세",
  ].join(" ");

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╔══════════════════════════════════════════════════════════════╗
        </Text>
      </Box>
      <Box marginBottom={1} paddingLeft={2}>
        <Text bold color="cyan">
          GRVT 마켓 메이킹 전략 (동기화 매매 + 자동 손절)
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╚══════════════════════════════════════════════════════════════╝
        </Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Text>
          심볼: <Text color="white">{snapshot.symbol}</Text> | 데이터 상태: {feedStatusText}
        </Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Box flexDirection="column">
          <Text>
            <Text color="green">최고매수: {topBid != null ? formatPrice(topBid) : "N/A"}</Text>
            {"  "}
            <Text color="red">최저매도: {topAsk != null ? formatPrice(topAsk) : "N/A"}</Text>
            {"  "}
            <Text color="yellow">스프레드: {spread != null ? formatPrice(spread) : "N/A"}</Text>
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text bold color="cyan">
          ─────────────────────────────────────────────────────────────
        </Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Box flexDirection="column">
          <Text>
            포지션: <Text color={posColor}>{posLabel}</Text> {posAbs.toFixed(4)} | 
            평균가: {formatPrice(position.entryPrice)} | 
            PnL: <Text color={pnl >= 0 ? "green" : "red"}>{pnl.toFixed(4)}</Text>
          </Text>
          <Text>
            계정 총 미실현손익: <Text color={accountUnrealized >= 0 ? "green" : "red"}>{accountUnrealized.toFixed(4)}</Text> | 
            총 거래량: {sessionVolume.toFixed(4)}
          </Text>
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text bold color="cyan">
          ─────────────────────────────────────────────────────────────
        </Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Box flexDirection="column">
          <Text bold color="magenta">
            진입 주문 ({entryOrders.length}):
          </Text>
          {entryOrders.length > 0 ? (
            entryOrders.map((o) => (
              <Text key={o.orderId}>
                  {o.side === "BUY" ? "🟢" : "🔴"} {o.side} @ {formatPrice(Number(o.price))} | 수량: {Number(o.origQty).toFixed(4)}
              </Text>
            ))
          ) : (
            <Text color="gray">진입 주문 없음</Text>
          )}
        </Box>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Box flexDirection="column">
          <Text bold color="yellow">
            손절 주문 ({stopOrders.length}):
          </Text>
          {stopOrders.length > 0 ? (
            stopOrders.map((o) => (
              <Text key={o.orderId}>
                  🛑 {o.side} STOP @ {formatPrice(Number(o.stopPrice))} | 수량: {Number(o.origQty).toFixed(4)}
              </Text>
            ))
          ) : (
            <Text color="gray">손절 주문 없음</Text>
          )}
        </Box>
      </Box>

      {closeOrders.length > 0 && (
        <Box marginBottom={1} paddingLeft={2}>
          <Box flexDirection="column">
            <Text bold color="blue">
              청산 주문 ({closeOrders.length}):
            </Text>
            {closeOrders.map((o) => (
              <Text key={o.orderId}>
                  {o.side === "BUY" ? "🟢" : "🔴"} {o.side} @ {formatPrice(Number(o.price))} | 수량: {Number(o.origQty).toFixed(4)} (RO)
              </Text>
            ))}
          </Box>
        </Box>
      )}

      <Box marginBottom={1}>
        <Text bold color="cyan">
          ─────────────────────────────────────────────────────────────
        </Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Box flexDirection="column">
          <Text bold color="white">
            전략 로그 (최근 {tradeLog.length}건):
          </Text>
          {tradeLog.slice(-8).map((entry, idx) => {
            const typeColor =
              entry.type === "error"
                ? "red"
                : entry.type === "warn"
                ? "yellow"
                : entry.type === "stop"
                ? "magenta"
                : entry.type === "order"
                ? "cyan"
                : entry.type === "close"
                ? "blue"
                : "white";
            const time = new Date(entry.timestamp).toLocaleTimeString("zh-CN");
            return (
              <Text key={idx} color={typeColor}>
                [{time}] {entry.detail}
              </Text>
            );
          })}
        </Box>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">{copyright.bannerText}</Text>
        {integrityOk ? null : (
          <Text color="red">警告: 版权校验失败，当前版本可能被篡改。</Text>
        )}
      </Box>
    </Box>
  );
}
