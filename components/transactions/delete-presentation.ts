import { competenceLabel } from '@/components/budget/labels';
import type { DeleteEffect, DeleteImpact } from './schemas';

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

/**
 * Rótulo da opção "esta e as futuras" numa parcela, ou `null` quando não há
 * parcela futura para levar junto (ex.: a 12/12): aí a escolha não aparece,
 * porque as duas opções apagariam exatamente a mesma coisa.
 */
export function withFutureOptionLabel(futureInstallments: number): string | null {
  if (futureInstallments <= 0) return null;
  if (futureInstallments === 1) return 'Esta e a parcela futura do plano';
  return `Esta e as ${String(futureInstallments)} parcelas futuras do plano`;
}

/**
 * O que acontece se a pessoa importar o mesmo arquivo de novo. Fora do `.tsx` para
 * ser testável (o vitest não transforma JSX).
 *
 * Os três são mutuamente exclusivos (o servidor manda no máximo um):
 * - `returns_on_reimport`: a reimportação traz a linha de volta;
 * - `reimport_will_fail`: sobram parcelas projetadas cujo `dedupe_hash` a
 *   reimportação recriaria; o lote colide e falha inteiro;
 * - `stays_deleted_on_reimport`: parcela projetada cuja linha lida do arquivo
 *   continua no banco; a reimportação a pula e não projeta nada.
 */
export function reimportNotice(
  effect: Extract<
    DeleteEffect,
    { kind: 'returns_on_reimport' | 'reimport_will_fail' | 'stays_deleted_on_reimport' }
  >,
): string {
  if (effect.kind === 'returns_on_reimport') {
    return 'Se você importar este arquivo de novo, este lançamento volta.';
  }
  if (effect.kind === 'stays_deleted_on_reimport') {
    return 'Se você importar este arquivo de novo, esta parcela não volta: a compra já consta como importada.';
  }
  const one = effect.blockingInstallments === 1;
  const remaining = one
    ? 'a parcela futura deste plano existir'
    : `as ${String(effect.blockingInstallments)} parcelas futuras deste plano existirem`;
  return (
    `Se você importar este arquivo de novo, a importação vai falhar enquanto ${remaining}. ` +
    `Para poder reimportar, exclua esta junto com ${one ? 'a futura' : 'as futuras'}.`
  );
}

/**
 * Aviso de que uma previsão (`planned`) cumprida por este lançamento volta a
 * ficar em aberto ao excluí-lo.
 *
 * `competenceLabel` (mesma fonte dos meses das outras telas) usa " de "; aqui o
 * formato pedido é com barra (`outubro/2026`), então só o separador muda — os
 * nomes dos meses continuam vindo de um lugar só.
 */
export function reopensPlannedNotice(
  effect: Extract<DeleteEffect, { kind: 'reopens_planned' }>,
): string {
  const competence = competenceLabel(effect.competence).replace(' de ', '/');
  return `A previsão de ${effect.ruleDescription} de ${competence} volta a ficar em aberto.`;
}
