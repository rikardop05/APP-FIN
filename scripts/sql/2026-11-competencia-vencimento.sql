-- 2026-11-competencia-vencimento.sql
-- SCRIPT MANUAL, NAO APLICADO. Nao faz parte de drizzle/ (nao e migration de schema).
--
-- Decisao do Ricardo (2026-11-09): a competencia da fatura de cartao e o MES DO VENCIMENTO.
-- Muda so cartao com dueDay <= closingDay (vence no mes seguinte ao fechamento). Hoje: Itau Click
-- (fecha 30, vence 7; id 9a2be606-7acf-4c09-a3d0-9faab1deeaad). Nu, MP, Nubank CROMA e SANTANDER
-- (dueDay > closingDay) nao mudam.
--
-- Aplicar NA MESMA JANELA do deploy do codigo novo (feature/competencia-mes-vencimento).
-- Entre o deploy e este script, o aviso de vencimento (due-date-check) acende para o Itau.
-- Faca backup antes (scripts/backup.ts ou pg_dump do branch production).
--
-- O script e IDEMPOTENTE: reexecutar nao desloca nada (passos 1 e 2 so tocam o que ainda esta na regra
-- antiga) e o bloco de validacao aceita "ja corrigido". Qualquer divergencia ABORTA (RAISE EXCEPTION),
-- e a transacao nao chega ao COMMIT.
--
-- NOTA SOBRE A FAMILIA B (removida): havia um PASSO 3 que somava 1 mes a `competence` das linhas manuais/
-- previstas do Itau (sem statement_id e sem installment_plan_id), geradas pela regra antiga. O diagnostico
-- real (Orquestrador, 2026-11-09, ver .notas/diagnostico-itau-competencia.md) deu ZERO linhas nessa familia:
-- as 3 linhas do Itau sao todas familia A (ligadas a fatura/plano importado; competencia ja declarada pelo
-- usuario na regra nova, errado so o cash_date). O passo foi removido porque nao era idempotente: uma
-- linha criada pelo app novo entre o diagnostico e a aplicacao seria empurrada +1 mes indevidamente, e
-- reexecutar deslocaria de novo. Se o diagnostico da janela do deploy mostrar linha familia B, NAO use
-- este script as cegas: trate-a a parte (ou regere a previsao pelo replan do app).

-- =====================================================================================
-- PASSO 0 - DIAGNOSTICO (somente leitura; rodar fora da transacao antes de aplicar)
-- =====================================================================================
SELECT s.id, s.period, s.closing_date, s.due_date, s.status
FROM statements s
WHERE s.credit_card_id = '9a2be606-7acf-4c09-a3d0-9faab1deeaad';

SELECT t.id, t.occurred_on, t.competence, t.cash_date, t.status, t.statement_id,
       t.installment_plan_id, t.installment_number, left(t.description, 40) AS descricao,
       CASE WHEN t.statement_id IS NOT NULL OR t.installment_plan_id IS NOT NULL THEN 'A' ELSE 'B' END AS familia
FROM transactions t
WHERE t.credit_card_id = '9a2be606-7acf-4c09-a3d0-9faab1deeaad'
ORDER BY t.occurred_on;

-- Linhas com cash_date fora do mes da competencia, por cartao. Antes: so o Itau. Depois: vazio.
SELECT c.name, count(*) AS linhas_fora_do_mes
FROM transactions t JOIN credit_cards c ON c.id = t.credit_card_id
WHERE t.cash_date IS NOT NULL AND to_char(t.cash_date, 'YYYY-MM') <> t.competence
GROUP BY c.name;

-- =====================================================================================
-- CORRECAO (uma transacao so)
-- =====================================================================================
BEGIN;

-- PASSO 1 - a fatura: periodo 2026-11 fica; datas passam a fechamento 30/10 e vencimento 07/11.
-- Idempotente: so toca se alguma das duas datas ainda difere (reexecucao afeta 0 linhas).
UPDATE statements
   SET closing_date = DATE '2026-10-30',
       due_date     = DATE '2026-11-07'
 WHERE credit_card_id = '9a2be606-7acf-4c09-a3d0-9faab1deeaad'
   AND period = '2026-11'
   AND (closing_date <> DATE '2026-10-30' OR due_date <> DATE '2026-11-07');

-- PASSO 2 - familia A: a competencia fica; cash_date = dia 7 do mes da PROPRIA competencia
-- (parcelas filhas de 2026-12, 2027-01, ... incluidas; dia 7 existe em todo mes, sem clamp).
-- Idempotente e limitado: so linhas ligadas a fatura/plano cujo cash_date ainda esta fora do mes.
UPDATE transactions
   SET cash_date = (competence || '-07')::date
 WHERE credit_card_id = '9a2be606-7acf-4c09-a3d0-9faab1deeaad'
   AND (statement_id IS NOT NULL OR installment_plan_id IS NOT NULL)
   AND cash_date IS NOT NULL
   AND to_char(cash_date, 'YYYY-MM') <> competence;

-- VALIDACAO: qualquer falha aborta a transacao (nao chega ao COMMIT).
DO $$
DECLARE
  n integer;
BEGIN
  -- (a) a fatura 2026-11 do Itau existe uma vez e esta nas datas novas (corrigida agora ou ja corrigida).
  SELECT count(*) INTO n
    FROM statements
   WHERE credit_card_id = '9a2be606-7acf-4c09-a3d0-9faab1deeaad'
     AND period = '2026-11'
     AND closing_date = DATE '2026-10-30'
     AND due_date     = DATE '2026-11-07';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Passo 1: esperava 1 fatura 2026-11 do Itau em 2026-10-30/2026-11-07, achei % (fatura inexistente ou em outras datas).', n;
  END IF;

  -- (b) nenhuma fatura do Itau com vencimento fora do mes do period.
  SELECT count(*) INTO n
    FROM statements
   WHERE credit_card_id = '9a2be606-7acf-4c09-a3d0-9faab1deeaad'
     AND to_char(due_date, 'YYYY-MM') <> period;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Validacao: % fatura(s) do Itau com due_date fora do mes do period.', n;
  END IF;

  -- (c) nenhum lancamento do Itau com cash_date fora do mes da competencia (qualquer familia).
  SELECT count(*) INTO n
    FROM transactions
   WHERE credit_card_id = '9a2be606-7acf-4c09-a3d0-9faab1deeaad'
     AND cash_date IS NOT NULL
     AND to_char(cash_date, 'YYYY-MM') <> competence;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Validacao: % lancamento(s) do Itau com cash_date fora do mes da competencia (linha familia B? ver nota no topo).', n;
  END IF;
END
$$;

COMMIT;   -- so e alcancado se o bloco DO acima passou; senao a sessao fica em transacao abortada: ROLLBACK;
