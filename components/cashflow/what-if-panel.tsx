'use client';

import { useRef, useState, type FormEvent } from 'react';
import { FlaskConical, Trash2 } from 'lucide-react';

import { Button, Checkbox, Input, Money, Select } from '@/components/ui-kit';
import type { Competence } from '@/lib/date';
import { parseBRL } from '@/lib/money';

import type { WhatIfItem } from './adjustments';
import { competenceShort } from './labels';

type WhatIfPanelProps = {
  window: readonly Competence[];
  items: readonly WhatIfItem[];
  onChange: (items: WhatIfItem[]) => void;
};

/**
 * Simulador "e se" (RF-FLX-03). O estado mora no pai, em `useState`: nada aqui
 * grava, envia ou guarda. Fechar a tela descarta tudo — é o ponto. Se alguém achar
 * que o cenário deveria ser salvo, isso é outro fluxo e decisão do orquestrador;
 * não é para ser adicionado aqui.
 */
export function WhatIfPanel({ window, items, onChange }: WhatIfPanelProps) {
  const nextId = useRef(1);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [from, setFrom] = useState<Competence>(window[0] ?? '');
  const [repeat, setRepeat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseBRL(amount);
    if (parsed === null || parsed <= 0) {
      setError('Informe um valor maior que zero, por exemplo 500,00.');
      return;
    }
    if (from === '') {
      setError('Escolha o mês.');
      return;
    }
    setError(null);
    const id = `whatif-${String(nextId.current)}`;
    nextId.current += 1;
    onChange([
      ...items,
      {
        id,
        label: label.trim() === '' ? (direction === 'out' ? 'Saída simulada' : 'Entrada simulada') : label.trim(),
        fromCompetence: from,
        direction,
        amountCents: parsed,
        repeat,
      },
    ]);
    setLabel('');
    setAmount('');
  }

  return (
    <section
      aria-labelledby="fluxo-whatif-heading"
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="fluxo-whatif-heading" className="flex items-center gap-2 text-base font-semibold">
          <FlaskConical className="h-5 w-5" aria-hidden="true" />
          E se…?
        </h2>
        <p className="text-sm text-muted-foreground">
          Teste um corte ou uma entrada extra e veja a curva mudar.{' '}
          <strong className="font-medium text-foreground">É só uma simulação: nada é salvo</strong>{' '}
          e, ao sair desta tela, os ajustes somem.
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" noValidate>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-1">
          <span className="text-muted-foreground">Descrição</span>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: cortar lazer" maxLength={60} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Valor (R$)</span>
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="500,00"
            aria-invalid={error !== null}
            aria-describedby={error !== null ? 'fluxo-whatif-error' : undefined}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Tipo</span>
          <Select value={direction} onChange={(e) => setDirection(e.target.value === 'in' ? 'in' : 'out')}>
            <option value="out">Saída (gasto a mais)</option>
            <option value="in">Entrada (economia ou receita extra)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">A partir de</span>
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {window.map((competence) => (
              <option key={competence} value={competence}>
                {competenceShort(competence)}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <Checkbox
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
            label="Repetir todo mês até o fim da janela"
          />
          <Button type="submit">Adicionar à simulação</Button>
        </div>
        {error !== null ? (
          <p id="fluxo-whatif-error" role="alert" className="text-sm text-red-700 sm:col-span-2 lg:col-span-4">
            {error}
          </p>
        ) : null}
      </form>

      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{item.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.direction === 'out' ? 'Saída' : 'Entrada'} ·{' '}
                    {item.repeat
                      ? `todo mês, a partir de ${competenceShort(item.fromCompetence)}`
                      : `só em ${competenceShort(item.fromCompetence)}`}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Money value={item.amountCents} sign="never" className="text-foreground" />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remover ajuste ${item.label}`}
                    onClick={() => onChange(items.filter((other) => other.id !== item.id))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <div>
            <Button variant="outline" size="sm" onClick={() => onChange([])}>
              Limpar simulação
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
