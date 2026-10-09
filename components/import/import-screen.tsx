'use client';

import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { detectSource, type DetectedSource } from '@/lib/import/detect';
import { Button, Faixa, Input, PageHeader, Picote, Select } from '@/components/ui-kit';
import { DropZone } from './drop-zone';
import {
  accountsResponseSchema,
  apiErrorSchema,
  cardsResponseSchema,
  categoriesResponseSchema,
  sourceKindSchema,
  uploadResponseSchema,
  type SourceItem,
  type SourceKind,
  type UploadResponse,
} from './schemas';
import { ImportConfirmation } from './import-confirmation';
import { ImportHistory } from './import-history';
import type { CategoryNode, MemberItem } from './schemas';

type ImportScreenProps = {
  today: string;
};

const sourceLabels: Record<SourceKind, string> = {
  credit_card: 'Cartão de crédito',
  account: 'Conta bancária',
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunkSize));
  }
  return btoa(binary);
}

function isCompetence(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : fallback;
}

function SourceFields({
  sourceKind,
  sourceId,
  competence,
  cards,
  accounts,
  onSourceKindChange,
  onSourceIdChange,
  onCompetenceChange,
}: {
  sourceKind: SourceKind;
  sourceId: string;
  competence: string;
  cards: SourceItem[];
  accounts: SourceItem[];
  onSourceKindChange: (value: SourceKind) => void;
  onSourceIdChange: (value: string) => void;
  onCompetenceChange: (value: string) => void;
}) {
  const sources = sourceKind === 'credit_card' ? cards : accounts;
  const sourceLabel = sourceLabels[sourceKind];

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Origem
        <Select
          aria-label="Tipo de origem"
          value={sourceKind}
          onChange={(event) => {
            const parsed = sourceKindSchema.safeParse(event.target.value);
            if (parsed.success) onSourceKindChange(parsed.data);
          }}
        >
          <option value="credit_card">Cartão de crédito</option>
          <option value="account">Conta bancária</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        {sourceLabel}
        <Select
          aria-label={sourceLabel}
          value={sourceId}
          onChange={(event) => onSourceIdChange(event.target.value)}
          disabled={sources.length === 0}
        >
          <option value="">
            {sources.length === 0
              ? sourceKind === 'credit_card'
                ? 'Nenhum cartão ativo'
                : 'Nenhuma conta ativa'
              : `Selecione ${sourceKind === 'credit_card' ? 'o cartão' : 'a conta'}`}
          </option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
        Competência padrão
        <Input
          aria-label="Competência padrão"
          type="month"
          value={competence}
          onChange={(event) => onCompetenceChange(event.target.value)}
        />
      </label>
    </div>
  );
}

function SourceNotice({
  sourceKind,
  cards,
  accounts,
}: {
  sourceKind: SourceKind;
  cards: SourceItem[];
  accounts: SourceItem[];
}) {
  const count = sourceKind === 'credit_card' ? cards.length : accounts.length;
  if (count > 0) return null;

  return (
    <Faixa tone="attention">
      <p>
        Cadastre uma origem ativa antes de enviar a importação.{' '}
        <Link href="/cartoes" className="font-medium underline underline-offset-2">
          Ir para Cartões
        </Link>
      </p>
    </Faixa>
  );
}

function DetectionMessage({ detection }: { detection: DetectedSource }) {
  if (detection.format === 'pdf' && detection.encrypted) {
    return (
      <Faixa tone="attention">
        <span>Este PDF está protegido por senha. Informe a senha da fatura.</span>
      </Faixa>
    );
  }
  if (detection.format === 'pdf') {
    return (
      <Faixa tone="ok">
        <span>PDF reconhecido. O conteúdo será apenas pré-visualizado neste passo.</span>
      </Faixa>
    );
  }
  if (detection.hint === null) return null;

  return (
    <Faixa tone="attention">
      <span>{detection.hint}</span>
    </Faixa>
  );
}

