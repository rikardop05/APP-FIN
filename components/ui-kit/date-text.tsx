import { formatDateBR, type IsoDate } from '@/lib/date';

type DateTextProps = {
  /** Data sem hora, `'YYYY-MM-DD'`. */
  value: IsoDate;
  className?: string;
};

/**
 * Único componente autorizado a exibir data de fato financeiro (CONVENTIONS
 * §4). Formata via `formatDateBR` — nunca `Intl.DateTimeFormat` nem `Date`
 * direto no componente.
 */
export function DateText({ value, className }: DateTextProps) {
  return (
    <time dateTime={value} className={className}>
      {formatDateBR(value)}
    </time>
  );
}
