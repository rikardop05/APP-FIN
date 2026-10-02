import type { TransactionStatus } from '@/lib/db';

/**
 * Status que contam como dinheiro (e aparecem nas listas). `reconciled` (decisão
 * nº 7) é uma previsão JÁ CUMPRIDA por um `posted`: contá-la ou listá-la de novo
 * seria despesa em dobro. Lista POSITIVA de propósito: um status novo fica de fora
 * até alguém decidir o contrário (certo por omissão). Toda leitura de dinheiro e
 * toda lista de lançamentos passa por aqui.
 */
export const COUNTED_STATUSES: TransactionStatus[] = ['posted', 'planned'];
