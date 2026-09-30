/**
 * Espelho de enums puros x enums do banco — CONVENTIONS §5, nota do T-115.
 *
 * ## Por que este teste existe
 *
 * `TransactionKind` e `CategoryNature` existem DUAS vezes: derivados do `pgEnum`
 * em `lib/db/enums.ts` (fonte de verdade, do banco) e redigitados como uniao
 * literal em `lib/finance/kpis.ts` (camada pura). A duplicacao e NECESSARIA:
 * CONVENTIONS §5 proibe `/lib/finance` de importar `/lib/db`, e o ESLint reprova
 * o import — inclusive o de tipo — entao o espelho e a unica saida.
 *
 * O espelho esta certo; o risco e ele DIVERGIR em silencio. `kpis.ts` ja avisa
 * num comentario que os literais tem de acompanhar o banco, mas comentario nao
 * impede divergencia: um `kind` novo no banco nao quebra nada, e o KPI deixa de
 * cobrir o caso sem que teste nenhum fique vermelho. E a mesma licao dos tracos
 * de menos do gate T-116, onde duas listas da mesma coisa (a de `lib/money` e a
 * de `lib/import/pdf/shared.ts`) divergiram e so a arbitragem humana pegou.
 * Comentario avisa; TESTE impede.
 *
 * ## Por que mora em `tests/` e nao ao lado do codigo
 *
 * Este arquivo precisa importar `lib/db/enums` E `lib/finance/kpis` ao mesmo
 * tempo — e um teste dentro de `lib/finance/` nao pode, pela propria regra de
 * camada que ele existe para proteger. `tests/` fica FORA de `PURE_DIRS` no
 * `eslint.config.mjs`, entao aqui os dois imports convivem. Mover este teste
 * para perto do codigo (instinto natural de quem le depois) o faz falhar no
 * lint, por um motivo que nao esta obvio no lugar novo. E por isso que ele mora
 * aqui.
 *
 * ## O que ele garante
 *
 * Os MEMBROS dos dois lados, nos DOIS sentidos, porque a camada pura exporta os
 * literais em runtime (`lib/finance/enum-mirrors.ts`) e este teste compara o
 * banco com essa exportacao REAL — nao com uma copia propria. Quebra tanto quando
 * alguem acrescenta um valor no `pgEnum` do banco quanto quando alguem acrescenta
 * so na camada pura. A comparacao e sobre os valores de runtime (`enumValues` e
 * os arrays exportados), nao sobre os tipos, que nao existem em runtime.
 *
 * Antes de `enum-mirrors.ts` existir, `kpis.ts` e `commitment.ts` tinham cada um
 * a sua lista e o teste redigitava uma terceira — mudar so a camada pura ficava
 * verde. Um enum redigitado ja divergiu de verdade durante o T-204, entao a
 * lacuna era real, nao teorica.
 */

import { describe, expect, it } from 'vitest';

import { categoryNature, transactionKind, transactionStatus } from '@/lib/db/enums';
import {
  CATEGORY_NATURES,
  TRANSACTION_KINDS,
  TRANSACTION_STATUSES,
} from '@/lib/finance/enum-mirrors';

/**
 * A camada pura exporta os literais em runtime (`lib/finance/enum-mirrors.ts`),
 * entao o teste compara o banco com a UNIAO REAL — nao com uma copia propria.
 * Isso fecha as duas direcoes: mudar o banco quebra, e mudar so a camada pura
 * tambem, porque o array comparado e o que o codigo de fato usa.
 */

/** Diferenca simetrica: o que esta em um lado e nao no outro, nos dois sentidos. */
function symmetricDifference(a: readonly string[], b: readonly string[]): string[] {
  const setA = new Set(a);
  const setB = new Set(b);
  const onlyA = [...setA].filter((value) => !setB.has(value));
  const onlyB = [...setB].filter((value) => !setA.has(value));
  return [...onlyA, ...onlyB].sort();
}

describe('espelho de enums: lib/finance/enum-mirrors.ts x lib/db/enums.ts', () => {
  it('TransactionKind: a uniao pura e igual ao transaction_kind do banco', () => {
    const diff = symmetricDifference(transactionKind.enumValues, TRANSACTION_KINDS);
    expect(diff).toEqual([]);
  });

  it('CategoryNature: a uniao pura e igual ao category_nature do banco', () => {
    const diff = symmetricDifference(categoryNature.enumValues, CATEGORY_NATURES);
    expect(diff).toEqual([]);
  });

  it('transaction_status: posted/planned e igual ao banco', () => {
    const diff = symmetricDifference(
      transactionStatus.enumValues,
      TRANSACTION_STATUSES,
    );
    expect(diff).toEqual([]);
  });

  it('acusa divergencia nos DOIS sentidos (prova do proprio detector)', () => {
    // Um valor so no banco e um valor so na pura tem de aparecer, para o teste
    // nao passar com uma comparacao de direcao unica.
    expect(symmetricDifference(['a', 'b', 'c'], ['a', 'b'])).toEqual(['c']);
    expect(symmetricDifference(['a', 'b'], ['a', 'b', 'c'])).toEqual(['c']);
    expect(symmetricDifference(['a'], ['a'])).toEqual([]);
  });
});
