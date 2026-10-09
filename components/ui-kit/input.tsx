import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full border border-input bg-card px-3 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive sm:h-9 sm:text-sm',
        className,
      )}
      {...props}
    />
  );
}
