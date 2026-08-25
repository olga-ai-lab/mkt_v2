-- =====================================================================
-- 0008_rls_processed_events.sql
--
-- Correcao de uma falha real, encontrada no advisor do Supabase depois de
-- 0005 ja estar aplicada em banco: mkt.processed_events ficou com RLS
-- DESLIGADA. No Supabase isso significa que qualquer um com a anon key le e
-- escreve a tabela inteira.
--
-- A causa foi de omissao, nao de design: processed_events nao tem org_id
-- (e um ledger de deduplicacao por consumidor, nao um dado de tenant), entao
-- nao passou pelo helper mkt.enable_org_rls() por onde toda tabela tenant-owned
-- passa — e ninguem ligou a RLS na mao.
--
-- A licao ficou no teste, nao so aqui: packages/db/test/rls.test.mjs agora
-- falha se QUALQUER tabela do schema estiver com relrowsecurity = false.
-- Sem org_id nunca mais implica sem RLS.
--
-- 0005 tambem foi corrigida, para que uma instalacao nova ja nasca certa.
-- Esta migration existe para os bancos que aplicaram 0005 antes da correcao.
-- `enable row level security` e idempotente: em banco novo isto e um no-op.
-- =====================================================================

alter table mkt.processed_events enable row level security;

comment on table mkt.processed_events is
  'Ledger de deduplicacao por consumidor. Sem org_id de proposito. RLS ligada sem policy: so service_role (BYPASSRLS) alcanca.';
