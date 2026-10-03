import { describe, expect, it } from 'vitest';

import { apiErrorText, backupContentsText, refusalText, tableLabel } from './backup-text';

describe('textos do backup', () => {
  it('conteúdo: só o que tem linha, com rótulo em português', () => {
    expect(backupContentsText({ transactions: 72, credit_cards: 3, incomes: 0 })).toBe('O backup tem 72 lançamentos, 3 cartões.');
    expect(backupContentsText({ transactions: 0 })).toBe('O backup está vazio.');
    expect(backupContentsText({ investment_plans: 1, goals: 2 })).toBe('O backup tem 1 plano de investimento, 2 metas.');
    expect(tableLabel('tabela_nova')).toBe('tabela_nova');
  });

  it('recusa: só quando o destino tem dado, dizendo quais tabelas', () => {
    expect(refusalText([])).toBeNull();
    expect(refusalText(['accounts', 'transactions'])).toBe(
      'Este household já tem dados (contas, lançamentos). A restauração só entra num household vazio e nunca sobrescreve nada: ela será recusada.',
    );
  });

  it('erro da API: a mensagem dela, ou o texto padrão', () => {
    expect(apiErrorText({ error: 'Restauração recusada.' }, 'x')).toBe('Restauração recusada.');
    expect(apiErrorText(null, 'Falhou.')).toBe('Falhou.');
  });
});
