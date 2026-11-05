'use client';

import { useEffect, useRef, useState } from 'react';
import { Select } from '@/components/ui-kit';
import { PICKER_NAVIGATION_KEYS, pickerEnterChoice, shouldApplyPickerChange } from './review-model';
import { cn } from '@/lib/utils';

export type CategoryPickerOption = { id: string; label: string };

type RowCategoryPickerProps = {
  /** Categoria atual da linha (`null` = sem categoria). */
  value: string | null;
  /** Nome exibido no gatilho. */
  name: string;
  options: readonly CategoryPickerOption[];
  /** Contexto da linha para o nome acessivel ("Linha 3, Mercadopag"). */
  rowContext: string;
  onChange: (categoryId: string | null) => void;
};

/**
 * Categoria da linha, clicavel: o texto vira um botao (Enter/Espaco abrem) que
 * troca por um seletor so desta linha. Escolher aplica na hora e fecha; Esc ou
 * sair do campo fecham; o foco volta ao gatilho. Nao mexe na selecao do lote.
 * "Sem categoria" ganha destaque visual para chamar a atencao.
 */
export function RowCategoryPicker({ value, name, options, rowContext, onChange }: RowCategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const restoreFocus = useRef(false);
  // Mudanca por seta/Home/End num select fechado nao grava: o select mostra o valor
  // PENDENTE (estado local) e Enter grava exatamente esse valor.
  const viaKeyboard = useRef(false);
  const [shown, setShown] = useState(value ?? '');

  useEffect(() => {
    if (open) {
      // Abre limpo: sem tecla de navegacao armada e mostrando a categoria atual.
      viaKeyboard.current = false;
      setShown(value ?? '');
      selectRef.current?.focus();
      // Abre a lista de verdade quando o navegador deixa; ai a seta so move o destaque.
      try {
        selectRef.current?.showPicker?.();
      } catch {
        // showPicker exige gesto do usuario; sem ele o select segue aberto como campo.
      }
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- so reage a abrir/fechar; `value` e lido no momento de abrir
  }, [open]);

  function close() {
    viaKeyboard.current = false;
    restoreFocus.current = true;
    setOpen(false);
  }

  if (open) {
    return (
      <Select
        ref={selectRef}
        value={shown}
        aria-label={`Categoria da ${rowContext}`}
        className="h-8 w-auto min-w-40 max-w-full py-0 text-xs sm:h-7 sm:text-xs"
        onChange={(event) => {
          setShown(event.target.value);
          if (!shouldApplyPickerChange(viaKeyboard.current)) return;
          onChange(event.target.value || null);
          close();
        }}
        onPointerDown={() => {
          viaKeyboard.current = false;
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          } else if (PICKER_NAVIGATION_KEYS.includes(event.key)) {
            viaKeyboard.current = true;
          } else if (event.key === 'Enter') {
            const choice = pickerEnterChoice(shown, value);
            if (choice.apply) {
              event.preventDefault();
              onChange(choice.categoryId);
              close();
            }
          }
        }}
        onBlur={() => {
          // Sair do campo descarta o pendente e desarma a navegacao por teclado.
          viaKeyboard.current = false;
          setOpen(false);
        }}
      >
        <option value="">Sem categoria</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="listbox"
      aria-label={`Categoria da ${rowContext}: ${name}. Alterar`}
      onClick={() => setOpen(true)}
      className={cn(
        'underline decoration-dotted underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        value === null && 'font-semibold text-foreground decoration-solid',
      )}
    >
      {name}
    </button>
  );
}
