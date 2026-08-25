-- =====================================================================
-- 0005_runtime_events.sql  |  Runs de agente, workflows, outbox e eventos.
-- Custo por run instrumentado desde a Fase 1 (achado G12 do MKT-17).
-- =====================================================================

create type mkt.run_status as enum ('RUNNING','SUCCEEDED','FAILED','BLOCKED','CANCELLED');

create table mkt.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt.workspaces(id) on delete cascade,
  trace_id       text not null,
  agent_id       text not null,
  agent_version  integer not null,
  task_class     text,
  model          text,
  prompt_version text,
  respondability text,
  reason_codes   text[] not null default '{}',
  autonomy_used  text check (autonomy_used in ('A0','A1','A2','A3','A4')),
  status         mkt.run_status not null default 'RUNNING',
  input_tokens   integer,
  output_tokens  integer,
  cost_cents     numeric(12,4),
  latency_ms     integer,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create table mkt.workflow_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt.workspaces(id) on delete cascade,
  workflow_id    text not null,
  external_run_id text,
  trace_id       text not null,
  current_state  text not null,
  attempts       integer not null default 0,
  dead_lettered  boolean not null default false,
  last_reason_code text,
  started_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Outbox transacional: mudanca de estado e intencao de evento no mesmo commit.
create table mkt.outbox (
  id             bigserial primary key,
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id   uuid,
  event_type     text not null,
  payload        jsonb not null,
  trace_id       text,
  occurred_at    timestamptz not null default now(),
  published_at   timestamptz,
  attempts       integer not null default 0
);
create index outbox_unpublished on mkt.outbox (id) where published_at is null;

create table mkt.marketing_events (
  id             bigserial primary key,
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id   uuid,
  event_type     text not null,
  event_version  integer not null default 1,
  actor_type     mkt.actor_type,
  object_type    text,
  object_id      uuid,
  channel        mkt.channel,
  properties     jsonb not null default '{}'::jsonb,
  trace_id       text,
  occurred_at    timestamptz not null,   -- quando o fato ocorreu na origem
  recorded_at    timestamptz not null default now()  -- quando a Olga persistiu
);
create index on mkt.marketing_events (org_id, event_type, occurred_at desc);

-- Dedup de consumidores: um consumer nunca processa o mesmo evento duas vezes.
create table mkt.processed_events (
  consumer        text not null,
  event_key       text not null,
  processed_at    timestamptz not null default now(),
  primary key (consumer, event_key)
);

create index on mkt.agent_runs (org_id, started_at desc);
create index on mkt.agent_runs (trace_id);
create index on mkt.workflow_runs (trace_id);
create index on mkt.workflow_runs (dead_lettered) where dead_lettered = true;

select mkt.enable_org_rls('mkt.agent_runs');
select mkt.enable_org_rls('mkt.workflow_runs');
select mkt.enable_org_rls('mkt.outbox');
select mkt.enable_org_rls('mkt.marketing_events');
