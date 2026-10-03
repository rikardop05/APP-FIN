'use client';

import { useEffect, useRef, useState } from 'react';

import { cents, formatBRL, type Cents } from '@/lib/money';

import { formatCompactBRL, scenarioName, yearTickLabel, type ScenarioLabel } from './display';
import type { InvestmentScenario } from './schemas';

type AccumulationChartProps = {
  scenarios: readonly Pick<InvestmentScenario, 'label' | 'curve'>[];
  /**
   * Variante compacta (painel, T-306): mais baixa, só o eixo do zero e do pico, sem os nomes
   * na ponta das linhas. A legenda com o traço de cada cenário continua (distinguir sem cor).
   */
  compact?: boolean;
  /** Linha horizontal de referência (ex.: o alvo do cenário médio). Entra na escala do eixo Y. */
  reference?: { label: string; valueCents: Cents } | null;
};

const HEIGHT = 280;
const COMPACT_HEIGHT = 190;
// `left` cabe o maior rótulo do eixo Y ("R$ 350 mil"); `right` cabe meio rótulo do último
// ponto do eixo X ("20 anos").
const PAD = { top: 24, right: 20, bottom: 30, left: 62 };
/** Abaixo desta largura os nomes na ponta das linhas colidem com as curvas: fica só a legenda. */
const END_LABEL_MIN_WIDTH = 520;
const LABEL_GAP = 15;

/**
 * Cada cenário se distingue SEM depender só da cor: traço próprio (pontilhado, cheio,
 * tracejado) e o NOME escrito junto da ponta da linha (legenda direta). A cor só reforça.
 * SVG puro, como `components/cashflow/balance-chart.tsx`: mede a própria largura para o
 * texto ficar legível em 390 px. Nenhuma conta de dinheiro aqui; só desenho dos pontos que
 * a API já calculou (`accumulationCurve`).
 */
const STYLE: Record<ScenarioLabel, { stroke: string; dash: string | undefined; width: number }> = {
  conservative: { stroke: 'stroke-sky-700', dash: '2 4', width: 2.5 },
  moderate: { stroke: 'stroke-foreground', dash: undefined, width: 2.5 },
  optimistic: { stroke: 'stroke-emerald-700', dash: '9 4', width: 2.5 },
};

const TEXT_FILL: Record<ScenarioLabel, string> = {
  conservative: 'fill-sky-800',
  moderate: 'fill-foreground',
  optimistic: 'fill-emerald-800',
};

