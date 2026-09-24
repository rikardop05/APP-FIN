import { z } from 'zod';

const natureSchema = z.enum(['essential', 'non_essential', 'investment', 'income']);

const baseFields = {
  name: z.string().trim().min(1, 'Informe o nome.').max(80),
  nature: natureSchema.nullable().optional().default(null),
  icon: z.string().trim().max(40).nullable().optional().default(null),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB.')
    .nullable()
    .optional()
    .default(null),
  sortOrder: z.number().int().min(0).max(100000).optional().default(0),
};

/**
 * Criacao de categoria. A profundidade de 1 nivel e garantida na query, que
 * consulta o pai — nao da para expressar em Zod, porque depende de outra linha.
 * `nature` e obrigatoria na folha; o superRefine recusa folha sem natureza.
 */
export const categoryCreateSchema = z
  .object({
    ...baseFields,
    parentId: z.string().uuid().nullable().optional().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.parentId !== null && value.nature === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['nature'],
        message: 'Informe a natureza da subcategoria.',
      });
    }
  });

/**
 * Atualizacao de categoria. **Sem `parentId`**: a hierarquia e definida so na
 * criacao. Antes, um `parentId` no PATCH era aceito e ignorado em silencio — o
 * cliente achava que movia a categoria e nada acontecia (achado 1 da revisao).
 * Mover categoria nao esta no escopo; se entrar, ganha validacao propria.
 */
export const categoryUpdateSchema = z.object(baseFields);

export const categoryIdSchema = z.string().uuid();

export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export type CategoryUpdate = z.infer<typeof categoryUpdateSchema>;
