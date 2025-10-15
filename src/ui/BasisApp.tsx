import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { basisConfig } from "../config";
import { getExchangeDisplayName, resolveExchangeId } from "../exchanges/create-adapter";
import { buildAdapterFromEnv } from "../exchanges/resolve-from-env";
import { BasisArbEngine, type BasisArbSnapshot } from "../strategy/basis-arb-engine";
import { formatNumber } from "../utils/format";

interface BasisAppProps {
  onExit: () => void;
}

const inputSupported = Boolean(process.stdin && (process.stdin as any).isTTY);

export function BasisApp({ onExit }: BasisAppProps) {
  const [snapshot, setSnapshot] = useState<BasisArbSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const engineRef = useRef<BasisArbEngine | null>(null);
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
    if (exchangeId !== "aster") {
      setError(new Error("선물-현물 차익거래 전략은 현재 Aster 거래소만 지원합니다. EXCHANGE=aster로 설정 후 다시 시도하세요."));
      return;
    }
    try {
      const adapter = buildAdapterFromEnv({ exchangeId, symbol: basisConfig.futuresSymbol });
      const engine = new BasisArbEngine(basisConfig, adapter);
      engineRef.current = engine;
      setSnapshot(engine.getSnapshot());
      const handler = (next: BasisArbSnapshot) => {
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
        <Text color="red">❌ 선물-현물 차익거래 전략 시작 실패: {error.message}</Text>
        <Text color="gray">Esc 키로 메뉴로 돌아가기</Text>
      </Box>
    );
  }

  if (!snapshot) {
    return (
      <Box padding={1}>
        <Text>🔄 선물-현물 차익거래 모니터링 초기화 중...</Text>
      </Box>
    );
  }

  const futuresBid = formatNumber(snapshot.futuresBid, 4);
  const futuresAsk = formatNumber(snapshot.futuresAsk, 4);
  const spotBid = formatNumber(snapshot.spotBid, 4);
  const spotAsk = formatNumber(snapshot.spotAsk, 4);
  const spread = formatNumber(snapshot.spread, 4);
  const spreadBps = formatNumber(snapshot.spreadBps, 2);
  const netSpread = formatNumber(snapshot.netSpread, 4);
  const netSpreadBps = formatNumber(snapshot.netSpreadBps, 2);
  const lastUpdated = snapshot.lastUpdated ? new Date(snapshot.lastUpdated).toLocaleTimeString() : "-";
  const futuresUpdated = snapshot.futuresLastUpdate ? new Date(snapshot.futuresLastUpdate).toLocaleTimeString() : "-";
  const spotUpdated = snapshot.spotLastUpdate ? new Date(snapshot.spotLastUpdate).toLocaleTimeString() : "-";
  const fundingRatePct = snapshot.fundingRate != null ? `${(snapshot.fundingRate * 100).toFixed(4)}%` : "-";
  const fundingUpdated = snapshot.fundingLastUpdate ? new Date(snapshot.fundingLastUpdate).toLocaleTimeString() : "-";
  const nextFundingTime = snapshot.nextFundingTime ? new Date(snapshot.nextFundingTime).toLocaleTimeString() : "-";
  const fundingIncomePerFunding = snapshot.fundingIncomePerFunding != null ? `${formatNumber(snapshot.fundingIncomePerFunding, 4)} USDT` : "-";
  const fundingIncomePerDay = snapshot.fundingIncomePerDay != null ? `${formatNumber(snapshot.fundingIncomePerDay, 4)} USDT` : "-";
  const takerFeesPerRoundTrip = snapshot.takerFeesPerRoundTrip != null ? `${formatNumber(snapshot.takerFeesPerRoundTrip, 4)} USDT` : "-";
  const fundingCountToBreakeven = snapshot.fundingCountToBreakeven != null ? `${formatNumber(snapshot.fundingCountToBreakeven, 2)} 회` : "-";
  const feedStatus = snapshot.feedStatus;
  const lastLogs = snapshot.tradeLog.slice(-5);
  const spotBalances = (snapshot.spotBalances ?? []).filter((b) => Math.abs(b.free) > 0 || Math.abs(b.locked) > 0);
  const futuresBalances = (snapshot.futuresBalances ?? []).filter((b) => Math.abs(b.wallet) > 0);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box flexDirection="column" marginBottom={1}>
        <Text color="cyanBright" bold>💹 선물-현물 차익거래 대시보드</Text>
        <Text>
          거래소: {exchangeName} | 선물 심볼: {snapshot.futuresSymbol} | 현물 심볼: {snapshot.spotSymbol}
        </Text>
        <Text color="gray">Esc 키로 돌아가기 | 데이터 상태: 선물({feedStatus.futures ? "OK" : "--"}) 현물({feedStatus.spot ? "OK" : "--"}) 펀딩({feedStatus.funding ? "OK" : "--"})</Text>
        <Text color="gray">최종 업데이트: {lastUpdated}</Text>
      </Box>

      <Box flexDirection="row" marginBottom={1}>
        <Box flexDirection="column" marginRight={4}>
          <Text color="greenBright" bold>📊 선물 호가</Text>
          <Text>최고매수: {futuresBid} | 최저매도: {futuresAsk}</Text>
          <Text color="gray">업데이트: {futuresUpdated}</Text>
        </Box>
        <Box flexDirection="column">
          <Text color="greenBright" bold>💰 현물 호가</Text>
          <Text>최고매수: {spotBid} | 최저매도: {spotAsk}</Text>
          <Text color="gray">업데이트: {spotUpdated}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color="yellow" bold>💸 펀딩 수수료</Text>
        <Text>현재 펀딩 비율: {fundingRatePct}</Text>
        <Text color="gray">펀딩 업데이트: {fundingUpdated} | 다음 정산: {nextFundingTime}</Text>
        <Text>1회 펀딩 수익(예상): {fundingIncomePerFunding} | 일일 수익(예상): {fundingIncomePerDay}</Text>
        <Text>왕복 테이커 수수료(예상): {takerFeesPerRoundTrip} | 손익분기 펀딩 횟수: {fundingCountToBreakeven}</Text>
      </Box>

      <Box flexDirection="row" marginBottom={1}>
        <Box flexDirection="column" marginRight={4}>
          <Text color="cyan" bold>💼 현물 계정 잔고 (0 제외)</Text>
          {spotBalances.length ? (
            spotBalances.map((b) => (
              <Text key={`spot-${b.asset}`}>
                {b.asset}: 사용가능 {formatNumber(b.free, 8)} | 잠김 {formatNumber(b.locked, 8)}
              </Text>
            ))
          ) : (
            <Text color="gray">없음</Text>
          )}
        </Box>
        <Box flexDirection="column">
          <Text color="cyan" bold>📈 선물 계정 잔고 (0 제외)</Text>
          {futuresBalances.length ? (
            futuresBalances.map((b) => (
              <Text key={`fut-${b.asset}`}>
                {b.asset}: 지갑 {formatNumber(b.wallet, 8)} | 사용가능 {formatNumber(b.available, 8)}
              </Text>
            ))
          ) : (
            <Text color="gray">없음</Text>
          )}
        </Box>
      </Box>

      <Box flexDirection="column" marginBottom={1}>
        <Text color={snapshot.opportunity ? "greenBright" : "redBright"} bold>🎯 차익거래 스프레드 (선물 매도 / 현물 매수)</Text>
        <Text color={snapshot.opportunity ? "green" : undefined}>총 스프레드: {spread} USDT | {spreadBps} bp</Text>
        <Text color={snapshot.opportunity ? "green" : "red"}>
          테이커 수수료 차감 ({(basisConfig.takerFeeRate * 100).toFixed(4)}% × 양방향): {netSpread} USDT | {netSpreadBps} bp
        </Text>
      </Box>

      <Box flexDirection="column">
        <Text color="yellow" bold>📝 최근 이벤트</Text>
        {lastLogs.length ? (
          lastLogs.map((entry, index) => {
            const color = entry.type === "entry" ? "green" : entry.type === "exit" ? "red" : undefined;
            return (
              <Text key={`${entry.time}-${index}`} color={color}>
                [{entry.time}] [{entry.type}] {entry.detail}
              </Text>
            );
          })
        ) : (
          <Text color="gray">로그 없음</Text>
        )}
      </Box>
    </Box>
  );
}
