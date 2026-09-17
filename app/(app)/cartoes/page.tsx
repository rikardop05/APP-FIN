import { CartoesScreen } from '@/components/cards/cartoes-screen';

export const dynamic = 'force-dynamic';

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/**
 * Stub do T-005 (layout e navegação) — só PageHeader e EmptyState.
 * Substituída pelo T-109 (cadastro de contas e cartões, faturas por mês) e
 * pelo T-113 (comprometimento futuro em 24 meses, uso de limite).
 */
export default function CartoesPage() {
  return <CartoesScreen today={todayInSaoPaulo()} />;
}
