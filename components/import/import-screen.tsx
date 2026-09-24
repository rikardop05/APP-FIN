'use client';

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AlertCircle,
  CheckCircle,
  ClipboardPaste,
  FileUp,
  LockKeyhole,
} from 'lucide-react';
import { detectSource, type DetectedSource } from '@/lib/import/detect';
import { Button, Input, PageHeader, Select } from '@/components/ui-kit';
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
    <p className="text-sm text-muted-foreground">
      Cadastre uma origem ativa antes de enviar a importação.
    </p>
  );
}

function DetectionMessage({ detection }: { detection: DetectedSource }) {
  if (detection.format === 'pdf' && detection.encrypted) {
    return (
      <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Este PDF está protegido por senha. Informe a senha da fatura.</span>
      </div>
    );
  }
  if (detection.format === 'pdf') {
    return (
      <p className="text-sm text-emerald-700">
        PDF reconhecido. O conteúdo será apenas pré-visualizado neste passo.
      </p>
    );
  }
  if (detection.hint === null) return null;

  return (
    <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{detection.hint}</span>
    </div>
  );
}

function PreviewNotice({ preview }: { preview: UploadResponse }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
      <p className="font-medium">
        {preview.preview.summary.rowsRead}{' '}
        {preview.preview.summary.rowsRead === 1 ? 'linha lida' : 'linhas lidas'}.
      </p>
      <p className="mt-1">
        Nada foi gravado. A confirmação das linhas será exibida na próxima etapa.
      </p>
    </div>
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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setFileBytes(null);
    setPassword('');
    clearResult();
    if (selected === null) {
      setDetection(null);
      return;
    }

    const bytes = new Uint8Array(await selected.arrayBuffer());
    if (event.target.files?.[0] !== selected) return;
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

  function handleCommitted(batchId: string) {
    setPreview(null);
    setPastedText('');
    setFile(null);
    setFileBytes(null);
    setDetection(null);
    setPassword('');
    setSuccess(`Importação confirmada. Lote ${batchId} gravado.`);
    setHistoryRefreshKey((current) => current + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Importar"
        description="Envie o PDF da fatura ou cole o texto de um extrato. Nada é gravado antes da sua confirmação."
      />

      {error ? (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {success ? (
        <div role="status" className="flex gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{success}</span>
        </div>
      ) : null}

      {preview ? (
        <ImportConfirmation
          preview={preview}
          sourceKind={preview.sourceKind}
          sourceId={preview.sourceId}
          members={members}
          categories={categories}
          onBack={returnToInput}
          onCommitted={handleCommitted}
        />
      ) : null}

      {!preview ? (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">
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
        <div className="mt-4">
          <SourceNotice sourceKind={sourceKind} cards={cards} accounts={accounts} />
        </div>
        </section>
      ) : null}

      {!preview ? (
        <>
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileUp className="h-5 w-5" aria-hidden="true" />
            Arquivo PDF
          </h2>
          <p className="text-sm text-muted-foreground">
            Escolha a origem e a competência antes de enviar sua fatura.
          </p>
        </div>
        <form onSubmit={preventSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Arquivo
            <Input
              type="file"
              accept=".pdf,.ofx,.csv,.xls,.xlsx,application/pdf"
              onChange={handleFileChange}
              className="h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1 file:text-sm file:font-medium"
            />
          </label>
          {file ? (
            <p className="text-sm text-muted-foreground">Arquivo selecionado: {file.name}</p>
          ) : null}
          {detection ? <DetectionMessage detection={detection} /> : null}
          {detection?.format === 'pdf' && detection.encrypted ? (
            <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
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
            <p className="text-xs text-muted-foreground">
              PDF é o único formato de arquivo aceito nesta fase.
            </p>
            <Button type="button" disabled={!canUploadFile || busy} onClick={() => void uploadFile()}>
              {busy ? 'Processando…' : 'Pré-visualizar PDF'}
            </Button>
          </div>
          {loadingSources ? (
            <p className="text-sm text-muted-foreground">Carregando origens…</p>
          ) : null}
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <ClipboardPaste className="h-5 w-5" aria-hidden="true" />
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
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              O texto fica nesta tela até você confirmar as linhas.
            </p>
            <Button type="button" disabled={!canUploadText || busy} onClick={() => void uploadText()}>
              {busy ? 'Processando…' : 'Pré-visualizar texto'}
            </Button>
          </div>
        </form>
        </section>
        </>
      ) : null}

      {!preview && preview ? <PreviewNotice preview={preview} /> : null}

      <ImportHistory refreshKey={historyRefreshKey} />
    </div>
  );
}
