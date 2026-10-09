/**
 * Lógica pura do campo de data pt-BR (`DateField`): digita-se `dd/mm/aaaa`, o valor é `AAAA-MM-DD`.
 * O `<input type="date">` nativo mostra "dd/mm/yyyy" e segue o idioma do navegador.
 */

/** Só dígitos, no máximo 8, com as barras postas: `04102026` -> `04/10/2026`; `0410` -> `04/10`. */
export function maskDateBR(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** `'04/10/2026'` -> `'2026-10-04'`; texto incompleto ou data que não existe (31/02) -> `null`. */
export function parseDateBR(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (match === null) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

/** `'2026-10-04'` -> `'04/10/2026'`; qualquer outra coisa (vazio, inválido) -> `''`. */
export function toDateBR(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return '';
  return parseDateBR(`${match[3]}/${match[2]}/${match[1]}`) === iso ? `${match[3]}/${match[2]}/${match[1]}` : '';
}
