'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { z } from 'zod';
import { formatDateBR } from '@/lib/date';
import { formatBRL, parseBRL } from '@/lib/money';
import type { Cents } from '@/lib/money';
import type { RecalculateBody } from '@/app/api/import/recalculate/schema';
import { competenceLong } from '@/components/cashflow/labels';
import {
  Button,
  Canhoto,
  Carimbo,
  Checkbox,
  Faixa,
  Input,
  Money,
  Parcela,
  Placar,
  Select,
} from '@/components/ui-kit';
import { CompetenceWarningBanner } from './competence-warning-banner';
import { BatchCover } from './batch-cover';
import { StillHeldColumn } from './still-held-column';
import { esperarDestacar } from './destacar';
import { defaultInclude, includedByDefaultCount } from './preview-state';
import {
  applyBulk,
  confirmBlockReason,
  firstInvalidIndex,
  FLAG_SELO,
  flaggedIndexes,
  placarFigures,
  rowFieldLabel,
  rowFlags,
  stepFlagged,
} from './review-model';
import {
  apiErrorSchema,
  recalculateResponseSchema,
  type CategoryNode,
  type MemberItem,
  type SourceKind,
  type StillHeld,
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
  /**
   * Quantas linhas vão ser gravadas neste commit. Calculado pelo motor depois do
   * dedupe e do filtro de `include` — a tela exibe, não calcula. Atualiza a
   * cada edit; começa com a contagem inicial coerente com `initialDrafts`.
   *
   * Inclui TANTO as linhas confirmadas (que o usuário marcou) quanto as
   * parcelas FUTURAS projetadas pelo motor a partir dos planos de
   * parcelamento. O rodapé separa as duas contagens para não deixar a
   * leitura "X linhas somando o total" parecer válida — o `totalCents`
   * cobre só as confirmadas (ver docstring de `finalizeImport`).
   */
  includedRowsCount: number;
  /** Parcelas futuras geradas pelo motor a partir de planos. */
  plannedRowsCount: number;
  competenceByIndex: Map<number, string | null>;
  /** Coluna "Ainda presos": as parcelas que o lote projeta, por competência. */
  stillHeld: StillHeld;
};

type ImportConfirmationProps = {
  preview: UploadResponse;
  sourceKind: SourceKind;
  sourceId: string;
  /** Nome da origem (do cartão, quando é cartão): entra na capa e na frase do aviso de cadastro. */
  sourceName: string;
  members: MemberItem[];
  categories: CategoryNode[];
  /**
   * Competência da fatura (o "Competência padrão" da tela). Obrigatória no
   * commit quando a origem é cartão — é a fonte da verdade para o `period` da
   * fatura em `lib/db/queries/import.ts`. A tela de cima (ImportScreen) já a
   * tem em mãos; passamos adiante em vez de inferir.
   */
  defaultCompetence: string;
  onBack: () => void;
  onCommitted: (batchId: string, plannedReconciled: number) => void;
};

const commitResponseSchema = z.object({
  batchId: z.string().uuid(),
  plannedReconciled: z.number().int().nonnegative().default(0),
});

const KEEP = '__keep';
const NONE = '__none';

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
    // Linha de pagamento da fatura anterior entra DESMARCADA por padrão
    // (RF-CC-04): pertence ao extrato da CONTA bancária, não ao cartão.
    // Importá-la aqui contaria duas vezes quando o extrato da conta entrar.
    // O usuário só marca se quiser registrar manualmente uma exceção.
    include: defaultInclude(row.state),
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

/**
 * Texto do rodapé que separa "linhas que o usuário marcou" de "parcelas futuras
 * projetadas". Os dois números lado a lado, com `totalCents` do motor cobrindo
 * só as marcadas, levavam à leitura falsa "X lançamentos somando o total".
 * Quebrar em duas frases fecha a ambiguidade — sem mexer no cálculo, só no
 * jeito de apresentar.
 */
function countLabel(includedRowsCount: number, plannedRowsCount: number): string {
  const marked = includedRowsCount - plannedRowsCount;
  const markedPart =
    marked === 1 ? '1 linha marcada' : `${marked} linhas marcadas`;
  if (plannedRowsCount === 0) {
    return `${markedPart} serão gravadas`;
  }
  const futurePart =
    plannedRowsCount === 1
      ? '1 parcela futura gerada'
      : `${plannedRowsCount} parcelas futuras geradas`;
  return `${markedPart} + ${futurePart} (${includedRowsCount} no total)`;
}

