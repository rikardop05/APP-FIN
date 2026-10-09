'use client';

import { buildMonthValue, MONTH_NAMES, parseMonthValue, yearOptions } from './month-picker-model';
import { Select } from './select';

type MonthPickerProps = {
  /** `AAAA-MM`, ou vazio quando ainda não há mês escolhido. */
  value: string;
  onChange: (value: string) => void;
  /** Ano de referência da janela de anos (o ano de hoje). Padrão: o do valor ou 2026. */
  centerYear?: number;
  /** Quantos anos para cada lado do centro. Padrão 3. */
  span?: number;
  /** Rótulo acessível do grupo, ex.: "Competência padrão". */
  label: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Seletor de mês e ano em pt-BR (dois selects), no lugar do `<input type="month">` nativo, que mostra
 * o mês no idioma do navegador. O valor é sempre `AAAA-MM`. Serve a qualquer tela que peça uma
 * competência. Escolher só o mês mantém o ano (e vice-versa); sem valor ainda, o ano é o de referência.
 */
export function MonthPicker({ value, onChange, centerYear, span = 3, label, disabled, className }: MonthPickerProps) {
  const parts = parseMonthValue(value);
  const center = centerYear ?? parts?.year ?? new Date().getFullYear();
  const years = yearOptions(center, span, parts?.year ?? null);

  return (
    <div role="group" aria-label={label} className={className ?? 'grid grid-cols-[minmax(0,1fr)_minmax(0,6rem)] gap-2'}>
      <Select
        aria-label={`${label}: mês`}
        value={parts ? String(parts.month) : ''}
        disabled={disabled}
        onChange={(event) => onChange(buildMonthValue(parts?.year ?? center, Number(event.target.value)))}
      >
        {parts ? null : <option value="">Mês</option>}
        {MONTH_NAMES.map((name, index) => (
          <option key={name} value={index + 1}>
            {name.charAt(0).toUpperCase() + name.slice(1)}
          </option>
        ))}
      </Select>
      <Select
        aria-label={`${label}: ano`}
        value={parts ? String(parts.year) : ''}
        disabled={disabled}
        onChange={(event) => onChange(buildMonthValue(Number(event.target.value), parts?.month ?? 1))}
      >
        {parts ? null : <option value="">Ano</option>}
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </Select>
    </div>
  );
}
