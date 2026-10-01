'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui-kit';
import { formatDateBR } from '@/lib/date';

import { cardPatchBody, competenceMismatch, type CompetenceMismatch } from './competence-warning';
import { apiErrorSchema, cardsFullResponseSchema, type SourceKind, type UploadResponse } from './schemas';

type CardCycle = NonNullable<UploadResponse['cardCycle']>;

type CompetenceWarningBannerProps = {
  sourceKind: SourceKind;
  sourceId: string;
  /** Nome do cartão, para a frase ("o cartão SANTANDER está cadastrado…"). */
  sourceName: string;
  /** Ciclo VIGENTE: o do upload, ou o que o usuário acabou de corrigir aqui. */
  cardCycle: UploadResponse['cardCycle'];
  declaredCompetence: string;
  documentDate: UploadResponse['preview']['documentDate'];
  /** Chamado com o ciclo que o SERVIDOR confirmou depois do `PATCH`. */
  onCycleChanged: (cycle: CardCycle) => void;
};

function formatCompetence(competence: string): string {
  return `${competence.slice(5)}/${competence.slice(0, 4)}`;
}

/**
 * Aviso de competência divergente (avisa, NÃO bloqueia) e, num único caso, a
 * oferta do conserto.
 *
 * A oferta só existe em `registration` (mesmo mês, dia diferente) e só com
 * `mismatch.fix` — o dia a oferecer, sustentado pela evidência. Em `competence` o
 * errado é o que a pessoa digitou no campo de competência, não o cartão: oferecer
 * "corrigir" ali pioraria o cadastro para consertar um upload. `closingDay` nunca é
 * inferido nem alterado: o documento não o diz.
 *
 * Mudar o ciclo muda o cálculo de TODA importação futura do cartão, e a tela diz
 * isso antes do clique de confirmação. Quem decide é o usuário: nada é corrigido
 * sozinho, e o conserto são dois cliques (oferecer → confirmar).
 *
 * Depois do `PATCH`, o ciclo vigente sobe para o pai com o valor que o servidor
 * DEVOLVEU. O pai o usa na comparação (o aviso é recalculado de verdade, e some
 * porque o esperado passou a ser o impresso, não porque foi escondido) e no
 * `recalculate`, que recebe o ciclo do cliente — sem isso a prévia seria calculada
 * com o ciclo velho e o commit, que lê do banco, com o novo.
 *
 * NÃO reescreve fatura gravada: `statements.due_date` é persistido e a importação
 * reaproveita a fatura que já existe para (cartão, competência).
 */
