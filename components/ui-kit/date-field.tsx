'use client';

import { useEffect, useState } from 'react';
import { maskDateBR, parseDateBR, toDateBR } from './date-field-model';
import { Input } from './input';

type DateFieldProps = {
  /** Data em `AAAA-MM-DD`, ou vazio. */
  value: string;
  /** Recebe `AAAA-MM-DD` quando a data digitada é válida, e vazio enquanto está incompleta ou inválida. */
  onChange: (iso: string) => void;
  'aria-label'?: string;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

/**
 * Campo de data em pt-BR: digita-se `dd/mm/aaaa` (as barras entram sozinhas) e o valor sai em ISO. No
 * lugar do `<input type="date">` nativo, que mostra "dd/mm/yyyy" conforme o idioma do navegador.
 * Teclado numérico no celular.
 */
export function DateField({ value, onChange, className, ...props }: DateFieldProps) {
  const [text, setText] = useState(() => toDateBR(value));

  // Mudança de fora (outra linha, limpar): só ressincroniza se o texto atual não representa já esse valor.
  useEffect(() => {
    if (parseDateBR(text) !== (value || null)) setText(toDateBR(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage só ao valor vindo de fora
  }, [value]);

  return (
    <Input
      {...props}
      className={className}
      value={text}
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/aaaa"
      maxLength={10}
      aria-invalid={text !== '' && parseDateBR(text) === null ? true : undefined}
      onChange={(event) => {
        const next = maskDateBR(event.target.value);
        setText(next);
        onChange(parseDateBR(next) ?? '');
      }}
    />
  );
}
