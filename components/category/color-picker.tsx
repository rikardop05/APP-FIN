'use client';

import { useRef, type KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import { buildSwatchOptions, nextColorValue } from './color-palette';

type ColorPickerProps = {
  value: string;
  onChange: (value: string) => void;
  /** Cor que a categoria tinha ao abrir o formulario (para a amostra "Cor atual"). */
  initialValue: string;
};

/** Seletor de cor por amostras: radiogroup, setas navegam, marca visivel na escolhida. */
export function ColorPicker({ value, onChange, initialValue }: ColorPickerProps) {
  const options = buildSwatchOptions(initialValue);
  const values = ['', ...options.map((o) => o.value)];
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selected = values.includes(value.toLowerCase()) ? value.toLowerCase() : '';

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = nextColorValue(values, selected, step);
    onChange(next);
    refs.current[next]?.focus();
  }

  const base =
    'relative flex h-9 w-9 items-center justify-center border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

  return (
    <div
      role="radiogroup"
      aria-label="Cor da categoria"
      className="flex flex-wrap gap-2 pb-4"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected === ''}
        aria-label="Sem cor"
        title="Sem cor"
        tabIndex={selected === '' ? 0 : -1}
        ref={(el) => {
          refs.current[''] = el;
        }}
        onClick={() => onChange('')}
        className={`${base} border-dashed bg-transparent text-xs text-muted-foreground ${
          selected === '' ? 'border-foreground' : 'border-input'
        }`}
      >
        {selected === '' ? <Check aria-hidden className="h-4 w-4 text-foreground" /> : <span aria-hidden>∅</span>}
      </button>
      {options.map((option) => {
        const checked = selected === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.label}
            title={option.label}
            tabIndex={checked ? 0 : -1}
            ref={(el) => {
              refs.current[option.value] = el;
            }}
            onClick={() => onChange(option.value)}
            style={{ backgroundColor: option.value }}
            className={`${base} ${checked ? 'border-foreground' : 'border-transparent'}`}
          >
            {checked ? <Check aria-hidden className="h-5 w-5 text-white drop-shadow" strokeWidth={3} /> : null}
            {option.isCurrent ? (
              <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground">
                atual
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
