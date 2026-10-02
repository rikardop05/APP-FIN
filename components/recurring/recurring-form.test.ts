import { describe, expect, it } from 'vitest';

import {
  expenseText,
  firstLeafId,
  formatAdjustmentPercent,
  formatMonthBR,
  incomeText,
  leafCategoryGroups,
  leafCategoryName,
  oneOffListSuffix,
  oneOffMonthOptions,
  parseAdjustmentPercent,
  previewText,
  type CategoryTreeNode,
} from './recurring-form';
import { RecurringExpenseFormSchema } from './schemas';

/** Arvore no formato de `listCategories`: so raizes no topo, folhas em `children`. */
function node(
  id: string,
  name: string,
  parentId: string | null,
  children: CategoryTreeNode[] = [],
  nature: CategoryTreeNode['nature'] = 'essential',
): CategoryTreeNode {
  return { id, name, parentId, nature, children };
}

const tree: CategoryTreeNode[] = [
  node('moradia', 'Moradia', null, [
    node('agua', 'Água', 'moradia'),
    node('aluguel', 'Aluguel/Financiamento', 'moradia'),
  ]),
  node('alimentacao', 'Alimentação', null, [node('mercado', 'Mercado', 'alimentacao')]),
  node('vazia', 'Raiz sem filhas', null),
  node('renda', 'Renda', null, [node('salario', 'Salário', 'renda', [], 'income')]),
];

describe('leafCategoryGroups — o seletor de categoria da despesa fixa', () => {
  it('causa do defeito: filtrar parentId !== null no topo da arvore da lista vazia', () => {
    // Era o que a pagina fazia. O topo so tem raizes, entao sobra nada.
    expect(tree.filter((category) => category.parentId !== null)).toEqual([]);
  });

  it('devolve as folhas agrupadas pela raiz, na ordem da arvore', () => {
    expect(leafCategoryGroups(tree)).toEqual([
      {
        id: 'moradia',
        name: 'Moradia',
        leaves: [
          { id: 'agua', name: 'Água' },
          { id: 'aluguel', name: 'Aluguel/Financiamento' },
        ],
      },
      { id: 'alimentacao', name: 'Alimentação', leaves: [{ id: 'mercado', name: 'Mercado' }] },
    ]);
  });

  it('deixa fora raiz sem filhas e folha de receita', () => {
    const ids = leafCategoryGroups(tree).flatMap((group) => group.leaves.map((leaf) => leaf.id));
    expect(ids).not.toContain('vazia');
    expect(ids).not.toContain('salario');
  });

  it('folha orfa (a arvore a devolve no topo) entra em "Outras"', () => {
    const groups = leafCategoryGroups([node('solta', 'Solta', 'sumiu')]);
    expect(groups).toEqual([{ id: 'orphans', name: 'Outras', leaves: [{ id: 'solta', name: 'Solta' }] }]);
  });

  it('primeira folha e nome por id', () => {
    const groups = leafCategoryGroups(tree);
    expect(firstLeafId(groups)).toBe('agua');
    expect(firstLeafId([])).toBe('');
    expect(leafCategoryName(groups, 'mercado')).toBe('Mercado');
    expect(leafCategoryName(groups, 'nao-existe')).toBeNull();
  });
});

