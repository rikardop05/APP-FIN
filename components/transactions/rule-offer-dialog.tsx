'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui-kit';
import { ruleOfferDescription } from './rule-offer-presentation';
import { DialogShell } from './transaction-dialogs';
import type { RuleOffer } from './schemas';

/**
 * Oferta de regra depois de categorizar a mao (F5): um clique para criar, com o
 * efeito dito antes. O padrao pode ser ajustado; as linhas categorizadas agora
 * sao exatamente as da oferta.
 */
export function RuleOfferDialog({
  offer,
  busy,
  onClose,
  onAccept,
}: {
  offer: RuleOffer;
  busy: boolean;
  onClose: () => void;
  onAccept: (pattern: string) => Promise<void>;
}) {
  const [pattern, setPattern] = useState(offer.pattern);
  return (
    <DialogShell
      title={`Criar regra para ${offer.categoryName}?`}
      description={ruleOfferDescription(offer)}
      onClose={onClose}
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void onAccept(pattern); }}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Trecho da descrição (contém)</span>
          <Input value={pattern} onChange={(event) => setPattern(event.target.value)} required maxLength={120} />
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Agora não</Button>
          <Button type="submit" disabled={busy || pattern.trim() === ''}>{busy ? 'Criando…' : 'Criar regra'}</Button>
        </div>
      </form>
    </DialogShell>
  );
}
