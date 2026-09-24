'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Copy, Rows3 } from 'lucide-react';
import { z } from 'zod';
import { formatDateBR } from '@/lib/date';
import { formatBRL, parseBRL } from '@/lib/money';
import type { Cents } from '@/lib/money';
import type { RecalculateBody } from '@/app/api/import/recalculate/schema';
import { Badge, Button, Checkbox, Input, Money, Select } from '@/components/ui-kit';
import {
  apiErrorSchema,
  recalculateResponseSchema,
  type CategoryNode,
  type MemberItem,
  type SourceKind,
  type UploadResponse,
} from './schemas';

type ConfirmedRow = RecalculateBody['rows'][number];
type ImportPreviewRow = UploadResponse['preview']['rows'][number];

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    try {
      formatDateBR(value);
      return true;
    } catch {
      return false;
    }
  });

type DraftRow = ImportPreviewRow & {
  include: boolean;
  forceDuplicate: boolean;
  occurredOnText: string;
  amountText: string;
  installmentEnabled: boolean;
  installmentCurrentText: string;
  installmentTotalText: string;
  lowConfidence: boolean;
};

type CategoryOption = {
  id: string;
  label: string;
};

type Calculation = {
  totalCents: Cents;
  competenceByIndex: Map<number, string | null>;
};

type ImportConfirmationProps = {
  preview: UploadResponse;
  sourceKind: SourceKind;
  sourceId: string;
  members: MemberItem[];
  categories: CategoryNode[];
  onBack: () => void;
  onCommitted: (batchId: string) => void;
};

const commitResponseSchema = z.object({ batchId: z.string().uuid() });

function flattenCategories(
  nodes: CategoryNode[],
  level = 0,
): CategoryOption[] {
  return nodes.flatMap((node) => [
    { id: node.id, label: `${'— '.repeat(level)}${node.name}` },
    ...flattenCategories(node.children, level + 1),
  ]);
}

function initialDrafts(rows: ImportPreviewRow[]): DraftRow[] {
  return rows.map((row) => ({
    ...row,
    include: row.state !== 'duplicate',
    forceDuplicate: false,
    occurredOnText: row.occurredOn ?? '',
    amountText: row.amountCents === null ? '' : formatBRL(row.amountCents),
    installmentEnabled: row.installment !== null,
    installmentCurrentText: row.installment === null ? '' : String(row.installment.current),
    installmentTotalText: row.installment === null ? '' : String(row.installment.total),
    lowConfidence:
      row.occurredOn === null ||
      row.amountCents === null ||
      row.rawDescription.trim() === '',
  }));
}

function parseInstallment(draft: DraftRow): { current: number; total: number } | null | undefined {
  if (!draft.installmentEnabled) return null;
  if (!/^\d+$/.test(draft.installmentCurrentText) || !/^\d+$/.test(draft.installmentTotalText)) {
    return undefined;
  }
  const current = Number(draft.installmentCurrentText);
  const total = Number(draft.installmentTotalText);
  if (current < 1 || total < 1 || current > total || current > 99 || total > 99) {
    return undefined;
  }
  return { current, total };
}

function toConfirmedRow(draft: DraftRow): ConfirmedRow | null {
  if (!draft.include) {
    const occurredOn = isoDateSchema.safeParse(draft.occurredOnText);
    const amountCents = parseBRL(draft.amountText);
    const installment = parseInstallment(draft);
    if (!occurredOn.success || amountCents === null || installment === undefined) return null;
    return {
      index: draft.index,
      include: false,
      occurredOn: occurredOn.data,
      description: draft.description.trim(),
      rawDescription: draft.rawDescription,
      amountCents,
      categoryId: draft.suggestedCategoryId,
      memberId: draft.suggestedMemberId,
      installment,
      forceDuplicate: false,
    };
  }

  const occurredOn = isoDateSchema.safeParse(draft.occurredOnText);
  const amountCents = parseBRL(draft.amountText);
  const installment = parseInstallment(draft);
  if (
    !occurredOn.success ||
    amountCents === null ||
    installment === undefined ||
    draft.description.trim() === ''
  ) {
    return null;
  }
  return {
    index: draft.index,
    include: true,
    occurredOn: occurredOn.data,
    description: draft.description.trim(),
    rawDescription: draft.rawDescription,
    amountCents,
    categoryId: draft.suggestedCategoryId,
    memberId: draft.suggestedMemberId,
    installment,
    forceDuplicate: draft.forceDuplicate,
  };
}

function competenceLabel(value: string | null): string {
  if (value === null) return '—';
  return `${value.slice(5)}/${value.slice(0, 4)}`;
}

function rowStatus(row: DraftRow): string {
  if (row.state === 'duplicate') return 'Duplicada';
  if (row.state === 'installment_first' || row.state === 'installment_part') {
    return 'Parcelada';
  }
  return 'Nova';
}

