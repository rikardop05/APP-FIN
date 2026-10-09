import { competenceLong } from '@/components/cashflow/labels';
import { Canhoto, Money, Parcela } from '@/components/ui-kit';
import type { StillHeld } from './schemas';

type StillHeldColumnProps = {
  stillHeld: StillHeld;
  /** Recalculando: a coluna mantém o último resultado e avisa. */
  recalculating?: boolean;
};

/**
 * Coluna "Ainda presos": as parcelas que o lote projeta nos próximos meses, por competência. São os
 * canhotos que continuam presos ao carnê (tracejados): o futuro já comprometido por esta fatura.
 * Valores em módulo (a saída é mostrada pela magnitude).
 */
export function StillHeldColumn({ stillHeld, recalculating = false }: StillHeldColumnProps) {
  return (
    <aside aria-labelledby="ainda-presos" className="flex flex-col gap-3" aria-busy={recalculating}>
      <div className="flex flex-col gap-0.5">
        <h3 id="ainda-presos" className="text-base font-semibold text-foreground">
          Ainda presos
        </h3>
        <p className="text-sm text-muted-foreground">
          Parcelas que este lote deixa para os próximos meses.
        </p>
      </div>

      {stillHeld.count === 0 ? (
        <p className="border border-dashed border-input px-3 py-4 text-sm text-muted-foreground">
          Este lote não projeta parcelas futuras.
        </p>
      ) : (
        <>
          <p className="flex items-baseline justify-between gap-2 border-y border-foreground py-2 text-sm">
            <span className="text-muted-foreground">
              {stillHeld.count === 1 ? '1 parcela' : `${stillHeld.count} parcelas`} a vencer
            </span>
            <Money value={stillHeld.totalCents} sign="never" className="text-base font-semibold" />
          </p>
          <ol className="flex flex-col gap-4">
            {stillHeld.months.map((month) => (
              <li key={month.competence} className="flex flex-col gap-1.5">
                <p className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground first-letter:uppercase">{competenceLong(month.competence)}</span>
                  <Money value={month.totalCents} sign="never" className="text-muted-foreground" />
                </p>
                <ul className="flex flex-col gap-1">
                  {month.items.map((item) => (
                    <Canhoto
                      as="li"
                      key={`${item.sourceIndex}-${item.installmentNumber}`}
                      preso
                      stub={<Parcela atual={item.installmentNumber} total={item.installmentsCount} />}
                      valor={<Money value={item.amountCents} sign="never" className="text-sm" />}
                    >
                      <span className="truncate text-sm text-foreground">{item.description}</span>
                    </Canhoto>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </aside>
  );
}
