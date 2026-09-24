import { z } from 'zod';

/**
 * Fronteira de validacao das premissas globais (CONVENTIONS §6).
 *
 * `budgetWarnBp` chega em **basis points**, nao percentual: 8000 = 80,00 %. A
 * tela converte o percentual digitado antes de enviar; o schema recusa o que
 * estiver fora da faixa util.
 */
export const settingsBodySchema = z.object({
  emergencyFundMonths: z.number().int().min(1).max(60),
  budgetWarnBp: z.number().int().min(1000).max(10000),
  projectionMonths: z.number().int().min(1).max(60),
  commitmentMonths: z.number().int().min(1).max(60),
});

export type SettingsBody = z.infer<typeof settingsBodySchema>;