export function ImportScreen({ today }: ImportScreenProps) {
  const [cards, setCards] = useState<SourceItem[]>([]);
  const [accounts, setAccounts] = useState<SourceItem[]>([]);
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [sourceKind, setSourceKind] = useState<SourceKind>('credit_card');
  const [sourceId, setSourceId] = useState('');
  const [competence, setCompetence] = useState(today.slice(0, 7));
  const [file, setFile] = useState<File | null>(null);
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [detection, setDetection] = useState<DetectedSource | null>(null);
  const [password, setPassword] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [preview, setPreview] = useState<UploadResponse | null>(null);
  const [loadingSources, setLoadingSources] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** O erro veio da leitura do PDF ou do texto: ganha título e dica própria. */
  const [readFailed, setReadFailed] = useState(false);
  const latestFile = useRef<File | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  /**
   * Incrementado após cada commit bem-sucedido para forçar o `ImportHistory`
   * a refazer o fetch — não há store global; o número em si é irrelevante,
   * só precisa mudar de identidade.
   */
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const sources = useMemo(
    () => (sourceKind === 'credit_card' ? cards : accounts),
    [accounts, cards, sourceKind],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSources() {
      setLoadingSources(true);
      try {
        const [cardsResponse, accountsResponse] = await Promise.all([
          fetch('/api/cards', { cache: 'no-store' }),
          fetch('/api/accounts', { cache: 'no-store' }),
        ]);
        if (!cardsResponse.ok) {
          throw new Error(
            await readApiError(cardsResponse, 'Não foi possível carregar os cartões.'),
          );
        }
        if (!accountsResponse.ok) {
          throw new Error(
            await readApiError(accountsResponse, 'Não foi possível carregar as contas.'),
          );
        }
        const cardsBody = cardsResponseSchema.parse(await cardsResponse.json());
        const accountsBody = accountsResponseSchema.parse(
          await accountsResponse.json(),
        );
        const categoriesResponse = await fetch('/api/categories', {
          cache: 'no-store',
        });
        if (!categoriesResponse.ok) {
          throw new Error(
            await readApiError(
              categoriesResponse,
              'Não foi possível carregar as categorias.',
            ),
          );
        }
        const categoriesBody = categoriesResponseSchema.parse(
          await categoriesResponse.json(),
        );
        if (!cancelled) {
          setCards(cardsBody.cards.filter((item) => item.active));
          setAccounts(accountsBody.accounts.filter((item) => item.active));
          setMembers(cardsBody.members);
          setCategories(categoriesBody.categories);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Não foi possível carregar as origens.',
          );
        }
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    }

    void loadSources();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sources.some((source) => source.id === sourceId)) return;
    setSourceId(sources[0]?.id ?? '');
  }, [sourceId, sources]);

  function clearResult() {
    setError(null);
    setReadFailed(false);
    setPreview(null);
    setSuccess(null);
  }

  function handleSourceKindChange(value: SourceKind) {
    setSourceKind(value);
    setSourceId('');
    clearResult();
  }

  function handleCompetenceChange(value: string) {
    setCompetence(value);
    clearResult();
    if (value !== '' && !isCompetence(value)) {
      setError('Informe uma competência válida no formato AAAA-MM.');
    }
  }

  async function handleFile(selected: File | null) {
    latestFile.current = selected;
    setFile(selected);
    setFileBytes(null);
    setPassword('');
    clearResult();
    if (selected === null) {
      setDetection(null);
      return;
    }

    const bytes = new Uint8Array(await selected.arrayBuffer());
    if (latestFile.current !== selected) return;
    setFileBytes(bytes);
    setDetection(detectSource({ fileName: selected.name, content: bytes }));
  }

  async function uploadFile() {
    if (
      file === null ||
      fileBytes === null ||
      detection?.format !== 'pdf' ||
      sourceId === '' ||
      !isCompetence(competence)
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const body = {
        inputType: 'pdf',
        fileName: file.name,
        contentBase64: bytesToBase64(fileBytes),
        ...(password.length > 0 ? { password } : {}),
        sourceKind,
        sourceId,
        today,
        defaultCompetence: competence,
      };
      const response = await fetch('/api/import/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(
          await readApiError(response, 'Não foi possível processar o PDF.'),
        );
      }
      setPreview(uploadResponseSchema.parse(await response.json()));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível processar o PDF.',
      );
      setReadFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function uploadText() {
    if (
      pastedText.trim() === '' ||
      sourceId === '' ||
      !isCompetence(competence)
    ) return;

    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch('/api/import/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputType: 'text',
          fileName: 'texto-colado.txt',
          content: pastedText,
          sourceKind,
          sourceId,
          today,
          defaultCompetence: competence,
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readApiError(response, 'Não foi possível processar o texto.'),
        );
      }
      setPreview(uploadResponseSchema.parse(await response.json()));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Não foi possível processar o texto.',
      );
      setReadFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function preventSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
  }

  const hasSource = sourceId !== '';
  const canUploadFile =
    file !== null &&
    fileBytes !== null &&
    detection?.format === 'pdf' &&
    hasSource &&
    isCompetence(competence);
  const canUploadText =
    pastedText.trim() !== '' && hasSource && isCompetence(competence);

  function returnToInput() {
    setPreview(null);
    setError(null);
  }

  function handleCommitted(batchId: string, plannedReconciled: number) {
    setPreview(null);
    setPastedText('');
    setFile(null);
    setFileBytes(null);
    setDetection(null);
    setPassword('');
    const fulfilled =
      plannedReconciled > 0
        ? ` ${plannedReconciled === 1 ? '1 previsão cumprida' : `${plannedReconciled} previsões cumpridas`}.`
        : '';
    setSuccess(`Importação confirmada. Os canhotos foram destacados no lote ${batchId}.${fulfilled}`);
    setHistoryRefreshKey((current) => current + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Importar"
        description="Envie o PDF da fatura ou cole o texto de um extrato. Nada é gravado antes da sua confirmação."
      />

      {error ? (
        <Faixa tone="danger" role="alert" title={readFailed ? 'Não foi possível ler esta fatura' : undefined}>
          <span>{error}</span>
          {readFailed ? (
            <span className="text-xs text-muted-foreground">
              Confira se o cartão e a competência estão certos e, em PDF com senha, a senha. Também dá para colar o
              texto da fatura mais abaixo.
            </span>
          ) : null}
        </Faixa>
      ) : null}

      {success ? (
        <Faixa tone="ok" role="status" title="Lote destacado">
          <span>{success}</span>
        </Faixa>
      ) : null}

      {preview ? (
        <ImportConfirmation
          preview={preview}
          sourceKind={preview.sourceKind}
          sourceId={preview.sourceId}
          sourceName={sources.find((source) => source.id === preview.sourceId)?.name ?? 'este cartão'}
          members={members}
          categories={categories}
          defaultCompetence={competence}
          onBack={returnToInput}
          onCommitted={handleCommitted}
        />
      ) : null}

      {!preview ? (
        <>
          <section aria-labelledby="destino-titulo" className="flex flex-col gap-4 border-t-2 border-foreground pt-4">
            <div className="flex flex-col gap-1">
              <h2 id="destino-titulo" className="text-lg font-semibold text-foreground">
                Destino da importação
              </h2>
              <p className="text-sm text-muted-foreground">
                Esta origem e competência serão usadas pelo PDF e pelo texto colado.
              </p>
            </div>
            <SourceFields
              sourceKind={sourceKind}
              sourceId={sourceId}
              competence={competence}
              cards={cards}
              accounts={accounts}
              onSourceKindChange={handleSourceKindChange}
              onSourceIdChange={(value) => {
                setSourceId(value);
                clearResult();
              }}
              onCompetenceChange={handleCompetenceChange}
            />
            <SourceNotice sourceKind={sourceKind} cards={cards} accounts={accounts} />
          </section>

          <section aria-labelledby="pdf-titulo" className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1">
              <h2 id="pdf-titulo" className="text-lg font-semibold text-foreground">
                Fatura em PDF
              </h2>
              <p className="text-sm text-muted-foreground">
                Escolha a origem e a competência antes de enviar sua fatura.
              </p>
            </div>
            <form onSubmit={preventSubmit} className="flex flex-col gap-4">
              <DropZone file={file} disabled={busy} onFile={(selected) => void handleFile(selected)} />
              {detection ? <DetectionMessage detection={detection} /> : null}
              {detection?.format === 'pdf' && detection.encrypted ? (
                <label className="flex max-w-sm flex-col gap-1.5 text-sm font-medium text-foreground">
                  Senha da fatura
                  <Input
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Digite a senha do PDF"
                  />
                  <span className="font-normal text-muted-foreground">
                    A senha fica somente na memória e não é salva.
                  </span>
                </label>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">PDF é o único formato de arquivo aceito nesta fase.</p>
                <Button type="button" disabled={!canUploadFile || busy} onClick={() => void uploadFile()}>
                  {busy ? 'Processando…' : 'Pré-visualizar PDF'}
                </Button>
              </div>
              {loadingSources ? <p className="text-sm text-muted-foreground">Carregando origens…</p> : null}
            </form>
          </section>

          <section aria-labelledby="texto-titulo" className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1">
              <h2 id="texto-titulo" className="text-lg font-semibold text-foreground">
                Texto colado
              </h2>
              <p className="text-sm text-muted-foreground">
                Cole linhas de qualquer origem. O texto segue para o mesmo preview do PDF.
              </p>
            </div>
            <form onSubmit={preventSubmit} className="flex flex-col gap-4">
              <textarea
                aria-label="Texto para importar"
                value={pastedText}
                onChange={(event) => {
                  setPastedText(event.target.value);
                  clearResult();
                }}
                placeholder="Cole aqui as linhas da fatura ou do extrato…"
                rows={7}
                className="w-full resize-y border border-input bg-card px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">O texto fica nesta tela até você confirmar as linhas.</p>
                <Button type="button" disabled={!canUploadText || busy} onClick={() => void uploadText()}>
                  {busy ? 'Processando…' : 'Pré-visualizar texto'}
                </Button>
              </div>
            </form>
          </section>
        </>
      ) : null}

      <Picote />
      <ImportHistory refreshKey={historyRefreshKey} />
    </div>
  );
}
