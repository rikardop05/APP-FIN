/**
 * "Hoje" em São Paulo, como `YYYY-MM-DD`.
 *
 * O relógio só pode ser lido em `app/`: `lib/` recebe `today` por parâmetro
 * (CONVENTIONS), e é por isso que este helper mora aqui e não em `lib/`.
 */
export function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
