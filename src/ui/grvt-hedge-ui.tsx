import React from "react";
import { Box, Text } from "ink";
import type { GrvtHedgeSnapshot } from "../strategy/grvt-hedge-engine";

export interface GrvtHedgeUIProps {
  snapshot: GrvtHedgeSnapshot;
}

export function GrvtHedgeUI({ snapshot }: GrvtHedgeUIProps) {
  const {
    running,
    accountSnapshot,
    depthSnapshot,
    tickerSnapshot,
    openBuyOrders,
    openSellOrders,
    openStopOrders,
    lastError,
    lastOrderTime
  } = snapshot;

  const position = accountSnapshot?.positions?.[0];
  const absPosition = Math.abs(position?.positionAmt ?? 0);
  const isLong = (position?.positionAmt ?? 0) > 0;
  const unrealizedPnl = Number(position?.unrealizedProfit ?? 0);

  const topBid = Number(depthSnapshot?.bids?.[0]?.[0] ?? 0);
  const topAsk = Number(depthSnapshot?.asks?.[0]?.[0] ?? 0);
  const lastPrice = Number(tickerSnapshot?.lastPrice ?? 0);

  const timeSinceLastOrder = Date.now() - lastOrderTime;
  const cooldownRemaining = Math.max(0, 5000 - timeSinceLastOrder);

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">GRVT 헤지 전략</Text>
        <Text> - </Text>
        <Text color={running ? "green" : "red"}>
          {running ? "실행중" : "중지됨"}
        </Text>
      </Box>

      {/* 시장 정보 */}
      <Box marginBottom={1}>
        <Text bold>시장 정보:</Text>
      </Box>
      <Box marginLeft={2} marginBottom={1}>
        <Text>최종가: {lastPrice.toFixed(2)}</Text>
        <Text> | </Text>
        <Text>매수: {topBid.toFixed(2)}</Text>
        <Text> / </Text>
        <Text>매도: {topAsk.toFixed(2)}</Text>
      </Box>

      {/* 포지션 정보 */}
      <Box marginBottom={1}>
        <Text bold>포지션:</Text>
      </Box>
      <Box marginLeft={2} marginBottom={1}>
        {absPosition > 0 ? (
          <>
            <Text color={isLong ? "green" : "red"}>
              {isLong ? "롱" : "숏"} {absPosition.toFixed(4)}
            </Text>
            <Text> @ {(position?.entryPrice ?? 0).toFixed(2)}</Text>
            <Text> | </Text>
            <Text color={unrealizedPnl >= 0 ? "green" : "red"}>
              PnL: {unrealizedPnl.toFixed(2)}
            </Text>
          </>
        ) : (
          <Text color="gray">포지션 없음</Text>
        )}
      </Box>

      {/* 활성 주문 */}
      <Box marginBottom={1}>
        <Text bold>활성 주문:</Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        {openBuyOrders.length > 0 && (
          <Box>
            <Text color="green">매수: </Text>
            {openBuyOrders.map((o, i) => (
              <Text key={i}>{Number(o.price).toFixed(2)} ({o.origQty}) </Text>
            ))}
          </Box>
        )}
        {openSellOrders.length > 0 && (
          <Box>
            <Text color="red">매도: </Text>
            {openSellOrders.map((o, i) => (
              <Text key={i}>{Number(o.price).toFixed(2)} ({o.origQty}) </Text>
            ))}
          </Box>
        )}
        {openStopOrders.length > 0 && (
          <Box>
            <Text color="yellow">스탑: </Text>
            {openStopOrders.map((o, i) => (
              <Text key={i}>
                {o.side} @ {Number(o.stopPrice).toFixed(2)} ({o.origQty})
              </Text>
            ))}
          </Box>
        )}
        {openBuyOrders.length === 0 && openSellOrders.length === 0 && openStopOrders.length === 0 && (
          <Text color="gray">활성 주문 없음</Text>
        )}
      </Box>

      {/* 쿨다운 상태 */}
      {cooldownRemaining > 0 && (
        <Box marginTop={1}>
          <Text color="yellow">주문 쿨다운: {(cooldownRemaining / 1000).toFixed(1)}초</Text>
        </Box>
      )}

      {/* 에러 메시지 */}
      {lastError && (
        <Box marginTop={1}>
          <Text color="red">오류: {lastError}</Text>
        </Box>
      )}
    </Box>
  );
}