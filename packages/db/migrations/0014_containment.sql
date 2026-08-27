-- =====================================================================
-- 0014_containment.sql  |  Conter um incidente sem esperar um deploy.
--
-- ── O que a Mestra pede ─────────────────────────────────────────────────
--
-- §34: "conter com feature flag / capability disable / rollback".
-- §46: "feature flag e caminho de rollback" e pre-requisito do primeiro piloto.
-- §B:  uma falha S3 — seguranca, cross-tenant, acao indevida — pede "disable
--      imediato".
--
-- O AGT-MKT-COPILOT esta ACTIVE desde a 0009 sem nada disso.
--
-- ── Por que NAO entra uma tabela de feature flags ───────────────────────
--
-- Porque o mecanismo ja existe e se chama policy. Ela e avaliada
-- deterministicamente, e escopada por capability, agente, canal e risco, tem
-- prioridade, e "policy so restringe" e invariante de codigo. Uma tabela de
-- flags ao lado seria um SEGUNDO lugar capaz de bloquear a mesma coisa — e
-- "formula duplicada em varios lugares" e anti-pattern que bloqueia aprovacao
-- (Mestra §47).
--
-- Faltavam tres coisas para a policy servir de kill switch, e sao elas que
-- entram aqui.
--
-- ── 1. Desligar TODA escrita numa linha so ──────────────────────────────
--
-- O escopo nao tinha `mode`. Conter escrita exigia uma policy por capability, e
-- listar uma a uma durante um incidente e como se esquece uma — e a que se
-- esquece e a que continua publicando. Agora `{"mode":"write"}` cobre todas.
--
-- ── 2. Saber quem desligou, quando e por que ────────────────────────────
--
-- Uma policy de contencao sem autor e sem motivo vira, duas semanas depois,
-- uma linha que ninguem sabe se pode remover. Entao ela ganha autor, motivo e
-- hora — e um indice que responde "o que esta contido agora".
--
-- ── 3. Rollback de agente, que estava quebrado ──────────────────────────
--
-- `getAgent` fazia `order by version desc limit 1`: a MAIOR versao, qualquer
-- que fosse o status. Voltar para a ultima ACTIVE — que e o rollback que o
-- AGT-BASE §05 descreve — nao funcionava: a v2 DEPRECATED continuaria sendo
-- servida sobre a v1 ACTIVE.
--
-- A correcao mora no codigo (a porta passou a preferir ACTIVE), e o indice
-- abaixo e o que torna "a ACTIVE" uma pergunta com UMA resposta. model_routing
-- ja tinha o dele desde a 0007; agent_registry e capability_registry nao.
--
-- ── Para reverter ───────────────────────────────────────────────────────
--
--   drop index mkt.agent_registry_one_active, mkt.capability_registry_one_active;
--   alter table mkt.rule_policies
--     drop column created_by, drop column reason, drop column expires_at;
-- =====================================================================

alter table mkt.rule_policies
  add column created_by text,
  add column reason     text,
  add column expires_at timestamptz;

comment on column mkt.rule_policies.reason is
  'Por que esta policy existe. Obrigatorio na pratica para policy de contencao: uma linha que bloqueia sem dizer por que vira, duas semanas depois, uma linha que ninguem sabe se pode remover.';

comment on column mkt.rule_policies.expires_at is
  'Quando a contencao deixa de valer, se for temporaria. NAO e aplicado automaticamente: o runtime nao apaga policy sozinho, porque uma contencao que some por conta propria e uma contencao em que ninguem confia. Serve para a tela e o runbook cobrarem a revisao.';

-- O que esta contido agora, respondido por um indice e nao por um scan.
create index rule_policies_contencao
  on mkt.rule_policies (org_id, created_at desc)
  where status = 'ACTIVE' and effect = 'BLOCK' and created_by is not null;

-- ---------------------------------------------------------------------
-- Uma so versao ACTIVE por agente e por capability.
--
-- Sem isto, "a versao ACTIVE" e uma pergunta com duas respostas possiveis, e
-- quem escolhe passa a ser o `order by` de quem escreveu a consulta.
-- ---------------------------------------------------------------------
create unique index agent_registry_one_active
  on mkt.agent_registry (agent_id) where status = 'ACTIVE';

create unique index capability_registry_one_active
  on mkt.capability_registry (capability_id) where status = 'ACTIVE';

do $$
declare n integer;
begin
  select count(*) into n from pg_indexes
   where schemaname = 'mkt'
     and indexname in ('agent_registry_one_active','capability_registry_one_active',
                       'rule_policies_contencao');
  if n <> 3 then
    raise exception 'os indices de contencao nao ficaram todos criados (%)', n;
  end if;
end $$;
