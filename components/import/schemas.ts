import { z } from 'zod';
import type { Cents } from '@/lib/money';

export const sourceKindSchema = z.enum(['credit_card', 'account']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const competenceSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const nullableUuidSchema = z.string().uuid().nullable();
const centsSchema = z.custom<Cents>(
  (value) => typeof value === 'number' && Number.isSafeInteger(value),
);

const sourceItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  active: z.boolean(),
});

export const accountsResponseSchema = z.object({
  accounts: z.array(sourceItemSchema),
});

export const apiErrorSchema = z.object({
  error: z.string(),
});

export const cardsResponseSchema = z.object({
  cards: z.array(sourceItemSchema),
  members: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
});

type CategoryNodeShape = {
  id: string;
  name: string;
  parentId: string | null;
  nature: 'essential' | 'non_essential' | 'investment' | 'income';
  children: CategoryNodeShape[];
};

const categoryNodeSchema: z.ZodType<CategoryNodeShape> = z.lazy(() => z.object({
  id: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  nature: z.enum(['essential', 'non_essential', 'investment', 'income']),
  children: z.array(z.lazy(() => categoryNodeSchema)),
}));

/**
 * Resposta de `GET`/`PATCH /api/cards`: os campos que o `PATCH` exige de volta.
 * `PATCH /api/cards/[id]` SUBSTITUI o cartão inteiro (`cardBodySchema`): omitir
 * `bank`, `holderMemberId` ou `paymentAccountId` os zera. Quem corrige só o
 * vencimento precisa mandar o resto como está, lido na hora.
 */
export const cardFullSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  bank: z.string().nullable(),
  brand: z.enum(['visa', 'mastercard', 'elo', 'amex', 'other']),
  holderMemberId: z.string().uuid().nullable(),
  paymentAccountId: z.string().uuid().nullable(),
  creditLimitCents: z.number().int().nonnegative().nullable(),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
});

export const cardsFullResponseSchema = z.object({
  cards: z.array(cardFullSchema),
});

export const categoriesResponseSchema = z.object({
  categories: z.array(categoryNodeSchema),
});

const installmentSchema = z
  .object({
    current: z.number().int(),
    total: z.number().int(),
  })
  .nullable();

const previewRowSchema = z.object({
  index: z.number().int(),
  occurredOn: isoDateSchema.nullable(),
  competence: competenceSchema.nullable(),
  description: z.string(),
  rawDescription: z.string(),
  amountCents: centsSchema.nullable(),
  dedupeHash: z.string().nullable(),
  suggestedCategoryId: nullableUuidSchema,
  suggestedMemberId: nullableUuidSchema,
  state: z.enum(['new', 'duplicate', 'installment_first', 'installment_part', 'credit_card_payment']),
  installment: installmentSchema,
});

const previewSchema = z.object({
  rows: z.array(previewRowSchema),
  summary: z.object({
    rowsRead: z.number().int(),
    rowsNew: z.number().int(),
    rowsDuplicated: z.number().int(),
    installmentPlansDetected: z.number().int(),
    totalCents: centsSchema,
    uncategorizedCount: z.number().int(),
  }),
  diagnostics: z.array(
    z.object({
      line: z.number().int(),
      message: z.string(),
      raw: z.string(),
    }),
  ),
  /**
   * Data impressa no documento (`lib/import/types.ts`, `DocumentDate`). DECLARADA
   * aqui de propósito e OBRIGATÓRIA (só pode ser `null`): `z.object` descarta
   * chave que o schema não conhece, e sem esta linha o aviso de competência
   * divergente nunca dispararia, com tudo verde. Se a rota parar de enviá-la, o
   * upload falha alto em vez de o aviso sumir em silêncio.
   */
  documentDate: z
    .object({
      date: isoDateSchema,
      kind: z.enum(['due_date', 'statement_date']),
    })
    .nullable(),
});

const previousBatchSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileHash: z.string(),
  status: z.enum(['pending', 'committed', 'reverted', 'failed']),
  createdAt: z.string(),
});

export const uploadResponseSchema = z.object({
  fileName: z.string(),
  fileHash: z.string(),
  format: z.enum(['pdf', 'text']),
  bankKey: z.string().nullable(),
  sourceKind: z.enum(['credit_card', 'account']),
  sourceId: z.string().uuid(),
  cardCycle: z
    .object({
      closingDay: z.number().int(),
      dueDay: z.number().int(),
    })
    .nullable(),
  preview: previewSchema,
  previousBatches: z.array(previousBatchSchema),
});

export const recalculateResponseSchema = z.object({
  totalCents: centsSchema,
  /**
   * Quantas linhas vão ser gravadas neste commit. É a resposta à pergunta que
   * o usuário tem na hora de clicar em "Confirmar" — "o que vai entrar?" — e
   * difere do `rowsNew` do resumo (que é "linhas lidas que não são duplicatas"
   * e conta a linha de pagamento, que chega desmarcada). O motor já sabe o
   * número depois do dedupe e do filtro de `include`; devolvemos aqui em vez
   * de a tela adivinhar.
   */
  includedRowsCount: z.number().int().nonnegative(),
  /**
   * Parcelas futuras que o motor projetou, já contadas DENTRO de
   * `includedRowsCount`. `totalCents` cobre só as linhas marcadas; a contagem
   * cobre as marcadas mais estas. O rodapé mostra os dois separados.
   */
  plannedRowsCount: z.number().int().nonnegative(),
  competenceByIndex: z.array(
    z.object({
      index: z.number().int(),
      competence: competenceSchema.nullable(),
    }),
  ),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type CardFull = z.infer<typeof cardFullSchema>;
export type SourceItem = z.infer<typeof sourceItemSchema>;
export type MemberItem = z.infer<typeof cardsResponseSchema>['members'][number];
export type CategoryNode = z.infer<typeof categoryNodeSchema>;
