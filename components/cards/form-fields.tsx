import type { ReactNode } from 'react';

type FieldProps = {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactNode;
};

export function Field({ label, htmlFor, error, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={htmlFor}>
      <span className="font-medium text-foreground">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </label>
  );
}
