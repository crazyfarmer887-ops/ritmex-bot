import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { TrendApp } from "./TrendApp";
import { MakerApp } from "./MakerApp";
import { OffsetMakerApp } from "./OffsetMakerApp";
import { GridApp } from "./GridApp";
import { BasisApp } from "./BasisApp";
import { GrvtMakerApp } from "./GrvtMakerApp";
import { isBasisStrategyEnabled } from "../config";
import { loadCopyrightFragments, verifyCopyrightIntegrity } from "../utils/copyright";
import { resolveExchangeId } from "../exchanges/create-adapter";

interface StrategyOption {
  id: "trend" | "maker" | "offset-maker" | "basis" | "grid" | "grvt-maker";
  label: string;
  description: string;
  component: React.ComponentType<{ onExit: () => void }>;
}

const BASE_STRATEGIES: StrategyOption[] = [
  {
    id: "trend",
    label: "추세 추종 전략 (SMA30)",
    description: "이동평균선 신호를 모니터링하여 자동 진입/청산 및 손절/익절 관리",
    component: TrendApp,
  },
  {
    id: "maker",
    label: "마켓 메이킹 전략",
    description: "양방향 주문으로 유동성 제공, 자동 가격 추적 및 리스크 관리",
    component: MakerApp,
  },
  {
    id: "grid",
    label: "그리드 트레이딩 전략",
    description: "상하한 경계 내에서 등간격 그리드 배치, 자동 매수/매도",
    component: GridApp,
  },
  {
    id: "offset-maker",
    label: "오프셋 마켓 메이킹 전략",
    description: "호가창 깊이에 따라 주문을 자동 조정하고 극단적 불균형 시 철수",
    component: OffsetMakerApp,
  },
  {
    id: "grvt-maker",
    label: "GRVT 동기화 마켓 메이킹 전략",
    description: "양방향 동기 마켓 메이킹, 자동 손절 보호 (GRVT 거래소 전용)",
    component: GrvtMakerApp,
  },
];

const inputSupported = Boolean(process.stdin && (process.stdin as any).isTTY);

export function App() {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<StrategyOption | null>(null);
  const copyright = useMemo(() => loadCopyrightFragments(), []);
  const integrityOk = useMemo(() => verifyCopyrightIntegrity(), []);
  const exchangeId = useMemo(() => resolveExchangeId(), []);
  const strategies = useMemo(() => {
    if (!isBasisStrategyEnabled()) {
      return BASE_STRATEGIES;
    }
    return [
      ...BASE_STRATEGIES,
      {
        id: "basis" as const,
        label: "선물-현물 차익거래 전략",
        description: "선물과 현물 호가 차이를 모니터링하여 차익거래 기회 발견 지원",
        component: BasisApp,
      },
    ];
  }, []);

  useInput(
    (input, key) => {
      if (selected) return;
      if (key.upArrow) {
        setCursor((prev) => (prev - 1 + strategies.length) % strategies.length);
      } else if (key.downArrow) {
        setCursor((prev) => (prev + 1) % strategies.length);
      } else if (key.return) {
        const strategy = strategies[cursor];
        if (strategy) {
          setSelected(strategy);
        }
      }
    },
    { isActive: inputSupported && !selected }
  );

  if (selected) {
    const Selected = selected.component;
    return <Selected onExit={() => setSelected(null)} />;
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color="gray">{copyright.bannerText}</Text>
      {integrityOk ? null : (
        <Text color="red">⚠️  경고: 저작권 검증 실패. 현재 버전이 변조되었을 수 있습니다.</Text>
      )}
      <Box height={1}>
        <Text color="gray">────────────────────────────────────────────────────</Text>
      </Box>
      <Text color="cyanBright" bold>🚀 실행할 전략을 선택하세요</Text>
      <Text color="gray">↑/↓ 키로 선택, Enter로 시작, Ctrl+C로 종료</Text>
      <Box flexDirection="column" marginTop={1}>
        {strategies.map((strategy, index) => {
          const active = index === cursor;
          return (
            <Box key={strategy.id} flexDirection="column" marginBottom={1}>
              <Text color={active ? "greenBright" : undefined}>
                {active ? "➤" : "  "} {strategy.label}
              </Text>
              <Text color="gray">    {strategy.description}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
