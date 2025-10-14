import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";
import { GrvtMakerEngine, type GrvtMakerEngineSnapshot } from "../strategy/grvt-maker-engine";
import { makerConfig } from "../config";
import { buildAdapterFromEnv } from "../exchanges/resolve-from-env";
import { resolveExchangeId } from "../exchanges/create-adapter";
import { renderCopyright } from "../utils/copyright";
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
        <Text color="yellow">加载 GRVT Maker 策略...</Text>
      </Box>
    );
  }

  const { position, openOrders, desiredOrders, tradeLog, topBid, topAsk, spread, pnl, accountUnrealized, sessionVolume, feedStatus } =
    snapshot;

  const posAbs = Math.abs(position.positionAmt);
  const posLabel = position.positionAmt > 0 ? "多" : position.positionAmt < 0 ? "空" : "平";
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
    feedStatus.account ? "✓账户" : "✗账户",
    feedStatus.orders ? "✓订单" : "✗订单",
    feedStatus.depth ? "✓深度" : "✗深度",
    feedStatus.ticker ? "✓行情" : "✗行情",
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
          GRVT Maker 策略 (同步买卖 + 自动止损)
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          ╚══════════════════════════════════════════════════════════════╝
        </Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Text>
          币对: <Text color="white">{snapshot.symbol}</Text> | 数据源: {feedStatusText}
        </Text>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Box flexDirection="column">
          <Text>
            <Text color="green">买价: {topBid != null ? formatPrice(topBid) : "N/A"}</Text>
            {"  "}
            <Text color="red">卖价: {topAsk != null ? formatPrice(topAsk) : "N/A"}</Text>
            {"  "}
            <Text color="yellow">价差: {spread != null ? formatPrice(spread) : "N/A"}</Text>
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
            持仓: <Text color={posColor}>{posLabel}</Text> {posAbs.toFixed(4)} | 
            均价: {formatPrice(position.entryPrice)} | 
            PnL: <Text color={pnl >= 0 ? "green" : "red"}>{pnl.toFixed(4)}</Text>
          </Text>
          <Text>
            账户总未实现盈亏: <Text color={accountUnrealized >= 0 ? "green" : "red"}>{accountUnrealized.toFixed(4)}</Text> | 
            本次交易量: {sessionVolume.toFixed(4)}
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
            入场单 ({entryOrders.length}):
          </Text>
          {entryOrders.length > 0 ? (
            entryOrders.map((o) => (
              <Text key={o.orderId}>
                  {o.side === "BUY" ? "🟢" : "🔴"} {o.side} @ {formatPrice(Number(o.price))} | 数量: {Number(o.origQty).toFixed(4)}
              </Text>
            ))
          ) : (
            <Text color="gray">无入场挂单</Text>
          )}
        </Box>
      </Box>

      <Box marginBottom={1} paddingLeft={2}>
        <Box flexDirection="column">
          <Text bold color="yellow">
            止损单 ({stopOrders.length}):
          </Text>
          {stopOrders.length > 0 ? (
            stopOrders.map((o) => (
              <Text key={o.orderId}>
                  🛑 {o.side} STOP @ {formatPrice(Number(o.stopPrice))} | 数量: {Number(o.origQty).toFixed(4)}
              </Text>
            ))
          ) : (
            <Text color="gray">无止损单</Text>
          )}
        </Box>
      </Box>

      {closeOrders.length > 0 && (
        <Box marginBottom={1} paddingLeft={2}>
          <Box flexDirection="column">
            <Text bold color="blue">
              平仓单 ({closeOrders.length}):
            </Text>
            {closeOrders.map((o) => (
              <Text key={o.orderId}>
                  {o.side === "BUY" ? "🟢" : "🔴"} {o.side} @ {formatPrice(Number(o.price))} | 数量: {Number(o.origQty).toFixed(4)} (RO)
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
            策略日志 (最近 {tradeLog.length} 条):
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

      <Box marginTop={1}>{renderCopyright()}</Box>
    </Box>
  );
}
