'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { CreditCard, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import { parseBRL } from '@/lib/money';
import { Badge, Button, DateText, EmptyState, Money, PageHeader } from '@/components/ui-kit';
import { AccountForm } from './account-form';
import { CardForm } from './card-form';
import {
  accountListSchema,
  cardListSchema,
  type AccountFormData,
  type AccountList,
  type AccountRecord,
  type CardFormData,
  type CardList,
  type CardRecord,
} from './schemas';
import { StatementList } from './statement-list';

type DialogState =
  | { kind: 'account'; record?: AccountRecord }
  | { kind: 'card'; record?: CardRecord };

const accountKindLabel: Record<AccountRecord['kind'], string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  cash: 'Dinheiro',
  brokerage: 'Corretora',
};

const brandLabel: Record<CardRecord['brand'], string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  elo: 'Elo',
  amex: 'American Express',
  other: 'Outra bandeira',
};

async function readResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error('Não foi possível concluir a operação.');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error('A resposta do servidor está inválida.');
  }
  return result.data;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível carregar os dados.';
}

type CartoesScreenProps = { today: string };

export function CartoesScreen({ today }: CartoesScreenProps) {
  const [accounts, setAccounts] = useState<AccountList['accounts']>([]);
  const [cards, setCards] = useState<CardList['cards']>([]);
  const [members, setMembers] = useState<CardList['members']>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accountsResponse, cardsResponse] = await Promise.all([
        fetch('/api/accounts', { cache: 'no-store' }),
        fetch('/api/cards', { cache: 'no-store' }),
      ]);
      const accountData = await readResponse(accountsResponse, accountListSchema);
      const cardData = await readResponse(cardsResponse, cardListSchema);
      setAccounts(accountData.accounts);
      setCards(cardData.cards);
      setMembers(cardData.members);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveAccount(values: AccountFormData, id?: string) {
    const openingBalanceCents = parseBRL(values.openingBalance);
    if (openingBalanceCents === null) {
      setError('Informe um saldo inicial válido.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(id ? `/api/accounts/${id}` : '/api/accounts', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          bank: values.bank || null,
          kind: values.kind,
          openingBalanceCents,
          openingDate: values.openingDate,
        }),
      });
      await readResponse(response, accountListSchema);
      setDialog(null);
      await load();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function saveCard(values: CardFormData, id?: string) {
    const creditLimitCents = values.creditLimit.length === 0 ? null : parseBRL(values.creditLimit);
    if (values.creditLimit.length > 0 && creditLimitCents === null) {
      setError('Informe um limite válido.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(id ? `/api/cards/${id}` : '/api/cards', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          bank: values.bank || null,
          brand: values.brand,
          holderMemberId: values.holderMemberId,
          paymentAccountId: values.paymentAccountId,
          creditLimitCents,
          closingDay: values.closingDay,
          dueDay: values.dueDay,
        }),
      });
      await readResponse(response, cardListSchema);
      setDialog(null);
      await load();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function archive(kind: 'account' | 'card', id: string, name: string) {
    if (!window.confirm(`Desativar ${kind === 'card' ? 'o cartão' : 'a conta'} "${name}"?`)) return;
    setError(null);
    try {
      const response = await fetch(`/${kind === 'card' ? 'api/cards' : 'api/accounts'}/${id}`, {
        method: 'DELETE',
      });
      if (kind === 'card') {
        await readResponse(response, cardListSchema);
      } else {
        await readResponse(response, accountListSchema);
      }
      await load();
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    }
  }

  return (
    <>
      <PageHeader
        title="Cartões e contas"
        description="Cadastre suas contas e cartões para acompanhar faturas e parcelas futuras."
        actions={
          <>
            <Button variant="outline" onClick={() => setDialog({ kind: 'account' })}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Nova conta
            </Button>
            <Button onClick={() => setDialog({ kind: 'card' })}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              Novo cartão
            </Button>
          </>
        }
      />

      {error ? (
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
          Carregando contas e cartões…
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="accounts-heading" className="text-lg font-semibold tracking-tight">Contas</h2>
                <p className="text-sm text-muted-foreground">Onde o dinheiro da família entra e sai.</p>
              </div>
            </div>
            {accounts.length === 0 ? (
              <EmptyState
                icon={Landmark}
                title="Nenhuma conta cadastrada"
                description="Cadastre a conta usada para receber receitas e pagar faturas."
                action={{ label: 'Nova conta', onClick: () => setDialog({ kind: 'account' }) }}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {accounts.map((account) => (
                  <article key={account.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">{account.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {account.bank ? `${account.bank} · ` : ''}{accountKindLabel[account.kind]}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" aria-label={`Editar ${account.name}`} onClick={() => setDialog({ kind: 'account', record: account })}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="sm" aria-label={`Desativar ${account.name}`} onClick={() => void archive('account', account.id, account.name)}>
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">Saldo inicial</dt>
                        <dd className="font-medium"><Money value={account.openingBalanceCents} /></dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Data do saldo</dt>
                        <dd className="font-medium"><DateText value={account.openingDate} /></dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="cards-heading" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 id="cards-heading" className="text-lg font-semibold tracking-tight">Cartões</h2>
                <p className="text-sm text-muted-foreground">Faturas, totais e divergências de conciliação.</p>
              </div>
            </div>
            {cards.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="Nenhum cartão cadastrado"
                description="Cadastre um cartão para acompanhar faturas por mês e parcelas futuras."
                action={{ label: 'Novo cartão', onClick: () => setDialog({ kind: 'card' }) }}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {cards.map((card) => (
                  <article key={card.id} className="rounded-lg border border-border bg-card p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">{card.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {card.bank ? `${card.bank} · ` : ''}{brandLabel[card.brand]}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 self-end sm:self-start">
                        <Button variant="ghost" size="sm" aria-label={`Editar ${card.name}`} onClick={() => setDialog({ kind: 'card', record: card })}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="sm" aria-label={`Desativar ${card.name}`} onClick={() => void archive('card', card.id, card.name)}>
                          <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                      <span>Fecha dia <strong className="font-medium text-foreground">{card.closingDay}</strong></span>
                      <span>Vence dia <strong className="font-medium text-foreground">{card.dueDay}</strong></span>
                      <span>Limite <strong className="font-medium text-foreground">{card.creditLimitCents === null ? 'Não informado' : <Money value={card.creditLimitCents} />}</strong></span>
                    </div>
                    <div className="mt-5 border-t border-border pt-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h4 className="font-medium">Faturas</h4>
                        <Badge variant="neutral">{card.statements.length} {card.statements.length === 1 ? 'fatura' : 'faturas'}</Badge>
                      </div>
                      <StatementList statements={card.statements} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-lg border border-border bg-background p-4 shadow-lg sm:max-w-2xl sm:rounded-lg sm:p-6" role="dialog" aria-modal="true" aria-labelledby="cartoes-dialog-title">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2 id="cartoes-dialog-title" className="text-lg font-semibold">
                  {dialog.kind === 'account' ? (dialog.record ? 'Editar conta' : 'Nova conta') : (dialog.record ? 'Editar cartão' : 'Novo cartão')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {dialog.kind === 'account' ? 'Os dados ficam disponíveis para o fluxo de caixa e pagamentos.' : 'Informe o ciclo da fatura para conciliar os próximos lançamentos.'}
                </p>
              </div>
              <Button variant="ghost" size="sm" aria-label="Fechar" onClick={() => setDialog(null)}>Fechar</Button>
            </div>
            {dialog.kind === 'account' ? (
              <AccountForm key={dialog.record?.id ?? 'new-account'} initial={dialog.record} today={today} busy={saving} onCancel={() => setDialog(null)} onSubmit={(values, id) => void saveAccount(values, id)} />
            ) : (
              <CardForm key={dialog.record?.id ?? 'new-card'} initial={dialog.record} accounts={accounts} members={members} busy={saving} onCancel={() => setDialog(null)} onSubmit={(values, id) => void saveCard(values, id)} />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
