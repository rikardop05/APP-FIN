'use client';

import { useEffect, useRef, useState } from 'react';

export type BarSeries = {
  id: string;
  label: string;
  /** Classe Tailwind de preenchimento (`fill-*`) — usada na barra e na legenda. */
  fillClass: string;
};

export type BarGroup = {
  key: string;
  /** Rótulo do eixo X, já curto (ex.: `nov/2025`). */
  label: string;
  /** Magnitudes em centavos (não negativas), por id de série. */
  values: Readonly<Record<string, number>>;
  /** Texto do tooltip por série, já formatado pelo chamador. */
  titles: Readonly<Record<string, string>>;
};

type BarChartProps = {
  series: readonly BarSeries[];
  groups: readonly BarGroup[];
  ariaLabel: string;
  /** Rótulo do topo do eixo Y (valor máximo), já formatado. */
  maxLabel: string;
  height?: number;
};

const PAD = { top: 24, right: 8, bottom: 32, left: 8 };
const MIN_LABEL_GAP = 60;

/**
 * Barras em SVG puro (não há biblioteca de gráfico no projeto), agrupadas por
 * `groups` e coloridas por `series`. Mede a própria largura, então o texto tem o
 * mesmo tamanho em 390px e em desktop (um viewBox fixo encolheria o rótulo para
 * ~7px no celular), e o rótulo do eixo X só aparece de N em N grupos, o bastante
 * para não se sobrepor.
 *
 * Não calcula dinheiro: desenha magnitudes que o chamador já tirou do motor. A
 * escala (maior valor = topo) é apresentação.
 */
export function BarChart({ series, groups, ariaLabel, maxLabel, height = 220 }: BarChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const element = wrapperRef.current;
    if (element === null) return;
    const update = () => setWidth(Math.max(260, Math.round(element.clientWidth)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const maxValue = Math.max(
    1,
    ...groups.flatMap((group) => series.map((s) => group.values[s.id] ?? 0)),
  );
  const groupW = groups.length === 0 ? plotW : plotW / groups.length;
  const innerW = groupW * 0.72;
  const slotW = innerW / series.length;
  const barW = Math.max(2, slotW - 1);
  const step = Math.max(1, Math.ceil(MIN_LABEL_GAP / groupW));
  const baseY = PAD.top + plotH;

  return (
    <div ref={wrapperRef} className="w-full">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block max-w-full"
      >
        <line x1={PAD.left} x2={width - PAD.right} y1={baseY} y2={baseY} className="stroke-muted-foreground" strokeWidth={1} />
        <text x={PAD.left} y={PAD.top - 8} className="fill-muted-foreground" fontSize={12}>
          {maxLabel}
        </text>
        {groups.map((group, groupIndex) => {
          const groupX = PAD.left + groupW * groupIndex + (groupW - innerW) / 2;
          return (
            <g key={group.key}>
              {series.map((s, seriesIndex) => {
                const value = group.values[s.id] ?? 0;
                const barH = value <= 0 ? 0 : Math.max(1, (value / maxValue) * plotH);
                return (
                  <rect
                    key={s.id}
                    x={groupX + seriesIndex * slotW}
                    y={baseY - barH}
                    width={barW}
                    height={barH}
                    rx={1.5}
                    className={s.fillClass}
                  >
                    <title>{group.titles[s.id] ?? ''}</title>
                  </rect>
                );
              })}
              {groupIndex % step === 0 ? (
                <text
                  x={PAD.left + groupW * groupIndex + groupW / 2}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize={12}
                  className="fill-muted-foreground"
                >
                  {group.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda">
        {series.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <svg width={10} height={10} aria-hidden="true">
              <rect width={10} height={10} rx={2} className={s.fillClass} />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
