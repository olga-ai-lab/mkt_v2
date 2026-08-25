-- =====================================================================
-- 0004_governance.sql  |  Registries, policy, aprovacoes, auditoria e receipts.
-- Fecha o G7: capability e policy viram DADO tipado, nao codigo nem prompt.
-- =====================================================================

create type mkt.capability_mode as enum ('read','simulate','write');
create type mkt.side_effect as enum ('none','internal','external');
create type mkt.policy_effect as enum ('ALLOW','REQUIRE_APPROVAL','BLOCK');
create type mkt.approval_decision as enum ('PENDING','APPROVED','REJECTED','EXPIRED');
create type mkt.receipt_status as enum ('EFFECTED','DEDUPLICATED','FAILED');

-- Registries sao globais da plataforma (nao tenant-owned): leitura para todos
-- os autenticados, escrita apenas por service_role / migracao.
create table mkt.capability_registry (
  capability_id    text not null,
  version          integer not null,
  status           mkt.lifecycle_status not null default 'CANDIDATE',
  mode             mkt.capability_mode not null,
  side_effect      mkt.side_effect not null,
  risk_tier        mkt.risk_tier not null,
  input_schema_ref text not null,
  output_schema_ref text not null,
  error_codes      text[] not null default '{}',
  permissions      mkt.member_role[] not null,
  idempotency_required boolean not null default false,
  idempotency_key_template text,
  provider_adapter text,
  timeout_ms       integer not null default 30000,
  max_attempts     integer not null default 3,
  owner            text,
  created_at       timestamptz not null default now(),
  primary key (capability_id, version),
  -- Regra do MKT-09B §10 gravada como constraint.
  constraint external_requires_idempotency check (
    side_effect <> 'external'
    or (idempotency_required = true and idempotency_key_template is not null)
  )
);

create table mkt.agent_registry (
  agent_id          text not null,
  version           integer not null,
  status            mkt.lifecycle_status not null default 'CANDIDATE',
  mission           text not null,
  modes             mkt.capability_mode[] not null,
  baseline_autonomy text not null check (baseline_autonomy in ('A0','A1','A2','A3','A4')),
  max_autonomy      text not null check (max_autonomy in ('A0','A1','A2','A3','A4')),
  capabilities      text[] not null default '{}',
  reason_codes      text[] not null default '{}',
  model_profile     jsonb not null default '{}'::jsonb,
  deviates_from_base text[] not null default '{}',
  owner             text,
  created_at        timestamptz not null default now(),
  primary key (agent_id, version)
);

create table mkt.rule_policies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references mkt.organizations(id) on delete cascade,
  policy_id     text not null,
  version       integer not null,
  status        mkt.lifecycle_status not null default 'CANDIDATE',
  priority      integer not null default 100,
  scope         jsonb not null default '{}'::jsonb,
  conditions    jsonb not null default '[]'::jsonb,
  effect        mkt.policy_effect not null,
  max_autonomy  text check (max_autonomy in ('A0','A1','A2','A3','A4')),
  reason_code   text,
  message_key   text,
  note          text,
  created_at    timestamptz not null default now(),
  unique (org_id, policy_id, version)
);
comment on table mkt.rule_policies is
  'org_id NULL = policy global de plataforma. Policy so restringe: nunca concede acima do teto de risco nem dos invariantes de codigo.';

create table mkt.approvals (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id       uuid not null references mkt.workspaces(id) on delete cascade,
  subject_type       text not null,
  subject_id         uuid not null,
  subject_version    integer not null,
  decision           mkt.approval_decision not null default 'PENDING',
  requested_reason_codes text[] not null default '{}',
  decided_by         uuid references mkt.app_users(id),
  decided_at         timestamptz,
  comment            text,
  trace_id           text,
  created_at         timestamptz not null default now()
);
comment on column mkt.approvals.subject_version is
  'A aprovacao e vinculada a versao. Nova versao exige nova aprovacao (MKT-04-05 §6.2).';

create table mkt.audit_events (
  id            bigserial primary key,
  org_id        uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id  uuid,
  actor_type    mkt.actor_type not null,
  actor_id      text,
  action        text not null,
  object_type   text not null,
  object_id     uuid,
  object_version integer,
  decision      text,
  reason_codes  text[] not null default '{}',
  trace_id      text,
  payload       jsonb not null default '{}'::jsonb,
  occurred_at   timestamptz not null default now()
);

create table mkt.action_receipts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id    uuid not null references mkt.workspaces(id) on delete cascade,
  capability_id   text not null,
  capability_version integer not null,
  idempotency_key text not null,
  request_hash    text,
  provider        text,
  external_id     text,
  status          mkt.receipt_status not null,
  autonomy_used   text not null check (autonomy_used in ('A0','A1','A2','A3','A4')),
  approval_id     uuid references mkt.approvals(id),
  trace_id        text not null,
  recorded_at     timestamptz not null default now(),
  unique (org_id, capability_id, idempotency_key)
);
comment on table mkt.action_receipts is
  'Sem receipt nao existe A3 nem A4. Um efeito material que nao produz receipt e um bug, nao uma otimizacao.';

create index on mkt.approvals (workspace_id, decision);
create index on mkt.audit_events (org_id, occurred_at desc);
create index on mkt.audit_events (trace_id);
create index on mkt.action_receipts (trace_id);

select mkt.enable_org_rls('mkt.approvals');

-- rule_policies: leitura por membro da org (ou global), escrita so por OWNER.
alter table mkt.rule_policies enable row level security;
alter table mkt.rule_policies force row level security;
create policy policy_read on mkt.rule_policies for select
  using (org_id is null or mkt.is_member_of_org(org_id));
create policy policy_write on mkt.rule_policies for all
  using (org_id is not null and mkt.has_role_in_org(org_id, array['OWNER']::mkt.member_role[]))
  with check (org_id is not null and mkt.has_role_in_org(org_id, array['OWNER']::mkt.member_role[]));

-- Registries de plataforma: leitura livre para autenticado, escrita so service_role.
alter table mkt.capability_registry enable row level security;
create policy capability_read on mkt.capability_registry for select using (true);
alter table mkt.agent_registry enable row level security;
create policy agent_read on mkt.agent_registry for select using (true);

-- ---------------------------------------------------------------------
-- Append-only para auditoria e receipts.
--
-- Implementado por AUSENCIA de policy de UPDATE/DELETE, nao por RULE.
-- RULE 'do instead nothing' reescreve tambem a consulta interna de integridade
-- referencial e quebra o ON DELETE CASCADE do org_id -- o teste de RLS pegou
-- exatamente isso. Com FORCE RLS e apenas policies de SELECT e INSERT, o papel
-- da aplicacao nao consegue alterar nem apagar o passado, e o cascade
-- administrativo continua funcionando.
-- ---------------------------------------------------------------------
alter table mkt.audit_events enable row level security;
alter table mkt.audit_events force row level security;
create policy audit_read on mkt.audit_events for select
  using (mkt.is_member_of_org(org_id));
create policy audit_append on mkt.audit_events for insert
  with check (mkt.is_member_of_org(org_id));
-- sem policy de update/delete: append-only por construcao.

alter table mkt.action_receipts enable row level security;
alter table mkt.action_receipts force row level security;
create policy receipt_read on mkt.action_receipts for select
  using (mkt.is_member_of_org(org_id));
create policy receipt_append on mkt.action_receipts for insert
  with check (mkt.is_member_of_org(org_id));
-- idem: um receipt emitido nunca e reescrito.