/** Data do canhoto: dd/mm/aaaa, ou travessão se a data da linha ainda não é válida. */
function stubDate(text: string): string {
  const parsed = isoDateSchema.safeParse(text);
  return parsed.success ? formatDateBR(parsed.data).slice(0, 5) : '—';
}

const NOTE: Partial<Record<ImportPreviewRow['state'], string>> = {
  duplicate: 'Já existe no sistema; chega desmarcada.',
  credit_card_payment: 'Pagamento da fatura anterior: pertence ao extrato da conta.',
  informational: 'Valor R$ 0,00: nem despesa nem receita.',
};

export function ImportConfirmation({
  preview,
  sourceKind,
  sourceId,
  sourceName,
  members,
  categories,
  defaultCompetence,
  onBack,
  onCommitted,
}: ImportConfirmationProps) {
  // Ciclo VIGENTE do cartão: começa no do upload e passa a ser o que o servidor
  // devolveu se o usuário corrigir o cadastro pelo aviso. Alimenta a comparação do
  // aviso E o `recalculate` (que recebe o ciclo do cliente): o commit lê o ciclo do
  // banco, então a prévia tem de usar o mesmo.
  const [cardCycle, setCardCycle] = useState(preview.cardCycle);
  const [drafts, setDrafts] = useState<DraftRow[]>(() => initialDrafts(preview.preview.rows));
  const [busy, setBusy] = useState(false);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  // Linhas com o editor aberto. Começam abertas as de baixa confiança; as incompletas abrem sozinhas.
  const [opened, setOpened] = useState<Set<number>>(
    () =>
      new Set(
        initialDrafts(preview.preview.rows)
          .filter((row) => row.lowConfidence)
          .map((row) => row.index),
      ),
  );
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [bulkCategory, setBulkCategory] = useState(KEEP);
  const [bulkMember, setBulkMember] = useState(KEEP);
  const categoryOptions = useMemo(() => flattenCategories(categories), [categories]);
  const categoryName = useMemo(
    () => new Map(categoryOptions.map((option) => [option.id, option.label.replace(/^(— )+/, '')] as const)),
    [categoryOptions],
  );
  const memberName = useMemo(() => new Map(members.map((member) => [member.id, member.name] as const)), [members]);
  const [calculation, setCalculation] = useState<Calculation>(() => ({
    totalCents: preview.preview.summary.totalCents,
    // Inicial coerente com `initialDrafts`: a MESMA regra (`defaultInclude`): duplicada, pagamento
    // de fatura e linha informativa chegam desmarcadas; tudo o mais entra incluído.
    includedRowsCount: includedByDefaultCount(preview.preview.rows),
    // Sem parcelamento detectado no preview inicial, futuras = 0. Atualiza
    // no recalculate.
    plannedRowsCount: 0,
    competenceByIndex: new Map(
      preview.preview.rows.map((row) => [row.index, row.competence] as const),
    ),
    stillHeld: { months: [], totalCents: 0 as Cents, count: 0 },
  }));

  const invalidIncluded = useMemo(
    () => drafts.filter((draft) => draft.include && toConfirmedRow(draft) === null),
    [drafts],
  );
  const invalidSet = useMemo(() => new Set(invalidIncluded.map((draft) => draft.index)), [invalidIncluded]);

  const flagInputs = useMemo(
    () =>
      drafts.map((draft) => ({
        ...draft,
        invalid: invalidSet.has(draft.index),
      })),
    [drafts, invalidSet],
  );
  const flagged = useMemo(() => flaggedIndexes(flagInputs), [flagInputs]);
  const visibleDrafts = onlyFlagged ? drafts.filter((draft) => flagged.includes(draft.index)) : drafts;
  const includedCount = drafts.filter((draft) => draft.include).length;

  const figures = placarFigures({
    reportedTotalCents: preview.preview.reportedTotalCents,
    totalCents: calculation.totalCents,
  });
  const blockReason = confirmBlockReason({
    busy,
    recalculating,
    invalidCount: invalidIncluded.length,
    includedCount,
  });

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
        cardCycle,
        rows: confirmedRows,
        // `statementCompetence` é a fonte da verdade para a competência de cada
        // linha quando a origem é cartão (RF-IMP-09). Para conta, vale `null`:
        // não há fatura e o motor não usa esse campo. A chave é OBRIGATÓRIA no
        // `recalculateBodySchema` (valor `null` em conta): ausente dá 400.
        statementCompetence: sourceKind === 'credit_card' ? defaultCompetence : null,
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
          includedRowsCount: result.includedRowsCount,
          plannedRowsCount: result.plannedRowsCount,
          competenceByIndex: new Map(
            result.competenceByIndex.map((item) => [item.index, item.competence] as const),
          ),
          stillHeld: result.stillHeld,
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
  }, [drafts, cardCycle, sourceId, sourceKind, defaultCompetence]);

  function updateDraft(index: number, update: Partial<DraftRow>) {
    setDrafts((current) =>
      current.map((draft) => (draft.index === index ? { ...draft, ...update } : draft)),
    );
    setError(null);
  }

  /** Abre a linha, rola até ela e põe o foco no botão que a abre. */
  const goToRow = useCallback((index: number) => {
    setOpened((current) => new Set(current).add(index));
    window.setTimeout(() => {
      const target = document.getElementById(`linha-${index}-abrir`);
      target?.focus();
      target?.scrollIntoView({ block: 'center' });
    }, 0);
  }, []);

  // J e K: próxima e anterior linha sinalizada. Fora de campo de texto, sem modificadores.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
      ) {
        return;
      }
      const focusedIndex =
        target instanceof HTMLElement && /^linha-(\d+)-abrir$/.test(target.id)
          ? Number(target.id.split('-')[1])
          : null;
      const next = stepFlagged(flagged, focusedIndex, key === 'j' ? 1 : -1);
      if (next === null) return;
      event.preventDefault();
      goToRow(next);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [flagged, goToRow]);

  function toggleOpened(index: number) {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleSelected(index: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(index);
      else next.delete(index);
      return next;
    });
  }

  const allVisibleSelected =
    visibleDrafts.length > 0 && visibleDrafts.every((draft) => selected.has(draft.index));

  function applyToSelected() {
    const change: { categoryId?: string | null; memberId?: string | null } = {};
    if (bulkCategory !== KEEP) change.categoryId = bulkCategory === NONE ? null : bulkCategory;
    if (bulkMember !== KEEP) change.memberId = bulkMember === NONE ? null : bulkMember;
    setDrafts((current) => applyBulk(current, selected, change));
    setBulkCategory(KEEP);
    setBulkMember(KEEP);
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
          // Total IMPRESSO no documento, lido pelo parser: vai para
          // `statements.reported_total_cents` (conferência com a soma das linhas).
          reportedTotalCents: preview.preview.reportedTotalCents,
          allowReimport: false,
          defaultCompetence,
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
      // Assinatura: o picote se abre e os canhotos assentam, uma vez; sem espera se o sistema pede menos movimento.
      setSettling(true);
      await esperarDestacar();
      onCommitted(result.batchId, result.plannedReconciled);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível confirmar a importação.',
      );
      setSettling(false);
    } finally {
      setBusy(false);
    }
  }

  function handleConfirmClick() {
    if (blockReason !== null) {
      // Desabilitado de verdade para o leitor de tela (aria-disabled), mas clicável: leva à primeira linha inválida.
      const first = firstInvalidIndex(flagInputs);
      if (first !== null) goToRow(first);
      return;
    }
    void commit();
  }

  const announcement =
    `${includedCount} ${includedCount === 1 ? 'linha incluída' : 'linhas incluídas'}. ` +
    `Incluído ${formatBRL(figures.includedCents, { sign: 'never' })}.` +
    (figures.differenceCents === null
      ? ' Sem total impresso para conferir.'
      : figures.differenceCents === 0
        ? ' O lote confere com o total da fatura.'
        : ` Diferença de ${formatBRL(figures.differenceCents)} para o total da fatura.`);

  return (
    <section aria-label="Revisão da fatura" className="flex flex-col gap-4">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Revise o que vem sinalizado. Nada é gravado até você confirmar.</p>
        <Button variant="outline" size="sm" onClick={onBack} disabled={busy}>
          Voltar para a entrada
        </Button>
      </div>

      <BatchCover
        bankKey={preview.bankKey}
        sourceName={sourceName}
        competence={defaultCompetence}
        documentDate={preview.preview.documentDate}
        fileName={preview.fileName}
        rowsRead={preview.preview.summary.rowsRead}
      />

      {error ? (
        <Faixa tone="danger" role="alert">
          <span>{error}</span>
        </Faixa>
      ) : null}

      <CompetenceWarningBanner
        sourceKind={sourceKind}
        sourceId={sourceId}
        sourceName={sourceName}
        cardCycle={cardCycle}
        declaredCompetence={defaultCompetence}
        documentDate={preview.preview.documentDate}
        onCycleChanged={setCardCycle}
      />

      {preview.previousBatches.some((batch) => batch.status === 'committed') ? (
        <Faixa tone="attention" title="Este arquivo já foi importado antes.">
          {preview.previousBatches
            .filter((batch) => batch.status === 'committed')
            .map((batch) => (
              <p key={batch.id} className="text-xs text-muted-foreground">
                Lote de {formatDateBR(batch.createdAt.slice(0, 10))} — arquivo {batch.fileName}.
              </p>
            ))}
          <p className="text-xs text-muted-foreground">
            Confirmar abaixo cria um novo lote — útil se a tentativa anterior foi confirmada errada. Os lançamentos
            existentes não serão sobrescritos.
          </p>
        </Faixa>
      ) : null}

      {preview.preview.summary.rowsDuplicated > 0 ? (
        <Faixa tone="attention">
          <span>
            {preview.preview.summary.rowsDuplicated} linha(s) duplicada(s) foram excluída(s) por padrão. Você pode
            forçar a inclusão em cada linha.
          </span>
        </Faixa>
      ) : null}

      {preview.preview.diagnostics.length > 0 ? (
        <Faixa tone="attention" title="Linhas que precisam de conferência">
          <ul className="list-disc space-y-1 pl-5">
            {preview.preview.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.line}-${diagnostic.message}`}>
                Linha {diagnostic.line}: {diagnostic.message}
                <span className="block break-words text-xs text-muted-foreground">
                  Texto original: {diagnostic.raw}
                </span>
              </li>
            ))}
          </ul>
        </Faixa>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-2 border-y border-border py-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Checkbox
                label="Selecionar todas"
                checked={allVisibleSelected}
                onChange={(event) =>
                  setSelected(event.target.checked ? new Set(visibleDrafts.map((draft) => draft.index)) : new Set())
                }
              />
              <Checkbox
                label={`Só o que precisa de atenção (${flagged.length})`}
                checked={onlyFlagged}
                onChange={(event) => setOnlyFlagged(event.target.checked)}
              />
              <p className="text-xs text-muted-foreground">
                <kbd className="num border border-border bg-card px-1">J</kbd> /{' '}
                <kbd className="num border border-border bg-card px-1">K</kbd> pulam entre as linhas sinalizadas
              </p>
            </div>
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-end gap-2" role="group" aria-label="Edição em lote">
                <p className="w-full text-sm font-medium text-foreground sm:w-auto sm:pb-2">
                  {selected.size === 1 ? '1 linha selecionada' : `${selected.size} linhas selecionadas`}
                </p>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  Categoria
                  <Select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}>
                    <option value={KEEP}>Manter</option>
                    <option value={NONE}>Sem categoria</option>
                    {categoryOptions.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                  Responsável
                  <Select value={bulkMember} onChange={(event) => setBulkMember(event.target.value)}>
                    <option value={KEEP}>Manter</option>
                    <option value={NONE}>Família</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <Button
                  variant="outline"
                  onClick={applyToSelected}
                  disabled={bulkCategory === KEEP && bulkMember === KEEP}
                >
                  Aplicar às selecionadas
                </Button>
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Limpar seleção
                </Button>
              </div>
            ) : null}
          </div>

          {visibleDrafts.length === 0 ? (
            <p className="border border-dashed border-input px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhuma linha precisa de atenção. Desmarque o filtro para ver o lote inteiro.
            </p>
          ) : null}

          <ul className={`flex flex-col gap-1.5 ${settling ? 'destacando' : ''}`}>
            {visibleDrafts.map((draft, position) => {
              const rowNumber = draft.index + 1;
              const label = draft.description;
              const competence = calculation.competenceByIndex.get(draft.index) ?? null;
              const invalid = invalidSet.has(draft.index);
              const flags = rowFlags({ state: draft.state, lowConfidence: draft.lowConfidence, invalid });
              const isOpen = opened.has(draft.index) || invalid;
              const isDuplicate = draft.state === 'duplicate';
              const isPayment = draft.state === 'credit_card_payment';
              const isInformational = draft.state === 'informational';
              const amount = parseBRL(draft.amountText);
              const installment = parseInstallment(draft);
              const note = NOTE[draft.state];
              const editorId = `linha-${draft.index}-editor`;
              return (
                <li key={draft.index} style={{ '--i': position } as CSSProperties}>
                  <Canhoto
                    as="article"
                    ariaLabel={`Linha ${rowNumber}, ${label || 'sem descrição'}`}
                    destaque={invalid ? 'danger' : flags.length > 0 ? 'attention' : undefined}
                    className={draft.include ? undefined : 'opacity-80'}
                    stub={stubDate(draft.occurredOnText)}
                    marcas={flags.map((flag) => FLAG_SELO[flag])}
                    valor={
                      amount === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Money value={amount} />
                      )
                    }
                    footer={
                      isOpen ? (
                        <div id={editorId} className="flex flex-col gap-3">
                          {draft.lowConfidence ? (
                            <Faixa tone="attention" title="Baixa confiança: confira o texto original">
                              <p className="break-words">{draft.rawDescription || 'Texto original não reconhecido.'}</p>
                            </Faixa>
                          ) : null}
                          {isInformational ? (
                            <Faixa tone="attention" title="Linha informativa — valor R$ 0,00, nem despesa nem receita.">
                              <p>Não é importada. Se o valor estiver errado, corrija-o abaixo e marque a linha.</p>
                            </Faixa>
                          ) : null}
                          {isPayment ? (
                            <Faixa
                              tone="attention"
                              title="Pagamento da fatura anterior — pertence ao extrato da conta, não ao cartão."
                            >
                              <p>
                                Incluir aqui conta o valor duas vezes quando o extrato da conta entrar. Marque só se
                                quiser registrar o pagamento manualmente como exceção.
                              </p>
                            </Faixa>
                          ) : null}
                          {invalid ? (
                            <Faixa tone="danger">
                              <span>Complete os campos desta linha para poder confirmar.</span>
                            </Faixa>
                          ) : null}

                          <div className="grid gap-3 sm:grid-cols-4">
                            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                              Data
                              <Input
                                type="date"
                                value={draft.occurredOnText}
                                aria-label={rowFieldLabel('Data', rowNumber, label)}
                                onChange={(event) => updateDraft(draft.index, { occurredOnText: event.target.value })}
                              />
                            </label>
                            <div className="flex flex-col gap-1 text-sm">
                              <span className="font-medium text-foreground">Competência</span>
                              <span className="flex h-11 items-center border border-border bg-muted px-3 font-medium sm:h-9">
                                {competence === null ? '—' : competenceLong(competence)}
                              </span>
                            </div>
                            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                              Valor
                              <Input
                                value={draft.amountText}
                                onChange={(event) => updateDraft(draft.index, { amountText: event.target.value })}
                                inputMode="decimal"
                                aria-label={rowFieldLabel('Valor', rowNumber, label)}
                                aria-invalid={invalid && amount === null ? true : undefined}
                              />
                            </label>
                            <label className="flex flex-col gap-1 text-sm font-medium text-foreground sm:col-span-4">
                              Descrição
                              <Input
                                value={draft.description}
                                onChange={(event) => updateDraft(draft.index, { description: event.target.value })}
                                aria-label={rowFieldLabel('Descrição', rowNumber, label)}
                                aria-invalid={invalid && draft.description.trim() === '' ? true : undefined}
                              />
                            </label>
                          </div>

                          <div className="flex flex-col gap-2 border-t border-border pt-3">
                            <Checkbox
                              checked={draft.installmentEnabled}
                              aria-label={rowFieldLabel('Parcelada', rowNumber, label)}
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
                              <div className="grid max-w-md grid-cols-2 gap-3">
                                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                                  Parcela atual
                                  <Input
                                    type="number"
                                    min={1}
                                    max={99}
                                    value={draft.installmentCurrentText}
                                    aria-label={rowFieldLabel('Parcela atual', rowNumber, label)}
                                    onChange={(event) =>
                                      updateDraft(draft.index, { installmentCurrentText: event.target.value })
                                    }
                                  />
                                </label>
                                <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                                  Total de parcelas
                                  <Input
                                    type="number"
                                    min={1}
                                    max={99}
                                    value={draft.installmentTotalText}
                                    aria-label={rowFieldLabel('Total de parcelas', rowNumber, label)}
                                    onChange={(event) =>
                                      updateDraft(draft.index, { installmentTotalText: event.target.value })
                                    }
                                  />
                                </label>
                              </div>
                            ) : null}
                          </div>

                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="flex flex-col gap-1 text-sm font-medium text-foreground">
                              Categoria
                              <Select
                                value={draft.suggestedCategoryId ?? ''}
                                aria-label={rowFieldLabel('Categoria', rowNumber, label)}
                                onChange={(event) =>
                                  updateDraft(draft.index, { suggestedCategoryId: event.target.value || null })
                                }
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
                                aria-label={rowFieldLabel('Responsável', rowNumber, label)}
                                onChange={(event) =>
                                  updateDraft(draft.index, { suggestedMemberId: event.target.value || null })
                                }
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

                          <div className="bg-muted p-3 text-xs text-muted-foreground">
                            <p className="font-medium text-foreground">Texto original preservado</p>
                            <p className="mt-1 break-words">{draft.rawDescription || 'Sem texto original.'}</p>
                          </div>
                        </div>
                      ) : null
                    }
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <Checkbox
                        checked={selected.has(draft.index)}
                        aria-label={rowFieldLabel('Selecionar', rowNumber, label)}
                        onChange={(event) => toggleSelected(draft.index, event.target.checked)}
                      />
                      <button
                        id={`linha-${draft.index}-abrir`}
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? editorId : undefined}
                        aria-label={`${isOpen ? 'Fechar' : 'Abrir'} a linha ${rowNumber}, ${label || 'sem descrição'}`}
                        onClick={() => toggleOpened(draft.index)}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-8"
                      >
                        <span className="truncate">{label || 'Sem descrição'}</span>
                        {installment ? <Parcela atual={installment.current} total={installment.total} className="text-xs text-muted-foreground" /> : null}
                      </button>
                      <Checkbox
                        checked={draft.include}
                        aria-label={rowFieldLabel(
                          isDuplicate ? 'Incluir duplicada' : isPayment ? 'Incluir pagamento' : 'Incluir',
                          rowNumber,
                          label,
                        )}
                        onChange={(event) =>
                          updateDraft(draft.index, {
                            include: event.target.checked,
                            forceDuplicate: isDuplicate && event.target.checked,
                          })
                        }
                        label="Incluir"
                      />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {draft.suggestedCategoryId ? (categoryName.get(draft.suggestedCategoryId) ?? 'Categoria') : 'Sem categoria'}
                      {' · '}
                      {draft.suggestedMemberId ? (memberName.get(draft.suggestedMemberId) ?? 'Responsável') : 'Família'}
                      {competence !== null ? ` · ${competenceLong(competence)}` : ''}
                    </p>
                    {note && !isOpen ? <p className="text-xs text-muted-foreground">{note}</p> : null}
                  </Canhoto>
                </li>
              );
            })}
          </ul>
        </div>

        <StillHeldColumn stillHeld={calculation.stillHeld} recalculating={recalculating} />
      </div>

      <Placar
        position="sticky"
        title="Lote"
        items={[
          {
            label: 'Total da fatura',
            value:
              figures.reportedCents === null ? (
                <span className="text-sm font-normal text-muted-foreground">não impresso</span>
              ) : (
                <Money value={figures.reportedCents} sign="never" />
              ),
          },
          { label: 'Incluído', value: <Money value={figures.includedCents} sign="never" /> },
          {
            label: 'Diferença',
            tone: figures.tone,
            value:
              figures.differenceCents === null ? (
                <span className="text-sm font-normal text-muted-foreground">sem total para conferir</span>
              ) : (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Money value={figures.differenceCents} />
                  {figures.tone === 'ok' ? <Carimbo tone="ok">Confere</Carimbo> : null}
                  {figures.tone === 'danger' ? <Carimbo tone="danger">Diverge</Carimbo> : null}
                </span>
              ),
          },
        ]}
        action={
          <div className="flex max-w-xs flex-col items-end gap-1">
            <Button
              type="button"
              aria-disabled={blockReason !== null}
              aria-describedby="confirmar-motivo"
              className={blockReason !== null ? 'opacity-60' : undefined}
              onClick={handleConfirmClick}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {busy ? 'Gravando…' : 'Confirmar importação'}
            </Button>
            <p id="confirmar-motivo" className="text-right text-xs text-muted-foreground">
              {blockReason ?? countLabel(calculation.includedRowsCount, calculation.plannedRowsCount)}
            </p>
          </div>
        }
      />
    </section>
  );
}
