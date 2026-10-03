import { z } from 'zod';

import { formatDateBR } from '@/lib/date';
import type { BasisPoints, Cents } from '@/lib/money';

/**
 * Corpos de `POST` e `PUT /api/investment`, alinhados com o domínio do motor
 * (`lib/finance/investment.ts`, "Domínio das entradas"): nenhum valor negativo, retirada
 * dos cenários > 0 (com `w <= 0` não há patrimônio-alvo e `scenarioTable` lança) e retorno
 * real > -100 %. O que passar daqui e ainda assim o motor recusar vira 400 na rota.
 */

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe uma data válida.')
  .refine((value) => {
    try {
      formatDateBR(value);
      return true;
    } catch {
      return false;
    }
  }, 'Informe uma data válida.');

const nonNegativeCents = (message: string) =>
  z.custom<Cents>(
    (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
    message,
  );

const bpSchema = (min: number, max: number, message: string) =>
  z.custom<BasisPoints>(
    (value) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max,
    message,
  );

export const planBodySchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao plano.').max(80),
  desiredMonthlyIncomeCents: nonNegativeCents('Informe a renda mensal desejada (zero ou mais).'),
  currentPortfolioCents: nonNegativeCents('O patrimônio atual não pode ser negativo.'),
  currentMonthlyContributionCents: nonNegativeCents('O aporte mensal não pode ser negativo.'),
  inflationBp: bpSchema(0, 10_000, 'Informe a inflação entre 0 % e 100 %.'),
  incomeTaxBp: bpSchema(0, 10_000, 'Informe o imposto entre 0 % e 100 %.'),
  targetDate: isoDateSchema.nullable(),
});

export const scenarioBodySchema = z.object({
  label: z.enum(['conservative', 'moderate', 'optimistic']),
  realReturnBp: bpSchema(-9_999, 10_000, 'O retorno real precisa ficar acima de -100 % e até 100 % ao ano.'),
  withdrawalBp: bpSchema(1, 10_000, 'A taxa de retirada precisa ser maior que 0 % e até 100 % ao ano.'),
});

/** `PUT`: o plano inteiro e os três cenários, cada rótulo uma vez. */
export const planUpdateBodySchema = planBodySchema.extend({
  scenarios: z
    .array(scenarioBodySchema)
    .length(3, 'Envie os três cenários.')
    .refine(
      (scenarios) => new Set(scenarios.map((scenario) => scenario.label)).size === 3,
      'Cada cenário (conservador, médio, otimista) deve aparecer uma vez.',
    ),
});

export type PlanBody = z.infer<typeof planBodySchema>;
export type PlanUpdateBody = z.infer<typeof planUpdateBodySchema>;
