import { todayInSaoPaulo } from '@/app/_lib/today';
import { RecurringScreen } from '@/components/recurring/recurring-screen';
import { PageHeader } from '@/components/ui-kit';
import { requireSession } from '@/lib/auth/session';
import { listAccounts, listCards, listMembers } from '@/lib/db/queries/cards';
import { listCategories } from '@/lib/db/queries/categories';
import { topUpPlanned } from '@/lib/db/queries/recurring-planned-write';
import {
  listIncomes,
  listRecurringExpenses,
} from '@/lib/db/queries/recurring';
import { getSettings } from '@/lib/db/queries/settings';

/**
 * Tela de despesas fixas e receitas (T-204). Server Component que carrega
 * as três consultas independentes em paralelo — categorias (folha), contas,
 * cartões, membros, despesas fixas e receitas — e entrega à `RecurringScreen`
 * (client) que monta a lista e os diálogos.
 *
 * Posse: `app/(app)/orcamento/recorrentes/**`. O motor de recorrência está
 * em `lib/finance/recurrence.ts` (T-201) e a borda do banco em
 * `lib/db/queries/recurring.ts` — esta página só consome.
 */

export const dynamic = 'force-dynamic';

export default async function RecorrentesPage() {
  const { householdId } = await requireSession();
  const today = todayInSaoPaulo();
  // Completa a previsão que falta ate o horizonte. Nunca lança: se falhar, a
  // tela segue com o que existe (o erro vai para o log do servidor).
  await topUpPlanned(householdId, today);

  const [expenses, incomes, categories, accounts, cards, members, settings] =
    await Promise.all([
      listRecurringExpenses(householdId),
      listIncomes(householdId),
      listCategories(householdId),
      listAccounts(householdId),
      listCards(householdId),
      listMembers(householdId),
      getSettings(householdId),
    ]);

  return (
    <>
      <PageHeader
        title="Despesas fixas e receitas"
        description="O que se repete todo mês: aluguel, salário, assinaturas. O motor projeta as ocorrências previstas; esta tela só exibe."
      />
      <RecurringScreen
        today={today}
        previewMonths={settings.projectionMonths}
        expenses={expenses}
        incomes={incomes}
        recurringOptions={{
          // Apenas folhas — despesa fixa exige categoria-folha (RF-CAT-01),
          // a borda do banco recusa raiz no POST.
          categories: categories.filter((category) => category.parentId !== null),
          accounts: accounts.filter((account) => account.active),
          cards: cards.filter((card) => card.active),
        }}
        incomeOptions={{
          members,
          accounts: accounts
            .filter((account) => account.active)
            .map((account) => ({ id: account.id, name: account.name })),
        }}
      />
    </>
  );
}
