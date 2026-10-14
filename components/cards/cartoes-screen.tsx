'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { CreditCard, Landmark, Pencil, Plus } from 'lucide-react';
import { cents, parseBRL, type Cents } from '@/lib/money';
import { futureCommitment } from '@/lib/finance/commitment';
import { Badge, Button, DateText, EmptyState, Faixa, LoadingBlock, Money, PageHeader } from '@/components/ui-kit';
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
import { CardHolders } from './card-holders';
import { StatementList } from './statement-list';
import { futureStubsForCard } from './card-stubs';
import { toCompetence } from '@/lib/date';
import { CommitmentSection } from './commitment/commitment-section';
import type { CommitmentInput } from '@/lib/finance/commitment';

type DialogState =
  | { kind: 'account'; record?: AccountRecord }
  | { kind: 'card'; record?: CardRecord };

type ArchiveTarget = { kind: 'account' | 'card'; id: string; name: string };

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

type CartoesScreenProps = {
  today: string;
  /** `household_settings.commitment_months`, lido no servidor como no painel. */
  commitmentMonths: number;
  /** Do servidor (`listCommitmentTransactions`): o mesmo recorte do painel. */
  commitmentTransactions: CommitmentInput['transactions'];
};

/**
 * Confirmar desativação no mundo (nada de `confirm` nativo): Faixa com o texto em tinta,
 * botão destructive em pt-BR e a consequência calculada pelo motor. `usedCents` é o
 * comprometimento do cartão na janela (`limitUsage`, negativo); `null` = conta, que não
 * tem comprometimento e sim saldo inicial no fluxo.
 */
