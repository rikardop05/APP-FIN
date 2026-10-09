import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Liga o aviso de vencimento desatualizado (decisão 11c) à tela de cartões. A regra em si está em
 * `due-date-check.test.ts`; aqui se trava que a tela PASSA o ciclo atual do cartão e que a lista o
 * USA (o vitest roda em Node, sem navegador, então a checagem é no código-fonte).
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('aviso de vencimento na tela de cartões', () => {
  it('a tela passa o fecha/vence ATUAL de cada cartão e o dia de hoje à lista de faturas', () => {
    const screen = read('components/cards/cartoes-screen.tsx');
    expect(screen).toContain('cycle={{ closingDay: card.closingDay, dueDay: card.dueDay }}');
    expect(screen).toContain('today={today} />');
  });

  it('a lista calcula os avisos com a regra pura e mostra o aviso e o selo, em um canhoto só, para qualquer largura', () => {
    const list = read('components/cards/statement-list.tsx');
    expect(list).toContain('dueDateWarnings(statements, cycle, today)');
    expect(list).toContain('Vencimento diferente do ciclo atual do cartão');
    // Selo na tabela (desktop) e no cartão (celular).
    expect(list.match(/Vencimento desatualizado/g)).toHaveLength(1);
  });

  it('é só aviso: nada na lista grava, recalcula ou altera a fatura', () => {
    const list = read('components/cards/statement-list.tsx');
    expect(list).not.toMatch(/fetch\(|method:/);
    expect(read('components/cards/due-date-check.ts')).not.toMatch(/fetch\(|db\./);
  });
});
