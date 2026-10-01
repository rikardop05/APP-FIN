import { z } from 'zod';
import { frequency, incomeKind, type Frequency, type IncomeKind } from '@/lib/db/enums';

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const nullableIsoDateSchema = isoDateSchema.nullable();
const competenceSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const nullableCompetenceSchema = competenceSchema.nullable();
const nullableUuidSchema = z.string().uuid().nullable();
const uuidSchema = z.string().uuid();

/**
 * Strings vêm da DOM — `Input type="number"` devolve string. Validamos
 * `z.coerce.number()` na rota (`app/api/recurring/schemas.ts` e
 * `app/api/incomes/schemas.ts`), que recebe o corpo já em string. Aqui, na
 * borda da TELA, mantemos string para que o React não reclame de NaN no
 * state intermediário — quem converte é o handler no submit, com `parseBRL`
 * ou `Number(...)`.
 */

const frequencyValues = frequency.enumValues;
const frequencyLabels: Record<Frequency, string> = {
  monthly: 'Mensal',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
  one_off: 'Eventual',
};

const frequencySelectSchema = z.enum(frequencyValues);

const incomeKindValues = incomeKind.enumValues;

const incomeKindLabels: Record<IncomeKind, string> = {
  salary: 'Salário',
  pro_labore: 'Pró-labore',
  variable: 'Renda variável',
  rent: 'Aluguel',
  other: 'Outro',
};

const incomeKindSelectSchema = z.enum(incomeKindValues);

export const RecurringExpenseFormSchema = z
  .object({
    description: z.string().trim().min(1, 'Informe uma descrição.').max(240),
    /** Texto livre (R$ 0,00) — conversão para cents é no handler, com `parseBRL`. */
    amountInput: z.string().trim().min(1, 'Informe um valor.').max(40),
    categoryId: uuidSchema,
    /** Strings do DOM — convertidas para number no handler. */
    dueDay: z.string().regex(/^\d{1,2}$/, 'Dia de 1 a 31.'),
    frequency: frequencySelectSchema,
    accountId: nullableUuidSchema,
    creditCardId: nullableUuidSchema,
    startsOn: isoDateSchema,
    endsOn: nullableIsoDateSchema,
    /** String vazia ou número em bp — conversão no handler. */
    annualAdjustmentBp: z
      .union([z.literal(''), z.string().regex(/^-?\d+$/, 'Informe um número inteiro.')])
      .nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.accountId !== null && value.creditCardId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe uma conta OU um cartão, não os dois.',
        path: ['accountId'],
      });
    }
    if (value.endsOn !== null && value.endsOn < value.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data final não pode ser anterior à data inicial.',
        path: ['endsOn'],
      });
    }
  });

export const IncomeFormSchema = z
  .object({
    description: z.string().trim().min(1, 'Informe uma descrição.').max(240),
    amountInput: z.string().trim().min(1, 'Informe um valor.').max(40),
    kind: incomeKindSelectSchema,
    memberId: uuidSchema,
    receiveDay: z.string().regex(/^\d{1,2}$/, 'Dia de 1 a 31.'),
    frequency: frequencySelectSchema,
    oneOffCompetence: nullableCompetenceSchema,
    startsOn: nullableIsoDateSchema,
    endsOn: nullableIsoDateSchema,
  })
  .superRefine((value, ctx) => {
    if (value.frequency === 'one_off') {
      if (value.oneOffCompetence === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Receita eventual exige uma competência fixa.',
          path: ['oneOffCompetence'],
        });
      }
      return;
    }
    if (value.oneOffCompetence !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Competência fixa só se aplica a receitas eventuais.',
        path: ['oneOffCompetence'],
      });
    }
    if (value.startsOn === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a data de início da receita.',
        path: ['startsOn'],
      });
      return;
    }
    if (value.endsOn !== null && value.endsOn < value.startsOn) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data final não pode ser anterior à data inicial.',
        path: ['endsOn'],
      });
    }
  });

export type RecurringExpenseFormInput = z.infer<typeof RecurringExpenseFormSchema>;
export type IncomeFormInput = z.infer<typeof IncomeFormSchema>;

export const frequencyLabel = (value: Frequency): string => frequencyLabels[value];
export const incomeKindLabel = (value: IncomeKind): string => incomeKindLabels[value];