describe('reajuste anual: percentual na tela, basis points no servidor', () => {
  it.each([
    ['5', 500],
    ['5,0', 500],
    ['5.0', 500],
    ['5,00', 500],
    ['5%', 500],
    [' 5 % ', 500],
    ['4,5', 450],
    ['4,75', 475],
    ['0,25', 25],
    ['10', 1000],
    ['0', 0],
    ['-1,5', -150],
  ])('"%s" -> %i bp', (input, expected) => {
    expect(parseAdjustmentPercent(input)).toEqual({ ok: true, basisPoints: expected });
  });

  it('vazio = sem reajuste (null)', () => {
    expect(parseAdjustmentPercent('')).toEqual({ ok: true, basisPoints: null });
    expect(parseAdjustmentPercent('   ')).toEqual({ ok: true, basisPoints: null });
  });

  it('recusa mais de duas casas e texto, com mensagem em portugues', () => {
    const tooPrecise = parseAdjustmentPercent('4,755');
    expect(tooPrecise.ok).toBe(false);
    if (!tooPrecise.ok) expect(tooPrecise.message).toMatch(/duas casas/);
    expect(parseAdjustmentPercent('cinco').ok).toBe(false);
    expect(parseAdjustmentPercent('5,').ok).toBe(false);
  });

  it('500 bp NAO e lido como 500% (o campo antigo era em bp)', () => {
    expect(parseAdjustmentPercent('500')).toEqual({ ok: true, basisPoints: 50000 });
  });

  it.each([
    [null, ''],
    [500, '5'],
    [450, '4,5'],
    [475, '4,75'],
    [25, '0,25'],
    [0, '0'],
    [-150, '-1,5'],
  ])('editar regra com %s bp mostra "%s"', (bp, expected) => {
    expect(formatAdjustmentPercent(bp)).toBe(expected);
  });

  it('ida e volta: o que a edicao mostra grava o mesmo numero', () => {
    for (const bp of [null, 0, 1, 25, 99, 100, 450, 475, 500, 1234, -150]) {
      expect(parseAdjustmentPercent(formatAdjustmentPercent(bp))).toEqual({
        ok: true,
        basisPoints: bp,
      });
    }
  });

  it('o schema do formulario aceita percentual e recusa lixo', () => {
    const base = {
      description: 'Aluguel',
      amountInput: 'R$ 1.500,00',
      categoryId: '11111111-1111-4111-8111-111111111111',
      dueDay: '5',
      frequency: 'monthly' as const,
      accountId: '22222222-2222-4222-8222-222222222222',
      creditCardId: null,
      startsOn: '2026-09-10',
      endsOn: null,
    };
    expect(
      RecurringExpenseFormSchema.safeParse({ ...base, annualAdjustmentPercent: '5,0' }).success,
    ).toBe(true);
    const bad = RecurringExpenseFormSchema.safeParse({ ...base, annualAdjustmentPercent: 'abc' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toMatch(/percentual/);
  });
});

describe('mes em pt-BR', () => {
  it('formata competencia', () => {
    expect(formatMonthBR('2026-10')).toBe('out/2026');
    expect(formatMonthBR('2027-01')).toBe('jan/2027');
    expect(oneOffListSuffix('2026-12')).toBe(' · em dez/2026');
    expect(oneOffListSuffix(null)).toBe('');
  });

  it('opcoes do mes da receita eventual: do mes corrente para a frente', () => {
    const options = oneOffMonthOptions('2026-10-02', 3, null);
    expect(options).toEqual([
      { value: '2026-10', label: 'out/2026' },
      { value: '2026-11', label: 'nov/2026' },
      { value: '2026-12', label: 'dez/2026' },
    ]);
  });

  it('mes ja gravado fora da janela continua escolhivel', () => {
    const options = oneOffMonthOptions('2026-10-02', 2, '2025-12');
    expect(options[0]).toEqual({ value: '2025-12', label: 'dez/2025' });
    expect(options).toHaveLength(3);
  });
});

describe('textos da tela sem jargao de codigo', () => {
  const allTexts = [
    ...Object.values(expenseText).map((value) => (typeof value === 'function' ? value(12) : value)),
    incomeText.dialogDescription(12),
    incomeText.startsOnLabel('monthly'),
    incomeText.startsOnLabel('one_off'),
    incomeText.startsOnHint,
    incomeText.endsOnLabel,
    incomeText.oneOffMonthLabel,
    incomeText.oneOffMonthPlaceholder,
    incomeText.oneOffMonthHint,
    previewText.title(12),
    previewText.empty(12),
    previewText.occurrenceMonth('2026-10'),
  ];

  it.each(allTexts)('"%s"', (text) => {
    expect(text).not.toMatch(/`/);
    // camelCase (dueDay, startsOn, receiveDay...) e snake_case (one_off).
    expect(text).not.toMatch(/\b[a-z]+[A-Z][A-Za-z]*\b/);
    expect(text).not.toMatch(/\b[a-z]+_[a-z]+\b/);
    expect(text).not.toMatch(/\bbp\b|\bbanco\b|\bfolha\b|\bpreview\b|\bpiso\b/i);
  });

  it('a janela do preview vem do parametro, nao chumbada em 12', () => {
    expect(previewText.empty(6)).toContain('6 meses');
    expect(expenseText.dialogDescription(6)).toContain('6 meses');
  });
});
