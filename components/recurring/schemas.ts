import { z } from 'zod';
import { frequency, incomeKind, type Frequency, type IncomeKind } from '@/lib/db/enums';

import { parseAdjustmentPercent } from './recurring-form';

// Mensagens em pt-BR: a tela mostra a primeira que falhar, e o default do Zod
// ("Invalid uuid") e ingles e tecnico.
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data.');
const nullableIsoDateSchema = isoDateSchema.nullable();
const competenceSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Escolha o mês.');
const nullableCompetenceSchema = competenceSchema.nullable();
const choiceSchema = (message: string) => z.string().uuid(message);

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
    categoryId: choiceSchema('Escolha a categoria.'),
    /** Strings do DOM — convertidas para number no handler. */
    dueDay: z.string().regex(/^\d{1,2}$/, 'Dia de 1 a 31.'),
    frequency: frequencySelectSchema,
    accountId: choiceSchema('Escolha a conta.').nullable(),
    creditCardId: choiceSchema('Escolha o cartão.').nullable(),
    startsOn: isoDateSchema,
    endsOn: nullableIsoDateSchema,
    /**
     * Percentual digitado ("5", "4,5", "" = sem reajuste). O handler converte
     * para basis points com `parseAdjustmentPercent`; aqui so valida.
     */
    annualAdjustmentPercent: z.string().max(20),
  })
  .superRefine((value, ctx) => {
    const adjustment = parseAdjustmentPercent(value.annualAdjustmentPercent);
    if (!adjustment.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: adjustment.message,
        path: ['annualAdjustmentPercent'],
      });
    }
    if (value.accountId !== null && value.creditCardId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Escolha a conta ou o cartão, não os dois.',
        path: ['accountId'],
      });
    }
    if (value.accountId === null && value.creditCardId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe a conta ou o cartão de onde a despesa sai.',
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
    memberId: choiceSchema('Escolha o responsável.'),
    accountId: choiceSchema('Escolha a conta onde o dinheiro cai.'),
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
          message: 'Escolha o mês do recebimento da receita eventual.',
          path: ['oneOffCompetence'],
        });
      }
      return;
    }
    if (value.oneOffCompetence !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O mês fixo só vale para receita eventual.',
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
