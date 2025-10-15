import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { makerConfig } from "../config";
import { getExchangeDisplayName, resolveExchangeId } from "../exchanges/create-adapter";
import { buildAdapterFromEnv } from "../exchanges/resolve-from-env";
import { VolumeMakerEngine, type VolumeMakerEngineSnapshot } from "../strategy/volume-maker-engine";
import { DataTable, type TableColumn } from "./components/DataTable";
import { formatNumber, formatTimestamp } from "../utils/format";

interface VolumeMakerAppProps {
  onExit: () => void;
}

const inputSupported = Boolean(process.stdin && (process.stdin as any).isTTY);

export function VolumeMakerApp({ onExit }: VolumeMakerAppProps) {
  const [snapshot, setSnapshot] = useState<VolumeMakerEngineSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const engineRef = useRef<VolumeMakerEngine | null>(null);
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
      const adapter = buildAdapterFromEnv({ exchangeId, symbol: makerConfig.symbol });
      const engine = new VolumeMakerEngine(makerConfig, adapter);
      engineRef.current = engine;
      setSnapshot(engine.getSnapshot());
      const handler = (next: VolumeMakerEngineSnapshot) => {
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
        <Text>볼륨 메이커 전략 초기화 중…</Text>
      </Box>
    );
  }

  const formatPrice = (price: number | null): string => {
    return price != null ? formatNumber(price, 4) : "-";
  };

  const formatVolume = (volume: number): string => {
    return formatNumber(volume, 4);
  };

  const formatFee = (fee: number): string => {
    if (fee < 0) {
      return `${formatNumber(Math.abs(fee), 4)} (리베이트)`;
    }
    return formatNumber(fee, 4);
  };

  const spreadTicks = snapshot.topBid != null && snapshot.topAsk != null 
    ? (snapshot.topAsk - snapshot.topBid) / makerConfig.priceTick 
    : null;

  const positionSide = snapshot.position.positionAmt > 0 ? "롱" : snapshot.position.positionAmt < 0 ? "숏" : "무";
  const positionColor = snapshot.position.positionAmt > 0 ? "blue" : snapshot.position.positionAmt < 0 ? "red" : "gray";
  const pnlColor = snapshot.pnl > 0 ? "green" : snapshot.pnl < 0 ? "red" : "gray";
  const feeColor = snapshot.feeStats.netFees < 0 ? "green" : "red";

  const lastLogs = snapshot.tradeLog.slice(-8);
  const feedStatus = snapshot.feedStatus;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyanBright">볼륨 메이커 전략 - 거래량 극대화 + 네거티브 수수료</Text>
        <Text>
          거래소: {exchangeName} ｜ 거래쌍: {snapshot.symbol} ｜ 
          매수: {formatPrice(snapshot.topBid)} ｜ 매도: {formatPrice(snapshot.topAsk)} ｜ 
          스프레드: {spreadTicks != null ? `${spreadTicks.toFixed(1)} ticks` : "-"}
        </Text>
        <Text color="gray">
          상태: {snapshot.ready ? "실시간" : "대기"} ｜ 
          계정: {feedStatus.account ? "✓" : "✗"} 
          주문: {feedStatus.orders ? "✓" : "✗"} 
          호가: {feedStatus.depth ? "✓" : "✗"} 
          시세: {feedStatus.ticker ? "✓" : "✗"} ｜ 
          Esc: 종료
        </Text>
      </Box>

      <Box flexDirection="row" marginBottom={1} gap={4}>
        <Box flexDirection="column">
          <Text color="greenBright">포지션 상태</Text>
          <Text>
            방향: <Text color={positionColor}>{positionSide}</Text> ｜ 
            수량: {formatVolume(Math.abs(snapshot.position.positionAmt))} ｜ 
            진입가: {formatPrice(snapshot.position.entryPrice)}
          </Text>
          <Text>
            PnL: <Text color={pnlColor}>{formatNumber(snapshot.pnl, 2)} USDT</Text> ｜ 
            계정 미실현: {formatNumber(snapshot.accountUnrealized, 2)} USDT
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text color="greenBright">거래량 통계</Text>
          <Text>
            총 체결량: {formatVolume(snapshot.totalFilledVolume)} ｜ 
            평균가: {formatPrice(snapshot.avgFillPrice)}
          </Text>
          <Text>
            세션 거래량: {formatVolume(snapshot.sessionVolume)} USDT
          </Text>
        </Box>
      </Box>

      <Box flexDirection="row" marginBottom={1} gap={4}>
        <Box flexDirection="column">
          <Text color="yellow">수수료 현황</Text>
          <Text>
            메이커: {formatFee(snapshot.feeStats.totalMakerFees)} USDT 
            ({(snapshot.feeStats.estimatedMakerFeeRate * 100).toFixed(3)}%)
          </Text>
          <Text>
            테이커: {formatFee(snapshot.feeStats.totalTakerFees)} USDT 
            ({(snapshot.feeStats.estimatedTakerFeeRate * 100).toFixed(3)}%)
          </Text>
          <Text>
            순 수수료: <Text color={feeColor}>{formatFee(snapshot.feeStats.netFees)} USDT</Text>
          </Text>
        </Box>

        <Box flexDirection="column">
          <Text color="yellow">주문 현황</Text>
          <Text>
            매수 주문: {snapshot.orderPressure.buyOrders}개 ｜ 
            매도 주문: {snapshot.orderPressure.sellOrders}개
          </Text>
          <Text>
            총 활성: {snapshot.orderPressure.totalOrders}개 ｜ 
            목표: {snapshot.desiredOrders.length}개
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column">
        <Text color="yellow">거래 로그</Text>
        {lastLogs.length > 0 ? (
          lastLogs.map((item, index) => (
            <Text key={`${item.time}-${index}`} color={
              item.type === "trade" ? "green" : 
              item.type === "error" ? "red" : 
              item.type === "warn" ? "yellow" : 
              undefined
            }>
              [{item.time}] {item.detail}
            </Text>
          ))
        ) : (
          <Text color="gray">로그 없음</Text>
        )}
      </Box>
    </Box>
  );
}