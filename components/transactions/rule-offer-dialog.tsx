'use client';

import { useEffect, useState } from 'react';
import { Button, Input } from '@/components/ui-kit';
import { ruleOfferDescription } from './rule-offer-presentation';
import { DialogShell } from './transaction-dialogs';
import type { RuleOffer } from './schemas';

/** Espera depois da ultima tecla antes de recalcular o efeito. */
const PREVIEW_DELAY_MS = 400;

/**
 * Oferta de regra depois de categorizar a mao (F5): um clique para criar, com o
 * efeito dito antes.
 *
 * O trecho pode ser editado, e o efeito e RECALCULADO para ele (achado do
 * Corvo): "Criar regra" so fica disponivel quando o efeito mostrado e o do
 * trecho que esta no campo. Trecho que nao casa os lancamentos categorizados
 * nao vira regra. Erro ao criar mantem o dialogo aberto, com o trecho.
 */
export function RuleOfferDialog({
  initialOffer,
  busy,
  onClose,
  onPreview,
  onAccept,
}: {
  initialOffer: RuleOffer;
  busy: boolean;
  onClose: () => void;
  /** Oferta recalculada para o trecho editado; null = o trecho nao casa a origem. */
  onPreview: (pattern: string) => Promise<RuleOffer | null>;
  /** Devolve a mensagem de erro, ou null quando deu certo. */
  onAccept: (offer: RuleOffer) => Promise<string | null>;
}) {
  const [pattern, setPattern] = useState(initialOffer.pattern);
  const [offer, setOffer] = useState<RuleOffer | null>(initialOffer);
  const [previewedFor, setPreviewedFor] = useState(initialOffer.pattern);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (pattern === previewedFor) return;
    const trimmed = pattern.trim();
    if (trimmed === '') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void onPreview(trimmed)
        .then((next) => {
          if (cancelled) return;
          setOffer(next);
          setPreviewedFor(pattern);
          setProblem(next === null ? 'O trecho precisa aparecer na descrição dos lançamentos que você categorizou.' : null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          // Marca o trecho como tentado: sem isso o dialogo fica preso em
          // "Recalculando…" e o erro nao aparece. Sem oferta, o botao segue
          // desabilitado.
          setOffer(null);
          setPreviewedFor(pattern);
          setProblem(error instanceof Error ? error.message : 'Não foi possível recalcular o efeito.');
        });
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pattern, previewedFor, onPreview]);

  const current = pattern === previewedFor ? offer : null;
  const checking = pattern !== previewedFor && pattern.trim() !== '';

  async function submit() {
    if (current === null) return;
    const error = await onAccept(current);
    if (error !== null) setProblem(error);
  }

  return (
    <DialogShell
      title={`Criar regra para ${initialOffer.categoryName}?`}
      description="A regra entra no topo da lista e passa a categorizar sozinha as próximas importações."
      onClose={onClose}
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Trecho da descrição (contém)</span>
          <Input value={pattern} onChange={(event) => setPattern(event.target.value)} required maxLength={120} />
        </label>
        <p className="text-sm" role="status">
          {checking ? 'Recalculando o efeito…' : current !== null ? ruleOfferDescription(current) : null}
        </p>
        {problem !== null && !checking ? <p role="alert" className="text-sm text-red-700">{problem}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Agora não</Button>
          <Button type="submit" disabled={busy || current === null}>{busy ? 'Criando…' : 'Criar regra'}</Button>
        </div>
      </form>
    </DialogShell>
  );
}
