'use client';

import { useId, useState, type ChangeEvent, type DragEvent } from 'react';
import { FileUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type DropZoneProps = {
  file: File | null;
  disabled?: boolean;
  /** Chamado com o arquivo escolhido ou solto; `null` quando a escolha é limpa. */
  onFile: (file: File | null) => void;
};

/**
 * Área de soltar a fatura, em pt-BR, no lugar do input nativo do navegador. O `<input type="file">`
 * continua sendo o controle real (teclado, leitor de tela, seletor do sistema): fica visualmente
 * escondido e a área inteira é o rótulo dele. Soltar um arquivo faz o mesmo que escolhê-lo.
 */
export function DropZone({ file, disabled = false, onFile }: DropZoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFile(event.target.files?.[0] ?? null);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={cn(
        'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-input bg-card px-4 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-ring',
        dragging && 'border-primary bg-secondary',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <FileUp className="h-6 w-6 text-primary" aria-hidden="true" />
      <span className="text-base font-medium text-foreground">
        {file ? file.name : 'Arraste a fatura ou escolha o PDF'}
      </span>
      <span className="text-sm text-muted-foreground">
        {file ? 'Solte outro arquivo aqui para trocar.' : 'Só o PDF da fatura. Nada é enviado antes de você pedir a pré-visualização.'}
      </span>
      <span className="mt-1 inline-flex h-11 items-center border border-input bg-background px-4 text-sm font-medium text-foreground sm:h-9">
        {file ? 'Escolher outro arquivo' : 'Escolher o PDF'}
      </span>
      <input
        id={inputId}
        type="file"
        accept=".pdf,.ofx,.csv,.xls,.xlsx,application/pdf"
        disabled={disabled}
        onChange={handleChange}
        className="sr-only"
      />
    </label>
  );
}