export function CompetenceWarningBanner({
  sourceKind,
  sourceId,
  sourceName,
  cardCycle,
  declaredCompetence,
  documentDate,
  onCycleChanged,
}: CompetenceWarningBannerProps) {
  const mismatch = competenceMismatch({ sourceKind, cardCycle, declaredCompetence, documentDate });
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fixedDay, setFixedDay] = useState<number | null>(null);

  async function applyFix(dueDay: number) {
    setPhase('saving');
    setError(null);
    try {
      // `PATCH /api/cards/[id]` SUBSTITUI o cartão inteiro: omitir banco, titular ou
      // conta de pagamento os zeraria. Lê o cartão agora e devolve tudo como está,
      // só com o vencimento trocado.
      const current = await fetch('/api/cards');
      const currentBody: unknown = await current.json().catch(() => null);
      if (!current.ok) throw new Error(readApiError(currentBody, 'Não foi possível ler o cartão.'));
      const card = cardsFullResponseSchema.parse(currentBody).cards.find((item) => item.id === sourceId);
      if (card === undefined) throw new Error('Este cartão não foi encontrado (talvez esteja desativado).');

      const response = await fetch(`/api/cards/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cardPatchBody(card, dueDay)),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readApiError(body, 'Não foi possível atualizar o cartão.'));
      const updated = cardsFullResponseSchema.parse(body).cards.find((item) => item.id === sourceId);
      if (updated === undefined) throw new Error('O cartão não voltou na resposta; recarregue a página.');

      setFixedDay(updated.dueDay);
      setPhase('idle');
      onCycleChanged({ closingDay: updated.closingDay, dueDay: updated.dueDay });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar o cartão.');
      setPhase('confirming');
    }
  }

  if (mismatch === null) {
    if (fixedDay === null) return null;
    return (
      <div
        role="status"
        className="mt-4 flex gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p>
            Cartão atualizado: agora vence no dia <strong className="font-semibold">{fixedDay}</strong>. A competência
            esperada foi recalculada com isso e bate com o documento.
          </p>
          <p className="text-xs text-emerald-900/80">
            Faturas que já estavam gravadas não mudam; o novo vencimento vale para as próximas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mt-4 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <BannerText mismatch={mismatch} sourceName={sourceName} />

        {mismatch.kind === 'registration' && mismatch.fix !== null ? (
          <div className="mt-1 flex flex-col gap-2">
            {phase === 'idle' ? (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setPhase('confirming');
                  }}
                >
                  Corrigir para dia {mismatch.fix.dueDay}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 rounded-md border border-amber-300 bg-background p-3">
                <p>
                  Mudar o vencimento de <strong className="font-semibold">{sourceName}</strong> do dia{' '}
                  {mismatch.registeredDueDay} para o dia {mismatch.fix.dueDay}? Isto muda como as próximas faturas deste
                  cartão são calculadas.
                </p>
                <p className="text-xs text-muted-foreground">
                  Faturas já gravadas não são alteradas. O dia de fechamento não muda.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={phase === 'saving'} onClick={() => void applyFix(mismatch.fix?.dueDay ?? 0)}>
                    {phase === 'saving' ? 'Salvando…' : `Sim, vence dia ${mismatch.fix.dueDay}`}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={phase === 'saving'} onClick={() => setPhase('idle')}>
                    Cancelar
                  </Button>
                </div>
                {error !== null ? (
                  <p role="alert" className="text-xs text-red-800">
                    {error}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function readApiError(body: unknown, fallback: string): string {
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

function BannerText({ mismatch, sourceName }: { mismatch: CompetenceMismatch; sourceName: string }) {
  const printed = formatDateBR(mismatch.printedDueDate);
  const expected = formatDateBR(mismatch.expectedDueDate);
  const declared = formatCompetence(mismatch.declaredCompetence);

  if (mismatch.kind === 'registration') {
    return (
      <>
        <p className="font-medium">O cadastro do cartão pode estar errado.</p>
        <p>
          Esta fatura vence em <strong className="font-semibold">{printed}</strong>, mas o cartão{' '}
          <strong className="font-semibold">{sourceName}</strong> está cadastrado para vencer no dia{' '}
          <strong className="font-semibold">{mismatch.registeredDueDay}</strong> (para a competência{' '}
          <strong className="font-semibold">{declared}</strong> o sistema esperava{' '}
          <strong className="font-semibold">{expected}</strong>). A competência declarada parece certa.
        </p>
        <p className="text-xs text-amber-900/80">
          Um ciclo errado desloca a competência de toda importação futura deste cartão.{' '}
          {mismatch.fix === null ? (
            <>
              Não dá para corrigir só o dia: o fechamento também pode estar errado. Confira os dois em{' '}
              <Link href="/cartoes" className="underline underline-offset-2">
                Cartões
              </Link>
              .{' '}
            </>
          ) : (
            <>
              Você também pode conferir em{' '}
              <Link href="/cartoes" className="underline underline-offset-2">
                Cartões
              </Link>
              .{' '}
            </>
          )}
          Nada foi bloqueado: você pode seguir.
        </p>
      </>
    );
  }

  if (mismatch.kind === 'competence') {
    return (
      <>
        <p className="font-medium">A competência pode estar errada.</p>
        <p>
          Este documento imprime vencimento em <strong className="font-semibold">{printed}</strong>. Você declarou a
          competência <strong className="font-semibold">{declared}</strong>, para a qual o sistema esperava vencimento
          em <strong className="font-semibold">{expected}</strong>.
        </p>
        <p className="text-xs text-amber-900/80">
          Se a competência estiver errada, use &ldquo;Voltar para a entrada&rdquo; e troque antes de confirmar. Se lançou
          de propósito (por exemplo, uma fatura antiga), pode seguir: nada foi bloqueado.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="font-medium">O vencimento impresso não bate com o esperado.</p>
      <p>
        Este documento imprime vencimento em <strong className="font-semibold">{printed}</strong>. Para a competência{' '}
        <strong className="font-semibold">{declared}</strong> o sistema esperava{' '}
        <strong className="font-semibold">{expected}</strong>, e a data impressa também não é o vencimento de nenhuma
        competência próxima deste cartão.
      </p>
      <p className="text-xs text-amber-900/80">
        Pode ser a competência ou o cadastro do cartão (vencimento dia {mismatch.registeredDueDay}). Confira os dois — o
        cadastro fica em{' '}
        <Link href="/cartoes" className="underline underline-offset-2">
          Cartões
        </Link>
        . Nada foi bloqueado.
      </p>
    </>
  );
}
