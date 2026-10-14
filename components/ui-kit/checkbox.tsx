import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
};

export function Checkbox({ className, label, ...props }: CheckboxProps) {
  return (
    // Alvo de 44px no toque (celular, ponteiro grosso); com mouse (ponteiro fino) o min-height
    // solta para o canhoto poder fechar na densidade do documento sem perder o alvo de 20px.
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-9 [@media(pointer:fine)]:min-h-0">
      <input
        type="checkbox"
        className={cn('h-5 w-5 border-input accent-primary', className)}
        {...props}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}
