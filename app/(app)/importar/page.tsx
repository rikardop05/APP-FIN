import { ImportScreen } from '@/components/import/import-screen';

export const dynamic = 'force-dynamic';

function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export default function ImportarPage() {
  return <ImportScreen today={todayInSaoPaulo()} />;
}
