import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { creditCardHolders, creditCards, members } from '@/lib/db/schema';

/**
 * Final do cartao -> membro (decisao 20). A importacao usa o mapa para sugerir
 * quem gastou (`BuildImportPreviewInput.cardHolders`); a tela de cartoes edita.
 *
 * Toda query filtra `household_id` (CONVENTIONS §7).
 */

export type CardHolderItem = { id: string; last4: string; memberId: string };

export type CardHolderMutation = { last4: string; memberId: string };

const LAST4 = /^[0-9]{4}$/;

/** Cartao inexistente ou de outro household. */
export class CardNotFoundError extends Error {
  constructor() {
    super('Cartão não encontrado.');
    this.name = 'CardNotFoundError';
  }
}

/** Final que nao e de 4 digitos, ou membro de outro household. */
export class InvalidCardHolderError extends Error {
  constructor() {
    super('Informe os 4 últimos dígitos do cartão e um membro da casa.');
    this.name = 'InvalidCardHolderError';
  }
}

/** Mapeamento inexistente, de outro cartao ou de outro household. */
export class CardHolderNotFoundError extends Error {
  constructor() {
    super('Final de cartão não encontrado.');
    this.name = 'CardHolderNotFoundError';
  }
}

/** Mapeamentos do household por cartao, cada lista ordenada por final. Cartao sem mapeamento fica fora. */
export async function listCardHolders(householdId: string): Promise<Map<string, CardHolderItem[]>> {
  const rows = await db
    .select({
      id: creditCardHolders.id,
      creditCardId: creditCardHolders.creditCardId,
      last4: creditCardHolders.last4,
      memberId: creditCardHolders.memberId,
    })
    .from(creditCardHolders)
    .where(eq(creditCardHolders.householdId, householdId))
    .orderBy(asc(creditCardHolders.creditCardId), asc(creditCardHolders.last4));

  const byCard = new Map<string, CardHolderItem[]>();
  for (const { creditCardId, ...holder } of rows) {
    const list = byCard.get(creditCardId) ?? [];
    list.push(holder);
    byCard.set(creditCardId, list);
  }
  return byCard;
}

/** Final -> memberId de um cartao: a forma que a importacao consome. */
export async function cardHoldersByLast4(
  householdId: string,
  creditCardId: string,
): Promise<Map<string, string>> {
  const rows = await db
    .select({ last4: creditCardHolders.last4, memberId: creditCardHolders.memberId })
    .from(creditCardHolders)
    .where(
      and(
        eq(creditCardHolders.householdId, householdId),
        eq(creditCardHolders.creditCardId, creditCardId),
      ),
    );
  return new Map(rows.map((row) => [row.last4, row.memberId]));
}

/**
 * Grava o dono de um final no cartao. O par (cartao, final) e unico: gravar de
 * novo o mesmo final troca o membro, nao duplica.
 */
export async function upsertCardHolder(
  householdId: string,
  creditCardId: string,
  input: CardHolderMutation,
): Promise<void> {
  const [card] = await db
    .select({ id: creditCards.id })
    .from(creditCards)
    .where(and(eq(creditCards.id, creditCardId), eq(creditCards.householdId, householdId)))
    .limit(1);
  if (!card) throw new CardNotFoundError();

  if (!LAST4.test(input.last4)) throw new InvalidCardHolderError();
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.id, input.memberId), eq(members.householdId, householdId)))
    .limit(1);
  if (!member) throw new InvalidCardHolderError();

  await db
    .insert(creditCardHolders)
    .values({ householdId, creditCardId, last4: input.last4, memberId: input.memberId })
    .onConflictDoUpdate({
      target: [creditCardHolders.creditCardId, creditCardHolders.last4],
      set: { memberId: input.memberId, updatedAt: sql`now()` },
      // Defesa em profundidade: o banco nao amarra o household do mapeamento ao
      // do cartao; o cartao ja foi conferido acima, e isto fecha o resto.
      setWhere: eq(creditCardHolders.householdId, householdId),
    });
}

export async function deleteCardHolder(
  householdId: string,
  creditCardId: string,
  holderId: string,
): Promise<void> {
  const deleted = await db
    .delete(creditCardHolders)
    .where(
      and(
        eq(creditCardHolders.id, holderId),
        eq(creditCardHolders.creditCardId, creditCardId),
        eq(creditCardHolders.householdId, householdId),
      ),
    )
    .returning({ id: creditCardHolders.id });
  if (deleted.length === 0) throw new CardHolderNotFoundError();
}
