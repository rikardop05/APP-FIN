'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { Download, FileJson, Upload } from 'lucide-react';

import { Button } from '@/components/ui-kit';

import {
  apiErrorText,
  backupContentsText,
  dryRunResponseSchema,
  refusalText,
  type DryRunResponse,
} from './backup-text';

/** Link de download com o mesmo desenho do `Button` (que não renderiza `<a>`). */
const linkClass =
  'inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

type Pending = { fileName: string; payload: unknown; check: DryRunResponse };

/**
 * Backup (T-402): baixar o household inteiro (JSON) ou só os lançamentos (CSV), e restaurar
 * um backup. Restaurar primeiro VALIDA (`dryRun=1`) e mostra o que o arquivo tem e o que vai
 * acontecer; só grava se a pessoa confirmar, e a API recusa (409) household com dado.
 */
export function BackupSection() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setMessage(null);
    setBusy(true);
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        setMessage({ tone: 'error', text: 'O arquivo não é um backup do APPFIN (JSON inválido).' });
        return;
      }
      const response = await fetch('/api/backup/restore?dryRun=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: 'error', text: apiErrorText(body, 'Não foi possível validar o backup.') });
        return;
      }
      setPending({ fileName: file.name, payload, check: dryRunResponseSchema.parse(body) });
    } catch {
      setMessage({ tone: 'error', text: 'Não foi possível validar o backup.' });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (pending === null) return;
    setBusy(true);
    try {
      const response = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(pending.payload),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage({ tone: 'error', text: apiErrorText(body, 'Não foi possível restaurar o backup.') });
      } else {
        setMessage({ tone: 'ok', text: 'Backup restaurado. Recarregue a página para ver os dados.' });
      }
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const refusal = pending === null ? null : refusalText(pending.check.targetHasData);

  return (
    <section aria-labelledby="backup-heading" className="flex flex-col gap-3">
      <div>
        <h2 id="backup-heading" className="text-lg font-semibold tracking-tight">
          Backup
        </h2>
        <p className="text-sm text-muted-foreground">
          Um arquivo com todos os dados da casa. Restaurar só funciona numa casa ainda sem dados, e nunca sobrescreve nada.
        </p>
      </div>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:flex-wrap">
        <a href="/api/backup" download className={`${linkClass} border border-border bg-background text-foreground hover:bg-secondary/60`}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Baixar backup
        </a>
        <a href="/api/backup?format=csv" download className={`${linkClass} text-muted-foreground hover:bg-secondary/60 hover:text-foreground`}>
          <FileJson className="h-4 w-4" aria-hidden="true" />
          Lançamentos em CSV
        </a>
        <Button variant="outline" className="gap-2" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden="true" />
          {busy && pending === null ? 'Validando…' : 'Restaurar backup'}
        </Button>
        <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void choose(event)} />
      </div>
      {message ? (
        <p
          className={
            message.tone === 'error'
              ? 'rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'
              : 'rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
          }
          role={message.tone === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      ) : null}

      {pending ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/20 p-0 sm:items-center sm:p-4" role="presentation">
          <div
            className="max-h-[90vh] w-full overflow-y-auto rounded-t-lg border border-border bg-background p-4 shadow-lg sm:max-w-xl sm:rounded-lg sm:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-dialog-title"
          >
            <h2 id="backup-dialog-title" className="mb-3 text-lg font-semibold">
              Restaurar {pending.fileName}?
            </h2>
            <p className="text-sm">O arquivo é válido. {backupContentsText(pending.check.tables)}</p>
            {pending.check.warnings.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {pending.check.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            {refusal ? (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
                {refusal}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" disabled={busy} onClick={() => setPending(null)}>
                Cancelar
              </Button>
              {/* Household com dado: a API recusaria (409); o botão nem deixa tentar. */}
              <Button disabled={busy || refusal !== null} onClick={() => void restore()}>
                {busy ? 'Restaurando…' : 'Restaurar'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
