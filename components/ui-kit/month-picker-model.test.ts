import { describe, expect, it } from 'vitest';
import { MONTH_NAMES, buildMonthValue, parseMonthValue, yearOptions } from './month-picker-model';

describe('seletor de mês', () => {
  it('lê e monta AAAA-MM', () => {
    expect(parseMonthValue('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonthValue('2026-13')).toBeNull();
    expect(parseMonthValue('')).toBeNull();
    expect(buildMonthValue(2026, 3)).toBe('2026-03');
  });

  it('tem os 12 meses em português', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[9]).toBe('outubro');
    expect(MONTH_NAMES[2]).toBe('março');
  });

  it('oferece uma janela de anos, mais recente primeiro, e mantém o ano atual do valor', () => {
    expect(yearOptions(2026, 2, 2026)).toEqual([2028, 2027, 2026, 2025, 2024]);
    expect(yearOptions(2026, 1, 2019)).toEqual([2027, 2026, 2025, 2019]);
  });
});
