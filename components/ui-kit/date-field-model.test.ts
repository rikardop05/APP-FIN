import { describe, expect, it } from 'vitest';
import { maskDateBR, parseDateBR, toDateBR } from './date-field-model';

describe('campo de data pt-BR', () => {
  it('põe as barras enquanto digita e ignora o que não é dígito', () => {
    expect(maskDateBR('0')).toBe('0');
    expect(maskDateBR('0410')).toBe('04/10');
    expect(maskDateBR('04102026')).toBe('04/10/2026');
    expect(maskDateBR('04/10/2026999')).toBe('04/10/2026');
    expect(maskDateBR('ab04x10')).toBe('04/10');
  });

  it('lê dd/mm/aaaa como ISO e recusa data que não existe ou incompleta', () => {
    expect(parseDateBR('04/10/2026')).toBe('2026-10-04');
    expect(parseDateBR('29/02/2028')).toBe('2028-02-29');
    expect(parseDateBR('29/02/2026')).toBeNull();
    expect(parseDateBR('31/04/2026')).toBeNull();
    expect(parseDateBR('04/10')).toBeNull();
    expect(parseDateBR('')).toBeNull();
  });

  it('mostra ISO em dd/mm/aaaa e vazio para o inválido', () => {
    expect(toDateBR('2026-10-04')).toBe('04/10/2026');
    expect(toDateBR('')).toBe('');
    expect(toDateBR('2026-02-30')).toBe('');
  });
});
