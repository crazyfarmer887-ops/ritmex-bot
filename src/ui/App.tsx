import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { TrendApp } from "./TrendApp";
import { MakerApp } from "./MakerApp";
import { OffsetMakerApp } from "./OffsetMakerApp";
import { GridApp } from "./GridApp";
import { BasisApp } from "./BasisApp";
import { GrvtMakerApp } from "./GrvtMakerApp";
import { VolumeMakerApp } from "./VolumeMakerApp";
import { isBasisStrategyEnabled } from "../config";
import { loadCopyrightFragments, verifyCopyrightIntegrity } from "../utils/copyright";
import { resolveExchangeId } from "../exchanges/create-adapter";

interface StrategyOption {
  id: "trend" | "maker" | "offset-maker" | "basis" | "grid" | "grvt-maker" | "volume-maker";
  label: string;
  description: string;
  component: React.ComponentType<{ onExit: () => void }>;
}

const BASE_STRATEGIES: StrategyOption[] = [
  {
    id: "trend",
    label: "추세 추종 전략 (SMA30)",
    description: "이동평균 신호를 모니터링하고 자동 진입/청산 및 손절/익절 유지",
    component: TrendApp,
  },
  {
    id: "maker",
    label: "메이커 전략",
    description: "양방향 지정가로 유동성 제공, 자동 리프라이스와 리스크 손절",
    component: MakerApp,
  },
  {
    id: "grid",
    label: "기본 그리드 전략",
    description: "상/하 경계 사이에 등비 격자를 깔고 자동 증/감량",
    component: GridApp,
  },
  {
    id: "offset-maker",
    label: "오프셋 메이커 전략",
    description: "호가창 깊이에 따라 자동 오프셋, 극단적 불균형 시 철수",
    component: OffsetMakerApp,
  },
  {
    id: "grvt-maker",
    label: "GRVT 동기 메이커 전략",
    description: "양방향 동기 메이킹, 자동 손절 보호 (GRVT 전용)",
    component: GrvtMakerApp,
  },
  {
    id: "volume-maker",
    label: "볼륨 메이커 전략 (거래량 + 네거티브 수수료)",
    description: "공격적 양방향 주문으로 거래량 극대화 및 메이커 리베이트 획득",
    component: VolumeMakerApp,
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
        label: "期现套利策略",
        description: "监控期货与现货盘口差价，辅助发现套利机会",
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
        <Text color="red">경고: 저작권 무결성 검증 실패, 현재 버전이 변조되었을 수 있습니다.</Text>
      )}
      <Box height={1}>
        <Text color="gray">────────────────────────────────────────────────────</Text>
      </Box>
      <Text color="cyanBright">실행할 전략을 선택하세요</Text>
      <Text color="gray">위/아래 화살표로 선택, Enter 시작, Ctrl+C 종료</Text>
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
