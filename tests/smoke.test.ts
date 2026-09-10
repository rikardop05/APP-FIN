import { describe, expect, it } from 'vitest';

// Teste trivial: prova que a suite do Vitest roda. Sem valor de dominio.
describe('suite de testes', () => {
  it('executa', () => {
    expect(1 + 1).toBe(2);
  });
});
