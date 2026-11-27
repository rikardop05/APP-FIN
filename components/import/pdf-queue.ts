/**
 * Fila de PDFs do /importar: o que é puro fica aqui (o vitest não transforma JSX).
 * Nada daqui grava coisa alguma: a fila só decide qual arquivo é o da vez e qual cartão sugerir.
 */

export type QueueCard = { id: string; name: string; bank?: string | null };

/** "Fatura 2 de 3"; sem fila (um arquivo só), `null`. */
export function queueLabel(position: number, total: number): string | null {
  if (total <= 1) return null;
  return `Fatura ${position} de ${total}`;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Palavras que identificam o banco nos cartões cadastrados (campo "banco" ou nome do cartão). */
const BANK_TOKENS: Record<string, readonly string[]> = {
  nubank_card: ['nubank'],
  santander_card: ['santander'],
  mercadopago_card: ['mercadopago', 'mp'],
  itau_card: ['itau', 'itaucard'],
  inter_card: ['bancointer', 'inter'],
};

/**
 * Tokens que só valem como o campo "banco" inteiro, nunca dentro de um texto: `mp` e `inter`
 * são curtos demais e aparecem em outras palavras ("Internacional", "campo").
 */
const EXACT_BANK_TOKENS: ReadonlySet<string> = new Set(['mp', 'inter']);

/**
 * Cartão ativo que casa com o banco detectado, só quando é exatamente UM. Zero ou vários → `null`
 * e a tela pede a origem: escolher o cartão errado jogaria a fatura na conta de outro cartão.
 * O texto do cartão precisa conter a palavra do banco ("Nubank Ultravioleta" casa com `nubank_card`).
 */
export function matchCardForBank(bankKey: string | null, cards: readonly QueueCard[]): QueueCard | null {
  if (bankKey === null) return null;
  const tokens = BANK_TOKENS[bankKey];
  if (tokens === undefined) return null;
  const matches = cards.filter((card) => {
    const text = normalize(`${card.bank ?? ''} ${card.name}`);
    return tokens.some((token) =>
      EXACT_BANK_TOKENS.has(token) ? normalize(card.bank ?? '') === token : text.includes(token),
    );
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * O cartão que a pessoa já deixou escolhido continua valendo para a fatura que acabou de entrar?
 * Vale quando a fatura não contradiz o cartão: banco ainda desconhecido pelo nome do arquivo (o caso
 * comum — o PDF vem comprimido e o emissor só é lido no servidor) ou banco que o cartão confirma.
 * Só NÃO vale quando o arquivo aponta um banco e o cartão escolhido é de outro: aí a tela pede a origem.
 * Apagar uma escolha que ninguém contradisse faz a pessoa achar que ela ainda está lá.
 */
export function keepChosenCard(bankKey: string | null, chosen: QueueCard | null): boolean {
  if (chosen === null) return false;
  if (bankKey === null || BANK_TOKENS[bankKey] === undefined) return true;
  return matchCardForBank(bankKey, [chosen]) !== null;
}
