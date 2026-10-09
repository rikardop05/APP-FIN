'use client';

import { useEffect, useId, useRef, useState } from 'react';

import type { CashflowMonth } from '@/lib/finance/cashflow';
import { cents, formatBRL } from '@/lib/money';

import { competenceShort } from './labels';

type BalanceChartProps = {
  months: readonly CashflowMonth[];
  /** Curva sem simulação, desenhada tracejada ao fundo quando há ajustes. */
  baseMonths: readonly CashflowMonth[] | null;
};

const HEIGHT = 260;
// `left`/`right` cabem MEIO rótulo do eixo X ("out/2026" tem ~46px a 11px): o
// rótulo é centrado no ponto (`textAnchor="middle"`), e com 16px o primeiro e o
// último saíam cortados ("ut/2026", "set/202").
const PAD = { top: 28, right: 30, bottom: 34, left: 30 };
const MIN_LABEL_GAP = 52;

/**
 * Linha do FECHAMENTO mês a mês (`closingCents`), com o trecho abaixo de zero em
 * vermelho. O vermelho é decidido por `closingCents < 0` — a mesma regra de
 * `CashflowMonth.negative` — e nunca por `netCents`: um mês pode gastar mais do
 * que ganhou e ainda fechar positivo, e isso não é quebrar.
 *
 * O trecho vermelho é um recorte (clipPath) da MESMA linha abaixo do eixo zero,
 * e não segmentos coloridos por ponta: assim o cruzamento do zero muda de cor
 * exatamente onde cruza, e não no mês seguinte. O desenho é SVG puro (não há
 * biblioteca de gráfico no projeto) e mede a própria largura, para o texto ter
 * tamanho legível também em 390px. A tabela abaixo é a alternativa textual.
 */
export function BalanceChart({ months, baseMonths }: BalanceChartProps) {
  const clipId = useId().replace(/:/g, '');
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

  const series = [months, ...(baseMonths ? [baseMonths] : [])];
  const values = series.flatMap((rows) => rows.map((month) => month.closingCents as number));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo === 0 ? 1 : hi - lo;

  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (index: number) =>
    PAD.left + (months.length <= 1 ? plotW / 2 : (plotW * index) / (months.length - 1));
  const y = (value: number) => PAD.top + plotH * (1 - (value - lo) / span);
  const zeroY = y(0);

  const path = (rows: readonly CashflowMonth[]) =>
    rows
      .map((month, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)} ${y(month.closingCents).toFixed(1)}`)
      .join(' ');

  const step = Math.max(1, Math.ceil(MIN_LABEL_GAP / (months.length <= 1 ? plotW : plotW / (months.length - 1))));
  const negativeCount = months.filter((month) => month.negative).length;
  const first = months[0];
  const last = months[months.length - 1];
  const summary =
    `Saldo projetado no fim de cada mês, de ${first ? competenceShort(first.competence) : ''} ` +
    `a ${last ? competenceShort(last.competence) : ''}. ` +
    (negativeCount === 0
      ? 'Nenhum mês fecha negativo.'
      : `${negativeCount} mês(es) fecham negativos.`);

  return (
    <div ref={wrapperRef} className="w-full">
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
        height={HEIGHT}
        className="block max-w-full"
      >
        <defs>
          <clipPath id={`${clipId}-above`}>
            <rect x={0} y={0} width={width} height={Math.max(0, zeroY)} />
          </clipPath>
          <clipPath id={`${clipId}-below`}>
            <rect x={0} y={zeroY} width={width} height={Math.max(0, HEIGHT - zeroY)} />
          </clipPath>
        </defs>

        {/* Faixa abaixo de zero */}
        {lo < 0 ? (
          <rect
            x={PAD.left}
            y={zeroY}
            width={plotW}
            height={Math.max(0, PAD.top + plotH - zeroY)}
            className="fill-destructive/10"
          />
        ) : null}

        {/* Eixo zero */}
        <line x1={PAD.left} x2={width - PAD.right} y1={zeroY} y2={zeroY} className="stroke-muted-foreground" strokeWidth={1} />
        <text x={PAD.left} y={zeroY - 4} className="fill-muted-foreground" fontSize={12}>
          {formatBRL(cents(0))}
        </text>

        {/* Curva sem simulação */}
        {baseMonths ? (
          <path d={path(baseMonths)} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="5 4" />
        ) : null}

        {/* Curva principal: neutra acima do zero, vermelha abaixo */}
        <g clipPath={`url(#${clipId}-above)`}>
          <path d={path(months)} fill="none" className="stroke-foreground" strokeWidth={2.5} strokeLinejoin="round" />
        </g>
        <g clipPath={`url(#${clipId}-below)`}>
          <path d={path(months)} fill="none" className="stroke-destructive" strokeWidth={2.5} strokeLinejoin="round" />
        </g>

        {/* Pontos */}
        {months.map((month, index) => (
          <circle
            key={month.competence}
            cx={x(index)}
            cy={y(month.closingCents)}
            r={month.negative ? 5 : 3.5}
            className={month.negative ? 'fill-destructive stroke-background' : 'fill-foreground stroke-background'}
            strokeWidth={1.5}
          >
            <title>{`${competenceShort(month.competence)}: ${formatBRL(month.closingCents)}${month.negative ? ' (negativo)' : ''}`}</title>
          </circle>
        ))}

        {/* Rótulos do eixo X */}
        {months.map((month, index) =>
          index % step === 0 ? (
            <text
              key={month.competence}
              x={x(index)}
              y={HEIGHT - 12}
              textAnchor="middle"
              fontSize={12}
              className={month.negative ? 'fill-destructive' : 'fill-muted-foreground'}
            >
              {competenceShort(month.competence)}
            </text>
          ) : null,
        )}

        {/* Extremos */}
        <text x={PAD.left} y={PAD.top - 12} className="fill-muted-foreground" fontSize={12}>
          {formatBRL(cents(hi))}
        </text>
        {lo < 0 ? (
          <text x={PAD.left} y={PAD.top + plotH + 12} className="fill-destructive" fontSize={12}>
            {formatBRL(cents(lo))}
          </text>
        ) : null}
      </svg>
    </div>
  );
}
