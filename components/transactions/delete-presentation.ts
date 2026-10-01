import type { DeleteImpact } from './schemas';

/**
 * Qual das duas confirmações de exclusão mostrar.
 *
 * **O critério NÃO é "foi digitado à mão"; é se a lista de efeitos sai vazia.** O
 * servidor já calcula isso em `GET .../delete-impact`:
 *
 * - **simples**: a exclusão é só a linha (um aviso curto de que vai sumir);
 * - **detalhada**: a exclusão alcança ALÉM da linha, e o diálogo lista só os
 *   efeitos que existem.
 *
 * Assim, se um lançamento manual um dia ganhar efeito colateral, ele passa a
 * mostrar o diálogo cheio sozinho, sem ninguém lembrar de atualizar uma lista de
 * tipos. Apagar parcelas futuras nunca é "só a linha", mesmo que a lista de
 * efeitos viesse vazia: por isso `futureInstallments` também conta.
 */
export function isSimpleDelete(impact: Pick<DeleteImpact, 'effects' | 'deleted'>): boolean {
  return impact.effects.length === 0 && impact.deleted.futureInstallments === 0;
}
