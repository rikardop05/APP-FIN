import { Suspense } from 'react';

import { ConfigScreen } from './config-screen';

export const dynamic = 'force-dynamic';

/**
 * T-114: categorias (2 niveis, `nature` na folha), regras (CRUD, reordenacao,
 * hits), membros e premissas globais. Substitui o stub do T-005.
 *
 * As 5 secoes sao abas de verdade via `?aba=` (lido com `useSearchParams` na
 * tela): so a aba ativa renderiza, em vez de uma pagina unica de ~6.000px.
 * O `Suspense` e a borda exigida pelo `useSearchParams`.
 */
export default function ConfigPage() {
  return (
    <Suspense>
      <ConfigScreen />
    </Suspense>
  );
}
