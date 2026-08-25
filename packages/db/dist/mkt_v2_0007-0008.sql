-- =====================================================================
-- Olga Marketing OS — schema mkt_v2
--
-- Bundle das 2 migrations, geradas a partir de packages/db/migrations/.
-- NAO EDITAR: regenere com  MKT_SCHEMA=mkt_v2 node packages/db/scripts/bundle.mjs
--
-- Aplicar: cole no SQL Editor do Supabase e execute uma vez.
-- Tudo roda numa transacao: ou entra inteiro, ou nao entra nada.
--
-- Reverter:  drop schema mkt_v2 cascade;
-- =====================================================================

begin;

-- ─── 0007_model_routing_budget.sql ───────────────────────────────

-- =====================================================================
-- 0007_model_routing_budget.sql  |  Model Gateway como dado governado.
--
-- MKT-09B §8 exige: rota por task class, fallback explicito, budget por
-- workspace, e model profile versionado e promovido como configuracao.
-- Nada disso pode viver em if/else no codigo.
--
-- Fecha a parte de instrumentacao do achado G12 do MKT-17 (ausencia de unit
-- economics): a partir daqui todo centavo gasto tem workspace, trace e classe.
-- =====================================================================

create type mkt_v2.task_class as enum (
  'reasoning','extraction','classification','copywriting','vision','image_generation','embedding'
);

-- ---------------------------------------------------------------------
-- Rota por classe de tarefa. Uma linha ACTIVE por task_class.
-- ---------------------------------------------------------------------
create table mkt_v2.model_routing (
  task_class     mkt_v2.task_class not null,
  version        integer not null,
  status         mkt_v2.lifecycle_status not null default 'CANDIDATE',
  primary_target jsonb not null,   -- {provider, model, price:{input_cents_per_mtok, output_cents_per_mtok}}
  fallback       jsonb not null default '[]'::jsonb,
  max_cost_cents numeric(12,4),
  timeout_ms     integer not null default 60000,
  data_policy    text,             -- restricao de dado que a rota respeita (ex: sem PII)
  owner          text,
  created_at     timestamptz not null default now(),
  primary key (task_class, version),
  constraint primary_target_shape check (
    primary_target ? 'provider' and primary_target ? 'model'
  )
);

-- Uma rota ACTIVE por classe: ambiguidade aqui vira roteamento imprevisivel.
create unique index model_routing_one_active
  on mkt_v2.model_routing (task_class) where status = 'ACTIVE';

alter table mkt_v2.model_routing enable row level security;
create policy model_routing_read on mkt_v2.model_routing for select using (true);

