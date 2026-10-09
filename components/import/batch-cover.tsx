import { competenceLong } from '@/components/cashflow/labels';
import { Guilhoche } from '@/components/ui-kit';
import { formatDateBR } from '@/lib/date';
import { bankLabel } from './review-model';
import type { UploadResponse } from './schemas';

type BatchCoverProps = {
  bankKey: string | null;
  sourceName: string;
  /** Competência declarada da fatura (AAAA-MM). */
  competence: string;
  documentDate: UploadResponse['preview']['documentDate'];
  fileName: string;
  rowsRead: number;
};

function Dado({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-card px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Capa do lote: a capa do carnê. Identidade (banco e cartão) sobre o guilhochê; cada dado fica num
 * bloco de papel sólido, e nenhum número fica sobre o desenho.
 */
export function BatchCover({ bankKey, sourceName, competence, documentDate, fileName, rowsRead }: BatchCoverProps) {
  return (
    <section aria-label="Capa do lote" className="border border-border">
      <Guilhoche className="flex flex-col gap-1 border-b border-border px-4 py-4">
        <p className="w-fit bg-card px-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Fatura em revisão
        </p>
        <h2 className="w-fit bg-card px-1.5 text-2xl font-semibold tracking-tight text-foreground">
          {bankLabel(bankKey)} · {sourceName}
        </h2>
      </Guilhoche>
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        <Dado label="Competência">{competenceLong(competence)}</Dado>
        <Dado label={documentDate?.kind === 'statement_date' ? 'Emitida em' : 'Vencimento'}>
          {documentDate ? formatDateBR(documentDate.date) : 'Não impresso'}
        </Dado>
        <Dado label="Linhas lidas">{rowsRead}</Dado>
        <Dado label="Arquivo">
          <span title={fileName}>{fileName}</span>
        </Dado>
      </dl>
    </section>
  );
}
