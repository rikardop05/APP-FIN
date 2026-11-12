'use client';

import { useId, useState, type ChangeEvent, type DragEvent } from 'react';
import { FileUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type DropZoneProps = {
  file: File | null;
  disabled?: boolean;
  /** Quantos arquivos há na fila (o da vez incluído); mais de um muda o texto. */
  queueSize?: number;
  /** Chamado com os arquivos escolhidos ou soltos (um ou vários); lista vazia quando a escolha é limpa. */
  onFiles: (files: File[]) => void;
};

/**
 * Área de soltar a fatura, em pt-BR, no lugar do input nativo do navegador. O `<input type="file">`
 * continua sendo o controle real (teclado, leitor de tela, seletor do sistema): fica visualmente
 * escondido e a área inteira é o rótulo dele. Soltar um arquivo faz o mesmo que escolhê-lo.
 */
export function DropZone({ file, disabled = false, queueSize = 1, onFiles }: DropZoneProps) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    onFiles(Array.from(event.target.files ?? []));
    // Permite escolher o mesmo arquivo de novo depois de limpar.
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length > 0) onFiles(dropped);
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
        {file ? file.name : 'Arraste as faturas ou escolha os PDFs'}
      </span>
      <span className="text-sm text-muted-foreground">
        {file
          ? queueSize > 1
            ? 'Solte outros arquivos aqui para trocar a fila.'
            : 'Solte outro arquivo aqui para trocar.'
          : 'Pode escolher várias faturas de uma vez. Nada é enviado antes de você pedir a pré-visualização.'}
      </span>
      <span className="mt-1 inline-flex h-11 items-center border border-input bg-background px-4 text-sm font-medium text-foreground sm:h-9">
        {file ? 'Escolher outros arquivos' : 'Escolher os PDFs'}
      </span>
      <input
        id={inputId}
        type="file"
        accept=".pdf,.ofx,.csv,.xls,.xlsx,application/pdf"
        multiple
        disabled={disabled}
        onChange={handleChange}
        className="sr-only"
      />
    </label>
  );
}
