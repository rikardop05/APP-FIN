'use client';

import { useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui-kit';

import {
  buildHolderBody,
  deleteHolderQuestion,
  HOLDERS_NOTE,
  holderConfirmation,
  holderRows,
  holderSubmitHint,
  looksLikeFullCardNumber,
  type HolderEvent,
  type HolderFormErrors,
  type HolderRow,
} from './holders';
import { Field, inputClassName, selectClassName } from './form-fields';
import { cardListSchema, type CardList, type CardRecord } from './schemas';

type CardHoldersProps = {
  card: CardRecord;
  members: CardList['members'];
  /** A API devolve a lista de cartões já atualizada; a tela a adota. */
  onUpdated: (next: CardList) => void;
};

async function readCardList(response: Response): Promise<CardList> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // As rotas respondem `{ error: mensagem em pt-BR }`: a pessoa vê o motivo real.
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : 'Não foi possível concluir a operação.';
    throw new Error(message);
  }
  const parsed = cardListSchema.safeParse(body);
  if (!parsed.success) throw new Error('A resposta do servidor está inválida.');
  return parsed.data;
}

/**
 * "Finais e responsáveis" (decisão 20): lista, adiciona e remove o mapeamento final (4 dígitos) ->
 * membro de UM cartão. Opcional, e a nota explica que só o Mercado Pago imprime o final na fatura hoje.
 */
export function CardHolders({ card, members, onUpdated }: CardHoldersProps) {
  const rows = holderRows(card.holders, members);
  const [last4, setLast4] = useState('');
  const [memberId, setMemberId] = useState('');
  const [errors, setErrors] = useState<HolderFormErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [event, setEvent] = useState<HolderEvent | null>(null);
  const [busy, setBusy] = useState(false);

  const hint = holderSubmitHint(card.holders, last4, members);
  const idPrefix = `holder-${card.id}`;

  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    const built = buildHolderBody({ last4, memberId }, members);
    if (!built.ok) {
      setErrors(built.errors);
      setFailure(null);
      // Número de cartão inteiro não fica escrito na tela (nem é enviado).
      if (looksLikeFullCardNumber(last4)) setLast4('');
      document.getElementById(built.errors.last4 ? `${idPrefix}-last4` : `${idPrefix}-member`)?.focus();
      return;
    }
    const replacing = hint !== null;
    setBusy(true);
    setErrors({});
    setFailure(null);
    setEvent(null);
    try {
      const response = await fetch(`/api/cards/${card.id}/holders`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(built.body),
      });
      onUpdated(await readCardList(response));
      setEvent(replacing ? 'replaced' : 'created');
      setLast4('');
      setMemberId('');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível salvar o final.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: HolderRow) {
    if (!window.confirm(deleteHolderQuestion(row))) return;
    setBusy(true);
    setFailure(null);
    setEvent(null);
    try {
      const response = await fetch(`/api/cards/${card.id}/holders/${row.id}`, { method: 'DELETE' });
      onUpdated(await readCardList(response));
      setEvent('deleted');
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Não foi possível remover o final.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-5 border-t border-border pt-4" open={rows.length > 0}>
      <summary className="cursor-pointer font-medium">
        Finais e responsáveis <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">{HOLDERS_NOTE}</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum final cadastrado neste cartão.</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span>
                <span className="font-medium tabular-nums">{row.display}</span>
                <span className="text-muted-foreground"> · {row.memberName ?? '—'}</span>
              </span>
              <Button variant="ghost" size="sm" aria-label={`Remover o final ${row.last4}`} disabled={busy} onClick={() => void remove(row)}>
                <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Final do cartão (4 dígitos)" htmlFor={`${idPrefix}-last4`} error={errors.last4}>
            <input
              id={`${idPrefix}-last4`}
              className={inputClassName}
              value={last4}
              onChange={(e) => {
                setLast4(e.target.value);
                setErrors((current) => ({ ...current, last4: undefined }));
                setEvent(null);
              }}
              inputMode="numeric"
              autoComplete="off"
              placeholder="1234"
            />
          </Field>
          <Field label="Responsável" htmlFor={`${idPrefix}-member`} error={errors.memberId}>
            <select
              id={`${idPrefix}-member`}
              className={selectClassName}
              value={memberId}
              onChange={(e) => {
                setMemberId(e.target.value);
                setErrors((current) => ({ ...current, memberId: undefined }));
                setEvent(null);
              }}
            >
              <option value="">Escolha…</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </Field>
        </div>
        {hint ? <p className="text-xs text-amber-800">{hint}</p> : null}
        {failure ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">{failure}</p> : null}
        {event ? <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" role="status">{holderConfirmation(event)}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={busy}>{busy ? 'Salvando…' : hint ? 'Trocar responsável' : 'Adicionar final'}</Button>
        </div>
      </form>
    </details>
  );
}