function ArchiveConfirmDialog({
  target,
  commitmentMonths,
  usedCents,
  busy,
  onCancel,
  onConfirm,
}: {
  target: { kind: 'account' | 'card'; id: string; name: string };
  commitmentMonths: number;
  usedCents: Cents | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const kindNoun = target.kind === 'card' ? 'o cartão' : 'a conta';
  // Foco entra no diálogo ao abrir e volta ao gatilho ao fechar; Escape cancela.
  // O `onCancel` vai num ref para o efeito rodar uma vez só (ouvido + devolução).
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    const previous = document.activeElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="max-h-[90vh] w-full overflow-y-auto border border-border bg-background p-4 shadow-lg sm:max-w-xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="archive-dialog-title">
        <h2 id="archive-dialog-title" className="text-lg font-semibold">
          Desativar {kindNoun} &ldquo;{target.name}&rdquo;?
        </h2>
        <Faixa tone="attention" title="O que acontece" className="mt-3">
          {target.kind === 'card' ? (
            <p>
              {usedCents !== null && usedCents < 0 ? (
                <>O comprometimento de <Money value={cents(-usedCents)} sign="never" /> nos próximos {commitmentMonths} meses deixa de contar. </>
              ) : (
                <>Este cartão não tem nada comprometido nos próximos {commitmentMonths} meses. </>
              )}
              Ele some das listas e seleções; os lançamentos já registrados ficam.
            </p>
          ) : (
            <p>
              A conta some das listas e seleções, e o saldo inicial dela deixa de entrar no fluxo de caixa.
              Os lançamentos já registrados ficam.
            </p>
          )}
        </Faixa>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onCancel} disabled={busy} autoFocus>
            Manter {kindNoun}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? 'Desativando…' : `Desativar ${kindNoun}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CartoesScreen({ today, commitmentMonths, commitmentTransactions }: CartoesScreenProps) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<AccountList['accounts']>([]);
  const [cards, setCards] = useState<CardList['cards']>([]);
  const [members, setMembers] = useState<CardList['members']>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  /**
   * Alvo da confirmação de desativar, SOBRE o editor (o editor continua montado atrás:
   * "Manter" volta para os campos com o que foi digitado intacto).
   */
  const [confirmTarget, setConfirmTarget] = useState<ArchiveTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `silent`: recarrega sem trocar a lista por "Carregando" (o feedback do botão de fatura paga fica à vista).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
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

  // Fatura marcada ou desmarcada como paga: refaz as faturas aqui e o comprometido no servidor.
  const statusChanged = useCallback(() => {
    void load(true);
    router.refresh();
  }, [load, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Comprometimento por cartão na janela, do motor (`futureCommitment`, Esquadro): alimenta o
   * texto de consequência do diálogo de desativar. A tela não soma nada — só procura o cartão.
   */
  const usedByCard = useMemo(() => {
    const result = futureCommitment({
      fromCompetence: toCompetence(today),
      months: commitmentMonths,
      cards: cards.map((card) => ({ id: card.id, name: card.name, creditLimitCents: card.creditLimitCents })),
      transactions: commitmentTransactions,
    });
    return new Map(result.limitUsage.map((item) => [item.cardId, item.usedCents]));
  }, [cards, commitmentTransactions, commitmentMonths, today]);

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
      router.refresh();
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
      // As linhas do comprometimento vêm do servidor: sem refresh ficariam na foto
      // do primeiro render, e o limite recém-salvo usaria transações velhas.
      router.refresh();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Desativar é soft (`active = false`, o histórico fica): conta some das listas e o saldo
   * inicial dela deixa de entrar no fluxo; cartão deixa de contar no comprometimento. O
   * diálogo que chama esta função já mostrou a consequência — aqui não há `confirm` nativo.
   */
  async function archive(kind: 'account' | 'card', id: string) {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/${kind === 'card' ? 'api/cards' : 'api/accounts'}/${id}`, {
        method: 'DELETE',
      });
      if (kind === 'card') {
        await readResponse(response, cardListSchema);
      } else {
        await readResponse(response, accountListSchema);
      }
      setDialog(null);
      setConfirmTarget(null);
      await load();
      router.refresh();
    } catch (archiveError) {
      setError(errorMessage(archiveError));
    } finally {
      setSaving(false);
    }
  }

  /** Registro aberto no editor (conta ou cartão): `const` para o estreitamento valer no `onDeactivate`. */
  const editingRecord = dialog !== null ? dialog.record : undefined;

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
        <div role="alert" className="flex flex-col gap-3 border border-destructive/50 bg-destructive-soft px-4 py-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Tentar novamente
          </Button>
        </div>
      ) : null}

      <LoadingBlock
        loading={loading}
        endText={error === null ? 'Contas e cartões carregados.' : null}
        label="Carregando contas e cartões…"
        count={4}
        retry={() => void load()}
      />
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
                  <article key={account.id} className="border border-border bg-card p-4">
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
                      <div className="flex shrink-0 items-center">
                        <Button variant="ghost" size="sm" aria-label={`Editar ${account.name}`} onClick={() => setDialog({ kind: 'account', record: account })}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
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
                  <article key={card.id} className="border border-border bg-card p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <div className="min-w-0">
                          <h3 className="truncate font-medium">{card.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {card.bank ? `${card.bank} · ` : ''}{brandLabel[card.brand]}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center">
                        <Button variant="ghost" size="sm" aria-label={`Editar ${card.name}`} onClick={() => setDialog({ kind: 'card', record: card })}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                      <span>Fecha dia <strong className="font-medium text-foreground">{card.closingDay}</strong></span>
                      <span>Vence dia <strong className="font-medium text-foreground">{card.dueDay}</strong></span>
                      <span>Limite <strong className="font-medium text-foreground">{card.creditLimitCents === null ? 'Não informado' : <Money value={card.creditLimitCents} />}</strong></span>
                    </div>
                    <CardHolders
                      card={card}
                      members={members}
                      onUpdated={(next) => {
                        setCards(next.cards);
                        setMembers(next.members);
                      }}
                    />
                    <div className="mt-5 border-t border-border pt-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h4 className="font-medium">Faturas</h4>
                        <Badge variant="neutral">{card.statements.length} {card.statements.length === 1 ? 'fatura' : 'faturas'}</Badge>
                      </div>
                      <StatementList statements={card.statements} cycle={{ closingDay: card.closingDay, dueDay: card.dueDay }} today={today}
                        futureStubs={futureStubsForCard({
                          card,
                          transactions: commitmentTransactions,
                          statementPeriods: card.statements.map((statement) => statement.period),
                          fromCompetence: toCompetence(today),
                          months: commitmentMonths,
                        })}
                        onStatusChanged={statusChanged} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {cards.length > 0 ? <CommitmentSection cards={cards} transactions={commitmentTransactions} months={commitmentMonths} today={today} /> : null}
      </div>

      {confirmTarget ? (
        <ArchiveConfirmDialog
          target={confirmTarget}
          commitmentMonths={commitmentMonths}
          usedCents={confirmTarget.kind === 'card' ? (usedByCard.get(confirmTarget.id) ?? cents(0)) : null}
          busy={saving}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={() => void archive(confirmTarget.kind, confirmTarget.id)}
        />
      ) : null}

      {dialog ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null); }}>
          <div className="max-h-[90vh] w-full overflow-y-auto border border-border bg-background p-4 shadow-lg sm:max-w-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="cartoes-dialog-title">
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
              <AccountForm
                key={dialog.record?.id ?? 'new-account'}
                initial={dialog.record}
                today={today}
                busy={saving}
                onCancel={() => setDialog(null)}
                onSubmit={(values, id) => void saveAccount(values, id)}
                onDeactivate={
                  editingRecord === undefined
                    ? undefined
                    : () => setConfirmTarget({ kind: 'account', id: editingRecord.id, name: editingRecord.name })
                }
              />
            ) : (
              <CardForm
                key={dialog.record?.id ?? 'new-card'}
                initial={dialog.record}
                accounts={accounts}
                members={members}
                busy={saving}
                onCancel={() => setDialog(null)}
                onSubmit={(values, id) => void saveCard(values, id)}
                onDeactivate={
                  editingRecord === undefined
                    ? undefined
                    : () => setConfirmTarget({ kind: 'card', id: editingRecord.id, name: editingRecord.name })
                }
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
