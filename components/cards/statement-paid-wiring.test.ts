import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Liga o botão de fatura paga (rota do Funil) à tela de cartões. A regra está em `statement-paid.test.ts`;
 * o vitest roda em Node, então aqui se trava a fiação no código-fonte.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('fatura paga na tela de cartões', () => {
  it('o botão grava pela rota do Funil e diz o resultado em texto', () => {
    const button = read('components/cards/statement-paid-button.tsx');
    expect(button).toContain('`/api/statements/${statementId}/status`');
    expect(button).toContain("method: 'POST'");
    expect(button).toContain('role={message.kind === \'error\' ? \'alert\' : \'status\'}');
  });

  it('a lista usa o botão e o Carimbo PAGO, e a tela recarrega as faturas e o comprometido', () => {
    const list = read('components/cards/statement-list.tsx');
    expect(list).toContain('<StatementPaidButton');
    expect(list).toContain('<Carimbo tone="ok">Pago</Carimbo>');
    const screen = read('components/cards/cartoes-screen.tsx');
    expect(screen).toContain('onStatusChanged={statusChanged}');
    expect(screen).toContain('router.refresh()');
  });

  it('o aviso de vencimento ignora fatura paga e o comprometimento ja traz statementPaid do servidor', () => {
    expect(read('components/cards/due-date-check.ts')).toContain("statement.status === 'paid'");
    expect(read('lib/finance/commitment.ts')).toContain('statement.statementPaid === true'.replace('statement.', 'transaction.'));
  });

  it('rótulo de mês do gráfico na escala (12px), sem 10px', () => {
    expect(read('components/cards/commitment/commitment-section.tsx')).not.toContain('text-[' + '10px]');
  });
});