-- ---------------------------------------------------------------------
-- Orcamento por workspace e periodo. Sem linha aqui, o gateway recusa rodar
-- (BUDGET_NOT_CONFIGURED) em vez de gastar as cegas.
-- ---------------------------------------------------------------------
create table mkt_v2.workspace_budgets (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id  uuid not null references mkt_v2.workspaces(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  limit_cents   numeric(12,2) not null check (limit_cents >= 0),
  created_at    timestamptz not null default now(),
  unique (workspace_id, period_start),
  constraint periodo_coerente check (period_end > period_start)
);

-- Ledger append-only do que foi gasto. E a fonte do custo por workspace.
create table mkt_v2.model_spend (
  id           bigserial primary key,
  org_id       uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id uuid not null references mkt_v2.workspaces(id) on delete cascade,
  task_class   mkt_v2.task_class not null,
  provider     text,
  model        text,
  cost_cents   numeric(12,4) not null check (cost_cents >= 0),
  input_tokens  integer,
  output_tokens integer,
  fallback_used boolean not null default false,
  trace_id     text not null,
  agent_run_id uuid,
  occurred_at  timestamptz not null default now()
);
create index on mkt_v2.model_spend (workspace_id, occurred_at desc);
create index on mkt_v2.model_spend (trace_id);

select mkt_v2.enable_org_rls('mkt_v2.workspace_budgets');

-- Ledger e append-only para a aplicacao: gasto registrado nao se apaga.
alter table mkt_v2.model_spend enable row level security;
alter table mkt_v2.model_spend force row level security;
create policy spend_read on mkt_v2.model_spend for select
  using (mkt_v2.is_member_of_org(org_id));
create policy spend_append on mkt_v2.model_spend for insert
  with check (mkt_v2.is_member_of_org(org_id));

-- ---------------------------------------------------------------------
-- Saldo do periodo corrente. NULL = sem orcamento configurado, que e
-- diferente de zero: um bloqueia por falta de teto, o outro por teto atingido.
-- ---------------------------------------------------------------------
create or replace function mkt_v2.remaining_budget_cents(p_workspace uuid, p_at date default current_date)
returns numeric
language sql stable security definer set search_path = mkt_v2, pg_temp
as $$
  select b.limit_cents - coalesce((
    select sum(s.cost_cents) from mkt_v2.model_spend s
    where s.workspace_id = p_workspace
      and s.occurred_at >= b.period_start
      and s.occurred_at <  b.period_end
  ), 0)
  from mkt_v2.workspace_budgets b
  where b.workspace_id = p_workspace
    and p_at >= b.period_start and p_at < b.period_end
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Rotas iniciais. Precos em centavos por 1M de tokens; ajuste conforme o
-- contrato com cada provider — sao dado, nao constante de codigo.
-- ---------------------------------------------------------------------
insert into mkt_v2.model_routing
 (task_class, version, status, primary_target, fallback, max_cost_cents, timeout_ms, data_policy, owner)
values
 ('reasoning', 1, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-sonnet","price":{"input_cents_per_mtok":300,"output_cents_per_mtok":1500}}'::jsonb,
  '[]'::jsonb, 15, 60000, 'sem PII no prompt', 'AI Platform'),

 ('extraction', 1, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-haiku","price":{"input_cents_per_mtok":80,"output_cents_per_mtok":400}}'::jsonb,
  '[]'::jsonb, 30, 90000, 'conteudo publico do site do cliente', 'Brand'),

 ('classification', 1, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-haiku","price":{"input_cents_per_mtok":80,"output_cents_per_mtok":400}}'::jsonb,
  '[]'::jsonb, 10, 30000, 'sem PII', 'Compliance'),

 ('copywriting', 1, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-sonnet","price":{"input_cents_per_mtok":300,"output_cents_per_mtok":1500}}'::jsonb,
  '[]'::jsonb, 40, 90000, 'sem PII no prompt', 'Content'),

 ('vision', 1, 'CANDIDATE',
  '{"provider":"anthropic","model":"claude-sonnet","price":{"input_cents_per_mtok":300,"output_cents_per_mtok":1500}}'::jsonb,
  '[]'::jsonb, 50, 90000, 'foto enviada pelo cliente', 'Content'),

 ('image_generation', 1, 'CANDIDATE',
  '{"provider":"none","model":"none","price":{"input_cents_per_mtok":0,"output_cents_per_mtok":0}}'::jsonb,
  '[]'::jsonb, 0, 120000,
  'BLOQUEADO ate a Fase 3: e o maior custo unitario do produto (MKT-17, achado G12)', 'Content'),

 ('embedding', 1, 'CANDIDATE',
  '{"provider":"none","model":"none","price":{"input_cents_per_mtok":0,"output_cents_per_mtok":0}}'::jsonb,
  '[]'::jsonb, 0, 30000, 'entra com retrieval, na Fase 3', 'AI Platform');

comment on table mkt_v2.model_routing is
  'Fallback vazio de proposito no MVP: um segundo provider so entra depois de decidido o que fazer quando os dois discordam numa decisao material.';


-- ─── 0008_rls_processed_events.sql ───────────────────────────────

-- =====================================================================
-- 0008_rls_processed_events.sql
--
-- Correcao de uma falha real, encontrada no advisor do Supabase depois de
-- 0005 ja estar aplicada em banco: mkt_v2.processed_events ficou com RLS
-- DESLIGADA. No Supabase isso significa que qualquer um com a anon key le e
-- escreve a tabela inteira.
--
-- A causa foi de omissao, nao de design: processed_events nao tem org_id
-- (e um ledger de deduplicacao por consumidor, nao um dado de tenant), entao
-- nao passou pelo helper mkt_v2.enable_org_rls() por onde toda tabela tenant-owned
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

alter table mkt_v2.processed_events enable row level security;

comment on table mkt_v2.processed_events is
  'Ledger de deduplicacao por consumidor. Sem org_id de proposito. RLS ligada sem policy: so service_role (BYPASSRLS) alcanca.';


-- Controle de versao das migrations, para o runner reconhecer o que ja rodou.
create table if not exists mkt_v2.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Nenhuma tabela do schema fica alcancavel pela anon key, nem o ledger do runner.
alter table mkt_v2.schema_migrations enable row level security;
insert into mkt_v2.schema_migrations (name) values
  ('0007_model_routing_budget.sql'),
  ('0008_rls_processed_events.sql')
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = 'mkt_v2';
--   select capability_id, status from mkt_v2.capability_registry order by 1;
