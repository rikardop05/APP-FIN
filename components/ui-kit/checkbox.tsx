import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
};

export function Checkbox({ className, label, ...props }: CheckboxProps) {
  return (
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground sm:min-h-9">
      <input
        type="checkbox"
        className={cn('h-5 w-5 border-input accent-primary', className)}
        {...props}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}
