import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { tradingConfig } from "../config";
import { getExchangeDisplayName, resolveExchangeId } from "../exchanges/create-adapter";
import { buildAdapterFromEnv } from "../exchanges/resolve-from-env";
import { TrendEngine, type TrendEngineSnapshot } from "../strategy/trend-engine";
import { formatNumber } from "../utils/format";
import { DataTable, type TableColumn } from "./components/DataTable";

const READY_MESSAGE = "거래소 데이터 대기 중…";

interface TrendAppProps {
  onExit: () => void;
}

const inputSupported = Boolean(process.stdin && (process.stdin as any).isTTY);

export function TrendApp({ onExit }: TrendAppProps) {
  const [snapshot, setSnapshot] = useState<TrendEngineSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const engineRef = useRef<TrendEngine | null>(null);
  const exchangeId = useMemo(() => resolveExchangeId(), []);
  const exchangeName = useMemo(() => getExchangeDisplayName(exchangeId), [exchangeId]);

  useInput(
    (input, key) => {
      if (key.escape) {
        engineRef.current?.stop();
        onExit();
      }
    },
    { isActive: inputSupported }
  );

  useEffect(() => {
    try {
      const adapter = buildAdapterFromEnv({ exchangeId, symbol: tradingConfig.symbol });
      const engine = new TrendEngine(tradingConfig, adapter);
      engineRef.current = engine;
      setSnapshot(engine.getSnapshot());
      const handler = (next: TrendEngineSnapshot) => {
        setSnapshot({ ...next, tradeLog: [...next.tradeLog] });
      };
      engine.on("update", handler);
      engine.start();
      return () => {
        engine.off("update", handler);
        engine.stop();
      };
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, [exchangeId]);

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">시작 실패: {error.message}</Text>
        <Text color="gray">환경 변수와 네트워크 연결을 확인하세요.</Text>
      </Box>
    );
  }

  if (!snapshot) {
    return (
      <Box padding={1}>
        <Text>추세 전략 초기화 중…</Text>
      </Box>
    );
  }

  const { position, tradeLog, openOrders, trend, ready, lastPrice, sma30, sessionVolume } = snapshot;
  const hasPosition = Math.abs(position.positionAmt) > 1e-5;
  const lastLogs = tradeLog.slice(-5);
  const sortedOrders = [...openOrders].sort((a, b) => (Number(b.updateTime ?? 0) - Number(a.updateTime ?? 0)) || Number(b.orderId) - Number(a.orderId));
  const orderRows = sortedOrders.slice(0, 8).map((order) => ({
    id: order.orderId,
    side: order.side,
    type: order.type,
    price: order.price,
    qty: order.origQty,
    filled: order.executedQty,
    status: order.status,
  }));
  const orderColumns: TableColumn[] = [
    { key: "id", header: "ID", align: "right", minWidth: 6 },
    { key: "side", header: "Side", minWidth: 4 },
    { key: "type", header: "Type", minWidth: 10 },
    { key: "price", header: "Price", align: "right", minWidth: 10 },
    { key: "qty", header: "Qty", align: "right", minWidth: 8 },
    { key: "filled", header: "Filled", align: "right", minWidth: 8 },
    { key: "status", header: "Status", minWidth: 10 },
  ];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyanBright">추세 전략 대시보드</Text>
        <Text>
          거래소: {exchangeName} ｜ 거래쌍: {snapshot.symbol} ｜ 최근 가격: {formatNumber(lastPrice, 2)} ｜ SMA30: {formatNumber(sma30, 2)} ｜ 추세: {trend}
        </Text>
        <Text color="gray">상태: {ready ? "실시간" : READY_MESSAGE} ｜ Esc 로 전략 선택으로 돌아가기</Text>
      </Box>

      <Box flexDirection="row" marginBottom={1}>
        <Box flexDirection="column" marginRight={4}>
          <Text color="greenBright">포지션</Text>
          {hasPosition ? (
            <>
              <Text>
                방향: {position.positionAmt > 0 ? "롱" : "숏"} ｜ 수량: {formatNumber(Math.abs(position.positionAmt), 4)} ｜ 진입가: {formatNumber(position.entryPrice, 2)}
              </Text>
              <Text>
                미실현 손익: {formatNumber(snapshot.pnl, 4)} USDT ｜ 계정 미실현손익: {formatNumber(snapshot.unrealized, 4)} USDT
              </Text>
            </>
          ) : (
            <Text color="gray">현재 포지션 없음</Text>
          )}
        </Box>
        <Box flexDirection="column">
          <Text color="greenBright">성과</Text>
          <Text>
            누적 거래 수: {snapshot.totalTrades} ｜ 누적 수익: {formatNumber(snapshot.totalProfit, 4)} USDT
          </Text>
          <Text>
            누적 체결량: {formatNumber(sessionVolume, 2)} USDT
          </Text>
          {snapshot.lastOpenSignal.side ? (
            <Text color="gray">
              최근 진입 신호: {snapshot.lastOpenSignal.side} @ {formatNumber(snapshot.lastOpenSignal.price, 2)}
            </Text>
          ) : null}
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow">현재 지정가</Text>
        {orderRows.length > 0 ? (
          <DataTable columns={orderColumns} rows={orderRows} />
        ) : (
          <Text color="gray">지정가 없음</Text>
        )}
      </Box>

      <Box flexDirection="column">
        <Text color="yellow">최근 거래 및 이벤트</Text>
        {lastLogs.length > 0 ? (
          lastLogs.map((item, index) => (
            <Text key={`${item.time}-${index}`}>
              [{item.time}] [{item.type}] {item.detail}
            </Text>
          ))
        ) : (
          <Text color="gray">로그 없음</Text>
        )}
      </Box>
    </Box>
  );
}