export function ImportConfirmation({
  preview,
  sourceKind,
  sourceId,
  members,
  categories,
  onBack,
  onCommitted,
}: ImportConfirmationProps) {
  const [drafts, setDrafts] = useState<DraftRow[]>(() => initialDrafts(preview.preview.rows));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [expandedOriginal, setExpandedOriginal] = useState<number | null>(null);
  const categoryOptions = useMemo(() => flattenCategories(categories), [categories]);
  const [calculation, setCalculation] = useState<Calculation>(() => ({
    totalCents: preview.preview.summary.totalCents,
    competenceByIndex: new Map(
      preview.preview.rows.map((row) => [row.index, row.competence] as const),
    ),
  }));

  const invalidIncluded = useMemo(
    () => drafts.filter((draft) => draft.include && toConfirmedRow(draft) === null),
    [drafts],
  );

  useEffect(() => {
    const confirmedRows = drafts
      .map(toConfirmedRow)
      .filter((row): row is ConfirmedRow => row !== null);
    const controller = new AbortController();
    setRecalculating(true);
    void fetch('/api/import/recalculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceKind,
        sourceId,
        cardCycle: preview.cardCycle,
        rows: confirmedRows,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsedError = apiErrorSchema.safeParse(body);
          throw new Error(
            parsedError.success
              ? parsedError.data.error
              : 'Não foi possível recalcular a confirmação.',
          );
        }
        return recalculateResponseSchema.parse(body);
      })
      .then((result) => {
        setCalculation({
          totalCents: result.totalCents,
          competenceByIndex: new Map(
            result.competenceByIndex.map((item) => [item.index, item.competence] as const),
          ),
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(
          cause instanceof Error
            ? cause.message
            : 'Não foi possível recalcular a confirmação.',
        );
      })
      .finally(() => setRecalculating(false));

    return () => controller.abort();
  }, [drafts, preview.cardCycle, sourceId, sourceKind]);

  function updateDraft(index: number, update: Partial<DraftRow>) {
    setDrafts((current) =>
      current.map((draft) => (draft.index === index ? { ...draft, ...update } : draft)),
    );
    setError(null);
  }

  async function commit() {
    if (invalidIncluded.length > 0) {
      setError('Complete ou exclua as linhas destacadas antes de confirmar.');
      return;
    }
    const confirmedRows = drafts
      .map(toConfirmedRow)
      .filter((row): row is ConfirmedRow => row !== null);
    if (confirmedRows.every((row) => !row.include)) {
      setError('Inclua pelo menos uma linha para confirmar a importação.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/import/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: preview.fileName,
          fileHash: preview.fileHash,
          bankKey: preview.bankKey,
          format: preview.format,
          sourceKind,
          sourceId,
          confirmedRows,
          reportedTotalCents: null,
          allowReimport: false,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(body);
        throw new Error(
          parsedError.success
            ? parsedError.data.error
            : 'Não foi possível confirmar a importação.',
        );
      }
      const result = commitResponseSchema.parse(body);
      onCommitted(result.batchId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível confirmar a importação.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Rows3 className="h-5 w-5" aria-hidden="true" />
            Confirme as linhas
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Revise cada campo. Nada será gravado até você confirmar.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onBack} disabled={busy}>
          Voltar para a entrada
        </Button>
      </div>

      {error ? (
        <div role="alert" className="mt-4 flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {preview.previousBatches.some((batch) => batch.status === 'committed') ? (
        <div className="mt-4 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <Copy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="font-medium">Este arquivo já foi importado antes.</p>
            {preview.previousBatches
              .filter((batch) => batch.status === 'committed')
              .map((batch) => (
                <p key={batch.id} className="text-xs text-amber-900/80">
                  Lote de {formatDateBR(batch.createdAt.slice(0, 10))} —
                  arquivo {batch.fileName}.
                </p>
              ))}
            <p className="text-xs text-amber-900/80">
              Confirmar abaixo cria um novo lote — útil se a tentativa
              anterior foi confirmada errada. Os lançamentos existentes não
              serão sobrescritos.
            </p>
          </div>
        </div>
      ) : null}

      {preview.preview.summary.rowsDuplicated > 0 ? (
        <div className="mt-4 flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <Copy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {preview.preview.summary.rowsDuplicated} linha(s) duplicada(s) foram excluída(s) por padrão.
            Você pode forçar a inclusão em cada linha.
          </span>
        </div>
      ) : null}

      {preview.preview.diagnostics.length > 0 ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Linhas que precisam de conferência</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {preview.preview.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.line}-${diagnostic.message}`}>
                Linha {diagnostic.line}: {diagnostic.message}
                <span className="mt-1 block break-words text-xs text-amber-900/80">
                  Texto original: {diagnostic.raw}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-4">
        {drafts.map((draft) => {
          const competence = calculation.competenceByIndex.get(draft.index) ?? null;
          const invalid = invalidIncluded.some((row) => row.index === draft.index);
          const isDuplicate = draft.state === 'duplicate';
          return (
            <article
              key={draft.index}
              className={`rounded-lg border p-4 ${
                draft.lowConfidence
                  ? 'border-amber-400 bg-amber-50/70'
                  : isDuplicate
                    ? 'border-dashed border-amber-300 bg-amber-50/30'
                    : 'border-border bg-background'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant={isDuplicate ? 'warning' : draft.lowConfidence ? 'warning' : 'neutral'}>
                    {rowStatus(draft)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">Linha {draft.index + 1}</span>
                </div>
                <Checkbox
                  checked={draft.include}
                  onChange={(event) =>
                    updateDraft(draft.index, {
                      include: event.target.checked,
                      forceDuplicate: isDuplicate && event.target.checked,
                    })
                  }
                  label={isDuplicate ? 'Incluir duplicada' : 'Incluir linha'}
                />
              </div>

              {draft.lowConfidence ? (
                <div className="mt-3 rounded-md border border-amber-300 bg-amber-100/70 p-3 text-sm text-amber-950">
                  <p className="font-medium">Baixa confiança: confira o texto original</p>
                  <p className="mt-1 break-words">{draft.rawDescription || 'Texto original não reconhecido.'}</p>
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Data
                  <Input
                    type="date"
                    value={draft.occurredOnText}
                    onChange={(event) => updateDraft(draft.index, { occurredOnText: event.target.value })}
                  />
                </label>
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-foreground">Competência</span>
                  <span aria-live="polite" className="flex h-9 items-center rounded-md border border-border bg-muted px-3 font-medium">
                    {competenceLabel(competence)}
                  </span>
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Valor
                  <Input
                    value={draft.amountText}
                    onChange={(event) => updateDraft(draft.index, { amountText: event.target.value })}
                    inputMode="decimal"
                    aria-label={`Valor da linha ${draft.index + 1}`}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground sm:col-span-2">
                  Descrição
                  <Input
                    value={draft.description}
                    onChange={(event) => updateDraft(draft.index, { description: event.target.value })}
                    aria-label={`Descrição da linha ${draft.index + 1}`}
                  />
                </label>
              </div>

              <div className="mt-3 rounded-md border border-border p-3">
                <Checkbox
                  checked={draft.installmentEnabled}
                  onChange={(event) =>
                    updateDraft(draft.index, {
                      installmentEnabled: event.target.checked,
                      installmentCurrentText: event.target.checked
                        ? draft.installmentCurrentText || '1'
                        : '',
                      installmentTotalText: event.target.checked
                        ? draft.installmentTotalText || '2'
                        : '',
                    })
                  }
                  label="Esta linha é parcelada"
                />
                {draft.installmentEnabled ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                      Parcela atual
                      <Input
                        type="number"
                        min={1}
                        max={99}
                        value={draft.installmentCurrentText}
                        onChange={(event) => updateDraft(draft.index, { installmentCurrentText: event.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                      Total de parcelas
                      <Input
                        type="number"
                        min={1}
                        max={99}
                        value={draft.installmentTotalText}
                        onChange={(event) => updateDraft(draft.index, { installmentTotalText: event.target.value })}
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Categoria
                  <Select
                    value={draft.suggestedCategoryId ?? ''}
                    onChange={(event) => updateDraft(draft.index, { suggestedCategoryId: event.target.value || null })}
                  >
                    <option value="">Sem categoria</option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                  Responsável
                  <Select
                    value={draft.suggestedMemberId ?? ''}
                    onChange={(event) => updateDraft(draft.index, { suggestedMemberId: event.target.value || null })}
                  >
                    <option value="">Família</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>

              {expandedOriginal === draft.index ? (
                <div className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Texto original preservado</p>
                  <p className="mt-1 break-words">{draft.rawDescription || 'Sem texto original.'}</p>
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  onClick={() => setExpandedOriginal((current) => (current === draft.index ? null : draft.index))}
                >
                  {expandedOriginal === draft.index ? 'Ocultar texto original' : 'Ver texto original'}
                </button>
                {invalid ? (
                  <span className="flex items-center gap-1 text-xs text-red-700">
                    <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Complete os campos desta linha
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <footer className="sticky bottom-0 mt-2 flex flex-col gap-3 border-t border-border bg-card py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Total das linhas incluídas</p>
          <p className="text-lg font-semibold text-foreground">
            <Money value={calculation.totalCents} />
          </p>
        </div>
        <Button type="button" onClick={() => void commit()} disabled={busy || recalculating || invalidIncluded.length > 0}>
          <Check className="mr-2 h-4 w-4" aria-hidden="true" />
          {busy ? 'Gravando…' : 'Confirmar importação'}
        </Button>
      </footer>
    </section>
  );
}
