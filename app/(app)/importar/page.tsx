import { todayInSaoPaulo } from '@/app/_lib/today';
import { ImportScreen } from '@/components/import/import-screen';

export const dynamic = 'force-dynamic';

export default function ImportarPage() {
  return <ImportScreen today={todayInSaoPaulo()} />;
}