export function AccumulationChart({ scenarios, compact = false, reference = null }: AccumulationChartProps) {
  const HEIGHT_NOW = compact ? COMPACT_HEIGHT : HEIGHT;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);

  useEffect(() => {
    const element = wrapperRef.current;
    if (element === null) return;
    const update = () => setWidth(Math.max(280, Math.round(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const lastMonth = Math.max(1, ...scenarios.map((s) => s.curve.at(-1)?.month ?? 0));
  const peak = Math.max(
    1,
    reference?.valueCents ?? 0,
    ...scenarios.flatMap((s) => s.curve.map((p) => p.portfolioCents as number)),
  );
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT_NOW - PAD.top - PAD.bottom;
  const x = (month: number) => PAD.left + (plotW * month) / lastMonth;
  const y = (value: number) => PAD.top + plotH * (1 - value / peak);

  const xTicks: number[] = [];
  const tickEvery = width < 420 ? 120 : 60;
  for (let month = 0; month <= lastMonth; month += tickEvery) xTicks.push(month);
  const yTicks = compact ? [0, peak] : [0, peak / 2, peak];

  // Rótulos junto da ponta: ordena de cima para baixo e empurra os que colidem.
  const ends = scenarios
    .map((scenario) => ({ scenario, endY: y(scenario.curve.at(-1)?.portfolioCents ?? 0) }))
    .sort((a, b) => a.endY - b.endY);
  const labelY = new Map<ScenarioLabel, number>();
  let previous = -Infinity;
  for (const { scenario, endY } of ends) {
    const placed = Math.max(endY - 12, previous + LABEL_GAP, 12);
    labelY.set(scenario.label, placed);
    previous = placed;
  }

  const summary =
    'Patrimônio acumulado ao longo de ' +
    `${String(lastMonth / 12)} anos, em R$ de hoje, nos cenários ` +
    scenarios
      .map((s) => `${scenarioName(s.label).toLowerCase()} (${formatBRL(s.curve.at(-1)?.portfolioCents ?? cents(0))} ao fim)`)
      .join(', ') +
    '.';

  return (
    <div ref={wrapperRef} className="w-full">
      <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Legenda das curvas">
        {scenarios.map((scenario) => (
          <li key={scenario.label} className="flex items-center gap-2">
            <svg width={30} height={8} aria-hidden="true">
              <line x1={0} x2={30} y1={4} y2={4} className={STYLE[scenario.label].stroke} strokeWidth={STYLE[scenario.label].width} strokeDasharray={STYLE[scenario.label].dash} />
            </svg>
            <span className="font-medium">{scenarioName(scenario.label)}</span>
          </li>
        ))}
      </ul>
      <svg role="img" aria-label={summary} viewBox={`0 0 ${width} ${HEIGHT_NOW}`} width={width} height={HEIGHT_NOW} className="block max-w-full">
        {yTicks.map((value) => (
          <g key={value}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(value) + 4} textAnchor="end" fontSize={11} className="fill-muted-foreground">
              {formatCompactBRL(cents(Math.round(value)))}
            </text>
          </g>
        ))}

        {xTicks.map((month) => (
          <text
            key={month}
            x={x(month)}
            y={HEIGHT_NOW - 8}
            textAnchor={month === 0 ? 'start' : month === lastMonth ? 'end' : 'middle'}
            fontSize={11}
            className="fill-muted-foreground"
          >
            {yearTickLabel(month)}
          </text>
        ))}

        {scenarios.map((scenario) => {
          const style = STYLE[scenario.label];
          const path = scenario.curve
            .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.month).toFixed(1)} ${y(point.portfolioCents).toFixed(1)}`)
            .join(' ');
          const end = scenario.curve.at(-1);
          return (
            <g key={scenario.label}>
              <path d={path} fill="none" className={style.stroke} strokeWidth={style.width} strokeDasharray={style.dash} strokeLinejoin="round" />
              {end ? (
                <circle cx={x(end.month)} cy={y(end.portfolioCents)} r={3.5} className={`${TEXT_FILL[scenario.label]} stroke-background`} strokeWidth={1.5}>
                  <title>{`${scenarioName(scenario.label)}: ${formatBRL(end.portfolioCents)} em ${yearTickLabel(end.month)}`}</title>
                </circle>
              ) : null}
            </g>
          );
        })}

        {reference ? (
          <g>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(reference.valueCents)} y2={y(reference.valueCents)} className="stroke-amber-600" strokeWidth={1.5} strokeDasharray="1 5" strokeLinecap="round" />
            <text x={PAD.left + 4} y={y(reference.valueCents) - 5} fontSize={11} fontWeight={600} className="fill-amber-800">
              {`${reference.label}: ${formatCompactBRL(reference.valueCents)}`}
            </text>
          </g>
        ) : null}

        {!compact && width >= END_LABEL_MIN_WIDTH ? scenarios.map((scenario) => (
          <text
            key={`label-${scenario.label}`}
            x={width - PAD.right - 6}
            y={labelY.get(scenario.label) ?? 0}
            textAnchor="end"
            fontSize={12}
            fontWeight={600}
            className={TEXT_FILL[scenario.label]}
          >
            {scenarioName(scenario.label)}
          </text>
        )) : null}
      </svg>
    </div>
  );
}
