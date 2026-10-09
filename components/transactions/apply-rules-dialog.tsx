'use client';

import { useState } from 'react';
import { Button, Checkbox, DateText, Money } from '@/components/ui-kit';
import { confirmedItems, previewLimitNotice } from './apply-rules-presentation';
import { DialogShell } from './transaction-dialogs';
import type { RuleApplicationProposal } from './schemas';

/**
 * Previa de "aplicar regras" (F3): nada e gravado sem o usuario ver a lista.
 * Cada linha vem marcada; desmarcar tira a linha do lote. O que vai para o
 * servidor sao EXATAMENTE as linhas marcadas desta previa.
 */
export function ApplyRulesDialog({
  title,
  proposals,
  total,
  busy,
  onClose,
  onConfirm,
}: {
  title: string;
  proposals: RuleApplicationProposal[];
  /** Total que as regras pegariam; maior que `proposals.length` quando a previa veio cortada. */
  total: number;
  busy: boolean;
  onClose: () => void;
  onConfirm: (items: { transactionId: string; ruleId: string; categoryId: string }[]) => Promise<void>;
}) {
  const [unchecked, setUnchecked] = useState<Set<string>>(() => new Set());
  const items = confirmedItems(proposals, unchecked);
  const limitNotice = previewLimitNotice(proposals.length, total);

  function toggle(transactionId: string) {
    setUnchecked((previous) => {
      const next = new Set(previous);
      if (next.has(transactionId)) next.delete(transactionId);
      else next.add(transactionId);
      return next;
    });
  }

  return (
    <DialogShell
      title={title}
      description="Confira antes de gravar. Só lançamentos sem categoria entram; desmarque o que não deve receber a categoria da regra."
      onClose={onClose}
    >
      {proposals.length === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">Nenhum lançamento sem categoria é reconhecido pelas regras ativas.</p>
          <div className="flex justify-end"><Button type="button" variant="ghost" onClick={onClose}>Fechar</Button></div>
        </div>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void onConfirm(items); }}>
          {limitNotice ? <p className="text-sm text-muted-foreground">{limitNotice}</p> : null}
          <ul className="flex flex-col divide-y divide-border border border-border">
            {proposals.map((proposal) => (
              <li key={proposal.transactionId} className="flex items-start gap-3 px-3 py-2 text-sm">
                <Checkbox
                  aria-label={`Aplicar a regra em ${proposal.description}`}
                  checked={!unchecked.has(proposal.transactionId)}
                  onChange={() => toggle(proposal.transactionId)}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium" title={proposal.description}>{proposal.description}</span>
                  <span className="text-xs text-muted-foreground">
                    <DateText value={proposal.occurredOn} /> · regra &ldquo;{proposal.rulePattern}&rdquo; → {proposal.categoryName}
                  </span>
                </div>
                <span className="whitespace-nowrap"><Money value={proposal.amountCents} /></span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Agora não</Button>
            <Button type="submit" disabled={busy || items.length === 0}>
              {busy ? 'Aplicando…' : `Aplicar a ${String(items.length)} lançamento${items.length === 1 ? '' : 's'}`}
            </Button>
          </div>
        </form>
      )}
    </DialogShell>
  );
}
