-- =====================================================================
-- Olga Marketing OS — schema mkt_v2
--
-- Bundle das 13 migrations, geradas a partir de packages/db/migrations/.
-- NAO EDITAR: regenere com  MKT_SCHEMA=mkt_v2 node packages/db/scripts/bundle.mjs
--
-- Aplicar: cole no SQL Editor do Supabase e execute uma vez.
-- Tudo roda numa transacao: ou entra inteiro, ou nao entra nada.
--
-- Reverter:  drop schema mkt_v2 cascade;
-- =====================================================================

begin;

-- ─── 0001_iam.sql ────────────────────────────────────────────────

-- =====================================================================
-- 0001_iam.sql  |  Tenancy, RBAC e as funcoes que sustentam TODA a RLS.
-- Gate G0: dois tenants criados e leitura cruzada falhando no teste.
-- =====================================================================

create extension if not exists "pgcrypto";

create schema if not exists mkt_v2;

-- ---------------------------------------------------------------------
-- Identidade do ator. No Supabase isto e exatamente o que auth.uid() faz;
-- ler a claim direto mantem o schema portavel e testavel num Postgres local.
-- ---------------------------------------------------------------------
create or replace function mkt_v2.current_user_id() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create type mkt_v2.member_role as enum ('OWNER', 'MARKETING', 'APPROVER');
create type mkt_v2.member_status as enum ('ACTIVE', 'INVITED', 'SUSPENDED');
create type mkt_v2.lifecycle_status as enum ('DRAFT', 'CANDIDATE', 'ACTIVE', 'DEPRECATED', 'BLOCKED');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table mkt_v2.app_users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  full_name   text,
  created_at  timestamptz not null default now()
);

create table mkt_v2.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table mkt_v2.workspaces (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references mkt_v2.organizations(id) on delete cascade,
  name        text not null,
  timezone    text not null default 'America/Sao_Paulo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, name)
);

create table mkt_v2.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references mkt_v2.organizations(id) on delete cascade,
  user_id     uuid not null references mkt_v2.app_users(id) on delete cascade,
  role        mkt_v2.member_role not null,
  status      mkt_v2.member_status not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index on mkt_v2.workspaces (org_id);
create index on mkt_v2.memberships (user_id, status);

-- ---------------------------------------------------------------------
-- Predicados de acesso.
-- security definer para que a propria consulta de membership nao caia na RLS
-- (evita recursao). search_path fixo para nao ser sequestrado.
-- ---------------------------------------------------------------------
create or replace function mkt_v2.is_member_of_org(p_org uuid) returns boolean
language sql stable security definer set search_path = mkt_v2, pg_temp
as $$
  select exists (
    select 1 from mkt_v2.memberships m
    where m.org_id = p_org
      and m.user_id = mkt_v2.current_user_id()
      and m.status = 'ACTIVE'
  )
$$;

create or replace function mkt_v2.has_role_in_org(p_org uuid, p_roles mkt_v2.member_role[]) returns boolean
language sql stable security definer set search_path = mkt_v2, pg_temp
as $$
  select exists (
    select 1 from mkt_v2.memberships m
    where m.org_id = p_org
      and m.user_id = mkt_v2.current_user_id()
      and m.status = 'ACTIVE'
      and m.role = any(p_roles)
  )
$$;

create or replace function mkt_v2.org_of_workspace(p_workspace uuid) returns uuid
language sql stable security definer set search_path = mkt_v2, pg_temp
as $$ select w.org_id from mkt_v2.workspaces w where w.id = p_workspace $$;

create or replace function mkt_v2.can_access_workspace(p_workspace uuid) returns boolean
language sql stable security definer set search_path = mkt_v2, pg_temp
as $$ select mkt_v2.is_member_of_org(mkt_v2.org_of_workspace(p_workspace)) $$;

-- ---------------------------------------------------------------------
-- Helper de migracao: liga RLS e aplica a policy padrao de tenant.
-- Toda tabela tenant-owned criada nas migracoes seguintes passa por aqui.
-- ---------------------------------------------------------------------
create or replace function mkt_v2.enable_org_rls(p_table regclass) returns void
language plpgsql as $$
declare t text := p_table::text;
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);
  execute format($f$
    create policy tenant_read on %s for select
      using (mkt_v2.is_member_of_org(org_id))
  $f$, t);
  execute format($f$
    create policy tenant_write on %s for all
      using (mkt_v2.is_member_of_org(org_id))
      with check (mkt_v2.is_member_of_org(org_id))
  $f$, t);
end $$;

-- ---------------------------------------------------------------------
-- RLS das tabelas de IAM
-- ---------------------------------------------------------------------
alter table mkt_v2.organizations enable row level security;
alter table mkt_v2.organizations force row level security;
create policy org_member_read on mkt_v2.organizations for select
  using (mkt_v2.is_member_of_org(id));
create policy org_owner_write on mkt_v2.organizations for all
  using (mkt_v2.has_role_in_org(id, array['OWNER']::mkt_v2.member_role[]))
  with check (mkt_v2.has_role_in_org(id, array['OWNER']::mkt_v2.member_role[]));

select mkt_v2.enable_org_rls('mkt_v2.workspaces');

alter table mkt_v2.memberships enable row level security;
alter table mkt_v2.memberships force row level security;
create policy membership_read on mkt_v2.memberships for select
  using (mkt_v2.is_member_of_org(org_id));
create policy membership_admin on mkt_v2.memberships for all
  using (mkt_v2.has_role_in_org(org_id, array['OWNER']::mkt_v2.member_role[]))
  with check (mkt_v2.has_role_in_org(org_id, array['OWNER']::mkt_v2.member_role[]));

alter table mkt_v2.app_users enable row level security;
alter table mkt_v2.app_users force row level security;
-- Um usuario ve o proprio registro e o de quem divide organizacao com ele.
create policy user_self_read on mkt_v2.app_users for select
  using (
    id = mkt_v2.current_user_id()
    or exists (
      select 1 from mkt_v2.memberships m1
      join mkt_v2.memberships m2 on m1.org_id = m2.org_id
      where m1.user_id = mkt_v2.current_user_id() and m1.status = 'ACTIVE'
        and m2.user_id = mkt_v2.app_users.id and m2.status = 'ACTIVE'
    )
  );


-- ─── 0002_brand_content.sql ──────────────────────────────────────

-- =====================================================================
-- 0002_brand_content.sql  |  Brand Brain, conteudo versionado, evidence e claims.
-- Regra transversal (MKT-08 §5): org_id obrigatorio, status como enum,
-- versao imutavel apos ACTIVE, ator de criacao registrado.
-- =====================================================================

create type mkt_v2.content_state as enum (
  'DRAFT','AI_REVIEW','HUMAN_REVIEW','COMPLIANCE_REVIEW','APPROVED',
  'SCHEDULED','PUBLISHING','PUBLISHED','REJECTED','FAILED','CANCELLED'
);
create type mkt_v2.risk_tier as enum ('LOW','MEDIUM','HIGH');
create type mkt_v2.channel as enum ('INSTAGRAM','FACEBOOK','LINKEDIN','BLOG','EMAIL','WHATSAPP');
create type mkt_v2.actor_type as enum ('user','agent','system','provider');

create table mkt_v2.brands (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id uuid not null references mkt_v2.workspaces(id) on delete cascade,
  name         text not null,
  website_url  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table mkt_v2.brand_brain_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  brand_id       uuid not null references mkt_v2.brands(id) on delete cascade,
  version        integer not null,
  status         mkt_v2.lifecycle_status not null default 'CANDIDATE',
  identity       jsonb not null default '{}'::jsonb,
  tone           jsonb not null default '{}'::jsonb,
  claims_allowed jsonb not null default '[]'::jsonb,
  prohibitions   jsonb not null default '[]'::jsonb,
  disclaimers    jsonb not null default '[]'::jsonb,
  source_refs    jsonb not null default '[]'::jsonb,
  created_by_actor_type mkt_v2.actor_type not null default 'user',
  created_by_actor_id   text,
  created_at     timestamptz not null default now(),
  activated_at   timestamptz,
  unique (brand_id, version)
);

-- Apenas uma versao ACTIVE por marca.
create unique index brand_brain_one_active
  on mkt_v2.brand_brain_versions (brand_id) where status = 'ACTIVE';

create table mkt_v2.evidence (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id uuid not null references mkt_v2.workspaces(id) on delete cascade,
  source_kind  text not null check (source_kind in ('BRAND_BRAIN','SOURCE_ARTIFACT','UPLOADED_FILE','PROVIDER_RESPONSE','DOMAIN_RECORD')),
  locator      text not null,
  hash         text not null,
  fact         text,
  quality      text check (quality in ('HIGH','MEDIUM','LOW')),
  retrieved_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create table mkt_v2.contents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id uuid not null references mkt_v2.workspaces(id) on delete cascade,
  brand_id     uuid not null references mkt_v2.brands(id) on delete cascade,
  title        text not null,
  objective    text,
  created_by_actor_type mkt_v2.actor_type not null default 'user',
  created_by_actor_id   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table mkt_v2.content_versions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references mkt_v2.organizations(id) on delete cascade,
  content_id             uuid not null references mkt_v2.contents(id) on delete cascade,
  version                integer not null,
  state                  mkt_v2.content_state not null default 'DRAFT',
  risk_tier              mkt_v2.risk_tier not null default 'LOW',
  master_body            text not null,
  brand_brain_version_id uuid references mkt_v2.brand_brain_versions(id),
  agent_id               text,
  agent_version          integer,
  trace_id               text,
  created_by_actor_type  mkt_v2.actor_type not null default 'agent',
  created_by_actor_id    text,
  created_at             timestamptz not null default now(),
  approved_at            timestamptz,
  unique (content_id, version)
);

create table mkt_v2.channel_variants (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  content_version_id uuid not null references mkt_v2.content_versions(id) on delete cascade,
  channel            mkt_v2.channel not null,
  headline           text,
  body               text not null,
  cta                text,
  asset_refs         jsonb not null default '[]'::jsonb,
  char_count         integer,
  created_at         timestamptz not null default now(),
  unique (content_version_id, channel)
);

create table mkt_v2.claims (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  content_version_id uuid not null references mkt_v2.content_versions(id) on delete cascade,
  text               text not null,
  material           boolean not null default false,
  claim_type         text not null default 'GENERAL'
                     check (claim_type in ('COVERAGE','PRICE','DEADLINE','PERFORMANCE','GENERAL')),
  evidence_ids       uuid[] not null default '{}',
  created_at         timestamptz not null default now(),
  -- Regra dura: claim material sem evidence nao entra no banco.
  -- cardinality(), nao array_length(): array_length('{}',1) devolve NULL e um
  -- CHECK que resolve para NULL passa, deixando a constraint decorativa.
  constraint claim_material_requires_evidence
    check (material = false or cardinality(evidence_ids) >= 1)
);

create index on mkt_v2.brands (workspace_id);
create index on mkt_v2.contents (workspace_id, created_at desc);
create index on mkt_v2.content_versions (content_id, version desc);
create index on mkt_v2.content_versions (state);
create index on mkt_v2.channel_variants (content_version_id);

select mkt_v2.enable_org_rls('mkt_v2.brands');
select mkt_v2.enable_org_rls('mkt_v2.brand_brain_versions');
select mkt_v2.enable_org_rls('mkt_v2.evidence');
select mkt_v2.enable_org_rls('mkt_v2.contents');
select mkt_v2.enable_org_rls('mkt_v2.content_versions');
select mkt_v2.enable_org_rls('mkt_v2.channel_variants');
select mkt_v2.enable_org_rls('mkt_v2.claims');

-- ---------------------------------------------------------------------
-- State machine aplicada no banco. O agente nao consegue pular de DRAFT
-- para PUBLISHED nem por bug de aplicacao nem por SQL direto.
-- ---------------------------------------------------------------------
create or replace function mkt_v2.assert_content_transition() returns trigger
language plpgsql as $$
declare allowed text[];
begin
  if new.state = old.state then return new; end if;
  allowed := case old.state
    when 'DRAFT'             then array['AI_REVIEW','CANCELLED']
    when 'AI_REVIEW'         then array['HUMAN_REVIEW','COMPLIANCE_REVIEW','APPROVED','REJECTED','DRAFT']
    when 'HUMAN_REVIEW'      then array['COMPLIANCE_REVIEW','APPROVED','REJECTED','DRAFT']
    when 'COMPLIANCE_REVIEW' then array['APPROVED','REJECTED']
    when 'APPROVED'          then array['SCHEDULED','PUBLISHING','DRAFT','CANCELLED']
    when 'SCHEDULED'         then array['PUBLISHING','CANCELLED']
    when 'PUBLISHING'        then array['PUBLISHED','FAILED']
    when 'PUBLISHED'         then array[]::text[]
    when 'REJECTED'          then array['DRAFT']
    when 'FAILED'            then array['PUBLISHING','CANCELLED']
    when 'CANCELLED'         then array[]::text[]
  end;
  if not (new.state::text = any(allowed)) then
    raise exception 'INVALID_STATE_TRANSITION % -> %', old.state, new.state
      using errcode = 'check_violation';
  end if;
  if new.state = 'APPROVED' then new.approved_at := now(); end if;
  return new;
end $$;

create trigger content_version_state_guard
  before update of state on mkt_v2.content_versions
  for each row execute function mkt_v2.assert_content_transition();

-- Alteracao do corpo apos aprovacao invalida a aprovacao (MKT-04-05 §6.2).
create or replace function mkt_v2.invalidate_approval_on_edit() returns trigger
language plpgsql as $$
begin
  if new.master_body is distinct from old.master_body
     and old.state in ('APPROVED','SCHEDULED') then
    new.state := 'DRAFT';
    new.approved_at := null;
  end if;
  return new;
end $$;

create trigger content_version_edit_guard
  before update of master_body on mkt_v2.content_versions
  for each row execute function mkt_v2.invalidate_approval_on_edit();


-- ─── 0003_publishing.sql ─────────────────────────────────────────

-- =====================================================================
-- 0003_publishing.sql  |  Conexoes de canal, publicacoes e tentativas.
-- A idempotencia mora aqui, como constraint, nao como boa intencao.
-- =====================================================================

create type mkt_v2.connection_status as enum ('PENDING','ACTIVE','DEGRADED','REVOKED','EXPIRED');
create type mkt_v2.publication_status as enum ('SCHEDULED','PUBLISHING','PUBLISHED','FAILED','CANCELLED');
create type mkt_v2.attempt_status as enum ('STARTED','SUCCEEDED','FAILED','DEDUPLICATED');

create table mkt_v2.connections (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt_v2.workspaces(id) on delete cascade,
  channel        mkt_v2.channel not null,
  provider       text not null,
  external_account_id text not null,
  display_name   text,
  status         mkt_v2.connection_status not null default 'PENDING',
  -- Segredo NUNCA fica aqui. Guardamos a referencia; o adapter resolve no vault.
  secret_ref     text,
  scopes         text[] not null default '{}',
  expires_at     timestamptz,
  last_checked_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (workspace_id, channel, external_account_id)
);

comment on column mkt_v2.connections.secret_ref is
  'Referencia no secret manager (ADR-005). Token de provider nunca entra em prompt, evidence ou trace.';

create table mkt_v2.publications (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id       uuid not null references mkt_v2.workspaces(id) on delete cascade,
  content_version_id uuid not null references mkt_v2.content_versions(id) on delete cascade,
  channel_variant_id uuid not null references mkt_v2.channel_variants(id) on delete cascade,
  connection_id      uuid not null references mkt_v2.connections(id),
  channel            mkt_v2.channel not null,
  status             mkt_v2.publication_status not null default 'SCHEDULED',
  scheduled_at       timestamptz,
  published_at       timestamptz,
  external_id        text,
  approval_id        uuid,
  autonomy_used      text check (autonomy_used in ('A0','A1','A2','A3','A4')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table mkt_v2.publication_attempts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references mkt_v2.organizations(id) on delete cascade,
  publication_id  uuid not null references mkt_v2.publications(id) on delete cascade,
  attempt_number  integer not null,
  idempotency_key text not null,
  status          mkt_v2.attempt_status not null default 'STARTED',
  request_hash    text,
  provider_external_id text,
  reason_code     text,
  error_class     text check (error_class in ('TRANSIENT','PERMANENT','POLICY','VALIDATION')),
  trace_id        text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

-- ---------------------------------------------------------------------
-- O coracao do Gate G1: uma mesma idempotency_key nunca produz dois efeitos.
-- Replay do workflow encontra a linha e devolve DEDUPLICATED.
-- ---------------------------------------------------------------------
create unique index publication_attempt_idempotency
  on mkt_v2.publication_attempts (org_id, idempotency_key);

create index on mkt_v2.publications (workspace_id, status);
create index on mkt_v2.publications (scheduled_at) where status = 'SCHEDULED';
create index on mkt_v2.publication_attempts (publication_id, attempt_number);

select mkt_v2.enable_org_rls('mkt_v2.connections');
select mkt_v2.enable_org_rls('mkt_v2.publications');
select mkt_v2.enable_org_rls('mkt_v2.publication_attempts');


-- ─── 0004_governance.sql ─────────────────────────────────────────

-- =====================================================================
-- 0004_governance.sql  |  Registries, policy, aprovacoes, auditoria e receipts.
-- Fecha o G7: capability e policy viram DADO tipado, nao codigo nem prompt.
-- =====================================================================

create type mkt_v2.capability_mode as enum ('read','simulate','write');
create type mkt_v2.side_effect as enum ('none','internal','external');
create type mkt_v2.policy_effect as enum ('ALLOW','REQUIRE_APPROVAL','BLOCK');
create type mkt_v2.approval_decision as enum ('PENDING','APPROVED','REJECTED','EXPIRED');
create type mkt_v2.receipt_status as enum ('EFFECTED','DEDUPLICATED','FAILED');

-- Registries sao globais da plataforma (nao tenant-owned): leitura para todos
-- os autenticados, escrita apenas por service_role / migracao.
create table mkt_v2.capability_registry (
  capability_id    text not null,
  version          integer not null,
  status           mkt_v2.lifecycle_status not null default 'CANDIDATE',
  mode             mkt_v2.capability_mode not null,
  side_effect      mkt_v2.side_effect not null,
  risk_tier        mkt_v2.risk_tier not null,
  input_schema_ref text not null,
  output_schema_ref text not null,
  error_codes      text[] not null default '{}',
  permissions      mkt_v2.member_role[] not null,
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

create table mkt_v2.agent_registry (
  agent_id          text not null,
  version           integer not null,
  status            mkt_v2.lifecycle_status not null default 'CANDIDATE',
  mission           text not null,
  modes             mkt_v2.capability_mode[] not null,
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

create table mkt_v2.rule_policies (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references mkt_v2.organizations(id) on delete cascade,
  policy_id     text not null,
  version       integer not null,
  status        mkt_v2.lifecycle_status not null default 'CANDIDATE',
  priority      integer not null default 100,
  scope         jsonb not null default '{}'::jsonb,
  conditions    jsonb not null default '[]'::jsonb,
  effect        mkt_v2.policy_effect not null,
  max_autonomy  text check (max_autonomy in ('A0','A1','A2','A3','A4')),
  reason_code   text,
  message_key   text,
  note          text,
  created_at    timestamptz not null default now(),
  unique (org_id, policy_id, version)
);
comment on table mkt_v2.rule_policies is
  'org_id NULL = policy global de plataforma. Policy so restringe: nunca concede acima do teto de risco nem dos invariantes de codigo.';

create table mkt_v2.approvals (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id       uuid not null references mkt_v2.workspaces(id) on delete cascade,
  subject_type       text not null,
  subject_id         uuid not null,
  subject_version    integer not null,
  decision           mkt_v2.approval_decision not null default 'PENDING',
  requested_reason_codes text[] not null default '{}',
  decided_by         uuid references mkt_v2.app_users(id),
  decided_at         timestamptz,
  comment            text,
  trace_id           text,
  created_at         timestamptz not null default now()
);
comment on column mkt_v2.approvals.subject_version is
  'A aprovacao e vinculada a versao. Nova versao exige nova aprovacao (MKT-04-05 §6.2).';

create table mkt_v2.audit_events (
  id            bigserial primary key,
  org_id        uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id  uuid,
  actor_type    mkt_v2.actor_type not null,
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

create table mkt_v2.action_receipts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id    uuid not null references mkt_v2.workspaces(id) on delete cascade,
  capability_id   text not null,
  capability_version integer not null,
  idempotency_key text not null,
  request_hash    text,
  provider        text,
  external_id     text,
  status          mkt_v2.receipt_status not null,
  autonomy_used   text not null check (autonomy_used in ('A0','A1','A2','A3','A4')),
  approval_id     uuid references mkt_v2.approvals(id),
  trace_id        text not null,
  recorded_at     timestamptz not null default now(),
  unique (org_id, capability_id, idempotency_key)
);
comment on table mkt_v2.action_receipts is
  'Sem receipt nao existe A3 nem A4. Um efeito material que nao produz receipt e um bug, nao uma otimizacao.';

create index on mkt_v2.approvals (workspace_id, decision);
create index on mkt_v2.audit_events (org_id, occurred_at desc);
create index on mkt_v2.audit_events (trace_id);
create index on mkt_v2.action_receipts (trace_id);

select mkt_v2.enable_org_rls('mkt_v2.approvals');

-- rule_policies: leitura por membro da org (ou global), escrita so por OWNER.
alter table mkt_v2.rule_policies enable row level security;
alter table mkt_v2.rule_policies force row level security;
create policy policy_read on mkt_v2.rule_policies for select
  using (org_id is null or mkt_v2.is_member_of_org(org_id));
create policy policy_write on mkt_v2.rule_policies for all
  using (org_id is not null and mkt_v2.has_role_in_org(org_id, array['OWNER']::mkt_v2.member_role[]))
  with check (org_id is not null and mkt_v2.has_role_in_org(org_id, array['OWNER']::mkt_v2.member_role[]));

-- Registries de plataforma: leitura livre para autenticado, escrita so service_role.
alter table mkt_v2.capability_registry enable row level security;
create policy capability_read on mkt_v2.capability_registry for select using (true);
alter table mkt_v2.agent_registry enable row level security;
create policy agent_read on mkt_v2.agent_registry for select using (true);

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
alter table mkt_v2.audit_events enable row level security;
alter table mkt_v2.audit_events force row level security;
create policy audit_read on mkt_v2.audit_events for select
  using (mkt_v2.is_member_of_org(org_id));
create policy audit_append on mkt_v2.audit_events for insert
  with check (mkt_v2.is_member_of_org(org_id));
-- sem policy de update/delete: append-only por construcao.

alter table mkt_v2.action_receipts enable row level security;
alter table mkt_v2.action_receipts force row level security;
create policy receipt_read on mkt_v2.action_receipts for select
  using (mkt_v2.is_member_of_org(org_id));
create policy receipt_append on mkt_v2.action_receipts for insert
  with check (mkt_v2.is_member_of_org(org_id));
-- idem: um receipt emitido nunca e reescrito.


-- ─── 0005_runtime_events.sql ─────────────────────────────────────

-- =====================================================================
-- 0005_runtime_events.sql  |  Runs de agente, workflows, outbox e eventos.
-- Custo por run instrumentado desde a Fase 1 (achado G12 do MKT-17).
-- =====================================================================

create type mkt_v2.run_status as enum ('RUNNING','SUCCEEDED','FAILED','BLOCKED','CANCELLED');

create table mkt_v2.agent_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt_v2.workspaces(id) on delete cascade,
  trace_id       text not null,
  agent_id       text not null,
  agent_version  integer not null,
  task_class     text,
  model          text,
  prompt_version text,
  respondability text,
  reason_codes   text[] not null default '{}',
  autonomy_used  text check (autonomy_used in ('A0','A1','A2','A3','A4')),
  status         mkt_v2.run_status not null default 'RUNNING',
  input_tokens   integer,
  output_tokens  integer,
  cost_cents     numeric(12,4),
  latency_ms     integer,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

create table mkt_v2.workflow_runs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt_v2.workspaces(id) on delete cascade,
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
create table mkt_v2.outbox (
  id             bigserial primary key,
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id   uuid,
  event_type     text not null,
  payload        jsonb not null,
  trace_id       text,
  occurred_at    timestamptz not null default now(),
  published_at   timestamptz,
  attempts       integer not null default 0
);
create index outbox_unpublished on mkt_v2.outbox (id) where published_at is null;

create table mkt_v2.marketing_events (
  id             bigserial primary key,
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id   uuid,
  event_type     text not null,
  event_version  integer not null default 1,
  actor_type     mkt_v2.actor_type,
  object_type    text,
  object_id      uuid,
  channel        mkt_v2.channel,
  properties     jsonb not null default '{}'::jsonb,
  trace_id       text,
  occurred_at    timestamptz not null,   -- quando o fato ocorreu na origem
  recorded_at    timestamptz not null default now()  -- quando a Olga persistiu
);
create index on mkt_v2.marketing_events (org_id, event_type, occurred_at desc);

-- Dedup de consumidores: um consumer nunca processa o mesmo evento duas vezes.
create table mkt_v2.processed_events (
  consumer        text not null,
  event_key       text not null,
  processed_at    timestamptz not null default now(),
  primary key (consumer, event_key)
);

create index on mkt_v2.agent_runs (org_id, started_at desc);
create index on mkt_v2.agent_runs (trace_id);
create index on mkt_v2.workflow_runs (trace_id);
create index on mkt_v2.workflow_runs (dead_lettered) where dead_lettered = true;

select mkt_v2.enable_org_rls('mkt_v2.agent_runs');
select mkt_v2.enable_org_rls('mkt_v2.workflow_runs');
select mkt_v2.enable_org_rls('mkt_v2.outbox');
select mkt_v2.enable_org_rls('mkt_v2.marketing_events');

-- processed_events nao tem org_id de proposito: e um ledger de deduplicacao do
-- consumidor, nao um dado de tenant. Por isso nao passa por enable_org_rls().
--
-- Mas "sem org_id" nao pode virar "sem RLS": no Supabase toda tabela alcancavel
-- pelo PostgREST fica exposta a anon e authenticated quando a RLS esta desligada.
-- Ligamos a RLS SEM policy nenhuma. O efeito e o correto para esta tabela:
--   anon / authenticated -> zero linhas, zero escrita (nao ha policy que permita)
--   service_role         -> acesso total (tem BYPASSRLS)
-- Ou seja, so o worker escreve aqui, que e exatamente o contrato.
--
-- Nao usamos FORCE aqui, ao contrario das tabelas tenant-owned: FORCE tambem
-- valeria para o dono da tabela e, sem policy, trancaria ate a manutencao
-- administrativa. Sem FORCE o dono continua com saida de emergencia.
alter table mkt_v2.processed_events enable row level security;
comment on table mkt_v2.processed_events is
  'Ledger de deduplicacao por consumidor. Sem org_id de proposito. RLS ligada sem policy: so service_role (BYPASSRLS) alcanca.';


-- ─── 0006_seed_registries.sql ────────────────────────────────────

-- =====================================================================
-- 0006_seed_registries.sql  |  Capabilities, agentes e policies globais do MVP.
-- Dados, nao codigo. Alterar aqui e uma migracao, com revisao e rastro.
-- =====================================================================

insert into mkt_v2.capability_registry
 (capability_id, version, status, mode, side_effect, risk_tier, input_schema_ref, output_schema_ref,
  error_codes, permissions, idempotency_required, idempotency_key_template, provider_adapter, timeout_ms, max_attempts, owner)
values
 ('brand.read', 1, 'ACTIVE', 'read', 'none', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{}','{OWNER,MARKETING,APPROVER}', false, null, null, 10000, 2, 'AI Platform'),

 ('brand.extract_from_url', 1, 'ACTIVE', 'read', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{SOURCE_STALE,PROVIDER_UNAVAILABLE}','{OWNER,MARKETING}', false, null, 'web_fetch', 60000, 2, 'Brand'),

 ('brand.propose_version', 1, 'ACTIVE', 'write', 'internal', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{SCHEMA_VALIDATION_FAILED}','{OWNER,MARKETING}', false, null, null, 15000, 2, 'Brand'),

 ('evidence.read', 1, 'ACTIVE', 'read', 'none', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{}','{OWNER,MARKETING,APPROVER}', false, null, null, 10000, 2, 'AI Platform'),

 ('content.create_draft', 1, 'ACTIVE', 'write', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{EVIDENCE_INSUFFICIENT,CLAIM_UNSUPPORTED,BRAND_BRAIN_NOT_ACTIVE}','{OWNER,MARKETING}',
  false, null, null, 90000, 2, 'Content'),

 ('content.create_variant', 1, 'ACTIVE', 'write', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{CONTENT_DUPLICATE_RISK}','{OWNER,MARKETING}', false, null, null, 60000, 2, 'Content'),

 ('quality.precheck', 1, 'ACTIVE', 'simulate', 'none', 'LOW',
  'olga://io/capability-request','olga://io/validated-result',
  '{CLAIM_UNSUPPORTED,EVIDENCE_INSUFFICIENT,CONTENT_DUPLICATE_RISK}','{OWNER,MARKETING,APPROVER}',
  false, null, null, 20000, 2, 'Content'),

 ('compliance.review', 1, 'ACTIVE', 'simulate', 'none', 'HIGH',
  'olga://io/capability-request','olga://io/validated-result',
  '{COMPLIANCE_REVIEW_REQUIRED,CLAIM_UNSUPPORTED}','{OWNER,APPROVER}', false, null, null, 30000, 2, 'Compliance'),

 ('approval.request', 1, 'ACTIVE', 'write', 'internal', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{CONTENT_NOT_APPROVED}','{OWNER,MARKETING}', false, null, null, 10000, 2, 'Governance'),

 ('channel.connect', 1, 'ACTIVE', 'write', 'external', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{CHANNEL_NOT_CONNECTED,PROVIDER_UNAVAILABLE}','{OWNER}',
  true, '{workspace_id}:{channel}:{external_account_id}', 'meta_graph', 30000, 3, 'Publishing'),

 ('publishing.schedule', 1, 'ACTIVE', 'write', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{CONTENT_NOT_APPROVED,CHANNEL_NOT_CONNECTED}','{OWNER,MARKETING}', false, null, null, 10000, 2, 'Publishing'),

 ('publishing.publish', 1, 'ACTIVE', 'write', 'external', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{CHANNEL_NOT_CONNECTED,CONTENT_NOT_APPROVED,PROVIDER_RATE_LIMITED,DUPLICATE_OPERATION_PREVENTED,PROVIDER_UNAVAILABLE}',
  '{OWNER,MARKETING}', true,
  '{workspace_id}:{content_version_id}:{channel}:{connection_id}', 'meta_graph', 45000, 5, 'Publishing');

insert into mkt_v2.agent_registry
 (agent_id, version, status, mission, modes, baseline_autonomy, max_autonomy, capabilities, reason_codes, model_profile, deviates_from_base, owner)
values
 ('AGT-MKT-COPILOT', 1, 'CANDIDATE',
  'Interpretar pedidos, manter contexto, escolher o especialista correto e explicar o proximo passo.',
  '{read,simulate}', 'A1', 'A2',
  '{brand.read,evidence.read,quality.precheck}',
  '{AMBIGUOUS_GOAL,AMBIGUOUS_ENTITY,UNSUPPORTED_VALUE,TENANT_SCOPE_VIOLATION}',
  '{"task_class":"reasoning","max_cost_cents_per_run":8}', '{}', 'AI Platform'),

 ('AGT-MKT-BRAND', 1, 'CANDIDATE',
  'Construir o Brand Brain a partir do site e de revisao humana estruturada.',
  '{read,write}', 'A2', 'A2',
  '{brand.extract_from_url,brand.propose_version,brand.read}',
  '{SOURCE_STALE,EVIDENCE_INSUFFICIENT,BRAND_BRAIN_NOT_ACTIVE}',
  '{"task_class":"extraction","max_cost_cents_per_run":25}',
  '{"Promove versao apenas para CANDIDATE; a promocao para ACTIVE e sempre humana."}', 'Brand'),

 ('AGT-MKT-CONTENT', 1, 'CANDIDATE',
  'Criar master content e variantes por canal alinhadas a BrandBrain, evidence e objetivo.',
  '{read,write}', 'A2', 'A3',
  '{brand.read,evidence.read,content.create_draft,content.create_variant,quality.precheck,publishing.schedule}',
  '{CONTENT_DUPLICATE_RISK,CLAIM_UNSUPPORTED,EVIDENCE_INSUFFICIENT,COMPLIANCE_REVIEW_REQUIRED}',
  '{"task_class":"copywriting","max_cost_cents_per_run":40}',
  '{"Absorve INTEL, PLANNER e VISUAL como capabilities ate a Fase 3 (MKT-17 §5.6)."}', 'Content'),

 ('AGT-MKT-COMPLIANCE', 1, 'CANDIDATE',
  'Verificar claims contra o Brand Brain, a lista de proibicoes e os disclaimers por produto.',
  '{read,simulate}', 'A1', 'A2',
  '{brand.read,evidence.read,compliance.review}',
  '{COMPLIANCE_REVIEW_REQUIRED,CLAIM_UNSUPPORTED,EVIDENCE_INSUFFICIENT}',
  '{"task_class":"classification","max_cost_cents_per_run":10}', '{}', 'Compliance');

-- ---------------------------------------------------------------------
-- Policies globais (org_id NULL). Restringem; nunca concedem alem do teto.
-- ---------------------------------------------------------------------
insert into mkt_v2.rule_policies
 (org_id, policy_id, version, status, priority, scope, conditions, effect, max_autonomy, reason_code, message_key, note)
values
 (null, 'POL_BLOCK_UNCONNECTED_CHANNEL', 1, 'ACTIVE', 10,
  '{}'::jsonb,
  '[{"fact":"channel_connected","op":"is_false","value":true}]'::jsonb,
  'BLOCK', null, 'CHANNEL_NOT_CONNECTED', 'policy.channel_not_connected',
  'Sem conexao valida nao existe publicacao possivel.'),

 (null, 'POL_BLOCK_UNAPPROVED_CONTENT', 1, 'ACTIVE', 20,
  '{"capability_id":"publishing.publish"}'::jsonb,
  '[{"fact":"content_status","op":"not_in","value":["APPROVED","SCHEDULED","PUBLISHING"]}]'::jsonb,
  'BLOCK', null, 'CONTENT_NOT_APPROVED', 'policy.content_not_approved',
  'Conteudo nao aprovado nao vira efeito externo.'),

 (null, 'POL_COMPLIANCE_ON_MATERIAL_CLAIM', 1, 'ACTIVE', 30,
  '{}'::jsonb,
  '[{"fact":"claim_types","op":"contains_any","value":["COVERAGE","PRICE","DEADLINE"]}]'::jsonb,
  'REQUIRE_APPROVAL', 'A2', 'COMPLIANCE_REVIEW_REQUIRED', 'policy.compliance_required',
  'Claim de cobertura, preco ou prazo sempre passa por humano.'),

 (null, 'POL_FIRST_PUBLISH_NEEDS_HUMAN', 1, 'ACTIVE', 40,
  '{"capability_id":"publishing.publish"}'::jsonb,
  '[{"fact":"workspace_first_publish","op":"is_true","value":true}]'::jsonb,
  'REQUIRE_APPROVAL', 'A3', 'WORKSPACE_FIRST_PUBLISH', 'policy.first_publish',
  'A primeira publicacao de um workspace e sempre aprovada por uma pessoa.'),

 (null, 'POL_PUBLISH_SOCIAL_DEFAULT', 1, 'ACTIVE', 500,
  '{"capability_id":"publishing.publish"}'::jsonb,
  '[{"fact":"channel_connected","op":"is_true","value":true},
    {"fact":"content_status","op":"in","value":["APPROVED","SCHEDULED"]}]'::jsonb,
  'ALLOW', 'A3', null, 'policy.publish_allowed',
  'Default do MVP: publicar exige aprovacao por item (A3). A4 so apos o gate G3.'),

 (null, 'POL_DRAFT_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"content.create_draft"}'::jsonb,
  '[]'::jsonb,
  'ALLOW', 'A2', null, 'policy.draft_allowed',
  'Rascunho e sempre permitido ate A2: cria objeto em DRAFT, sem efeito externo.'),

 (null, 'POL_VARIANT_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"content.create_variant"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.draft_allowed', 'Idem para variantes por canal.'),

 (null, 'POL_SCHEDULE_DEFAULT', 1, 'ACTIVE', 550,
  '{"capability_id":"publishing.schedule"}'::jsonb,
  '[{"fact":"content_status","op":"in","value":["APPROVED"]}]'::jsonb,
  'ALLOW', 'A3', null, 'policy.schedule_allowed', 'Agendar conteudo ja aprovado.'),

 (null, 'POL_APPROVAL_REQUEST_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"approval.request"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.approval_request_allowed', 'Pedir revisao humana nunca e bloqueado.'),

 (null, 'POL_BRAND_PROPOSE_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"brand.propose_version"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.brand_propose_allowed',
  'O agente propoe versao CANDIDATE; promover para ACTIVE e ato humano.'),

 (null, 'POL_CHANNEL_CONNECT_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"channel.connect"}'::jsonb,
  '[]'::jsonb, 'REQUIRE_APPROVAL', 'A3', null, 'policy.channel_connect',
  'Conectar canal e ato do OWNER, sempre com confirmacao.');


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


-- ─── 0009_promote_copilot.sql ────────────────────────────────────

-- =====================================================================
-- 0009_promote_copilot.sql  |  Primeira promocao de agente para ACTIVE.
--
-- Promover um agente e ato de governanca, nao passo tecnico. Esta migration
-- existe para que a decisao fique no historico, com o motivo junto — e nao
-- como um UPDATE solto que alguem rodou no SQL Editor e ninguem lembra.
--
-- ── Por que o COPILOT, e nao outro ───────────────────────────────────────
--
-- Ele e o unico dos quatro em que a promocao nao amplia superficie de efeito:
--
--   modes         {read,simulate}   nao escreve
--   capabilities  brand.read, evidence.read, quality.precheck   as tres leem
--   autonomia     A1 -> A2          nunca chega em GOVERNED_EXECUTE
--
-- Ou seja: um COPILOT ACTIVE pode interpretar, consultar e explicar. Ele nao
-- cria conteudo, nao agenda e nao publica. Se algo der errado ali, o custo e
-- uma resposta ruim — nao um post no perfil do cliente.
--
-- Os outros tres continuam CANDIDATE de proposito. CONTENT e BRAND tem
-- capability de escrita, e promove-los e uma decisao separada, que merece a
-- propria migration e o proprio motivo. COMPLIANCE e o proximo natural, por
-- ser somente-leitura como este — mas nao ha razao para promover dois de uma
-- vez quando um ja ensina o que precisa ser aprendido em operacao.
--
-- ── Em que a decisao se apoia ────────────────────────────────────────────
--
-- Nos evals de packages/runtime/evals/AGT-MKT-COPILOT.json, rodados contra
-- este mesmo banco por packages/db/test/evals.test.mjs: um caso golden e
-- quatro adversariais, cobrindo injecao no texto do usuario, referencia que
-- nao resolve, ambiguidade material e tenant devolvido pelo modelo.
--
-- Os evals medem governanca, nao qualidade de texto. A qualidade continua
-- dependendo do golden dataset da Fase 2, construido com as corretoras
-- piloto (MKT-17, achado G11). Esta promocao NAO antecipa aquilo: ela libera
-- um agente que so le.
--
-- ── Para reverter ────────────────────────────────────────────────────────
--
--   update mkt_v2.agent_registry set status = 'CANDIDATE'
--    where agent_id = 'AGT-MKT-COPILOT' and version = 1;
-- =====================================================================

update mkt_v2.agent_registry
   set status = 'ACTIVE'
 where agent_id = 'AGT-MKT-COPILOT'
   and version = 1
   and status = 'CANDIDATE';

-- Se a linha nao existir ou ja tiver sido promovida, o update acima nao faz
-- nada e a migration segue. O que NAO pode passar em silencio e promover algo
-- que escreve: isto aqui derruba a transacao se um agente com capability de
-- escrita estiver ACTIVE.
do $$
declare escritores text[];
begin
  select array_agg(agent_id) into escritores
    from mkt_v2.agent_registry
   where status = 'ACTIVE'
     and (capabilities && array['content.create_draft','content.create_variant',
                                'publishing.publish','publishing.schedule',
                                'approval.request','brand.propose_version',
                                'brand.extract_from_url','channel.connect']);
  if escritores is not null then
    raise exception 'agente com capability de escrita esta ACTIVE: %. Promover um deles exige migration propria e motivo proprio.', escritores;
  end if;
end $$;

comment on table mkt_v2.agent_registry is
  'Agente nasce CANDIDATE. Promover para ACTIVE e ato de governanca e entra por migration, com o motivo junto.';


-- ─── 0010_brand_brain_promocao.sql ───────────────────────────────

-- =====================================================================
-- 0010_brand_brain_promocao.sql
--
-- Promover uma versao do Brand Brain para ACTIVE e ato de governanca: e a
-- decisao humana que separa "o agente propos" de "a marca passou a valer
-- assim". A tabela guardava `activated_at` — QUANDO — e nao guardava QUEM.
--
-- Isso importa mais aqui do que em quase qualquer outro lugar do sistema.
-- Todo conteudo gerado depois herda o Brand Brain ativo. Quando um texto
-- publicado estiver errado, a pergunta que se faz e "de onde veio essa
-- afirmacao", e a resposta precisa chegar a uma pessoa, nao a um timestamp.
--
-- Nao ha `activated_by` em nenhuma outra tabela porque em nenhuma outra a
-- ativacao e o momento em que um humano assume a responsabilidade por um
-- artefato que o agente escreveu.
-- =====================================================================

alter table mkt_v2.brand_brain_versions
  add column activated_by_actor_type mkt_v2.actor_type,
  add column activated_by_actor_id   text,
  add column superseded_at           timestamptz;

comment on column mkt_v2.brand_brain_versions.activated_by_actor_id is
  'Quem promoveu esta versao para ACTIVE. NULL em versao que nunca foi ativada.';
comment on column mkt_v2.brand_brain_versions.superseded_at is
  'Quando esta versao deixou de ser a ACTIVE. Preenchido ao promover a proxima.';

-- Ativacao sem dono nao passa.
--
-- O CHECK vale para linhas novas E para updates das antigas: uma versao que
-- chegar a ACTIVE daqui em diante tem de dizer quem a promoveu. As linhas
-- ACTIVE que ja existem ficam de fora — nao da para inventar retroativamente
-- quem apertou um botao que nao existia, e preencher com 'system' seria
-- afirmar algo falso sobre uma decisao humana.
alter table mkt_v2.brand_brain_versions
  add constraint brand_brain_active_tem_dono
  check (
    status <> 'ACTIVE'
    or activated_by_actor_id is not null
    or activated_at is null
  ) not valid;

-- `not valid` de proposito: a constraint passa a valer para o que vier, sem
-- derrubar a migration por causa do seed que ja esta la. Validar depois, se
-- alguem quiser, e uma decisao separada.


-- ─── 0011_model_ids_reais.sql ────────────────────────────────────

-- =====================================================================
-- 0011_model_ids_reais.sql  |  As rotas apontavam para modelos que nao existem.
--
-- A migration 0006 e a 0007 semearam `mkt_v2.model_routing` com os nomes
-- "claude-sonnet" e "claude-haiku". Nenhum dos dois e identificador valido da
-- API da Anthropic: a primeira chamada real devolve erro de modelo
-- desconhecido. Como nenhuma chamada real jamais aconteceu — o unico provider
-- exercitado ate hoje foi o roteirizado dos evals — o erro atravessou dois
-- gates verdes sem aparecer.
--
-- Registrado porque e o mesmo padrao que o CLAUDE.md descreve: caminho
-- desenhado, testado contra duble, nunca executado de verdade.
--
-- ── Por que versao nova em vez de UPDATE ─────────────────────────────────
--
-- `model_routing` e dado GOVERNADO e versionado: (task_class, version) e a
-- chave, e ha indice unico garantindo uma rota ACTIVE por classe. Reescrever a
-- versao 1 apagaria o registro de que ela existiu e de qual modelo rodou
-- enquanto ela valia. Os traces antigos citam a versao, e uma versao que muda
-- de conteudo transforma o trace em mentira.
--
-- Entao: a versao 1 vira DEPRECATED e a 2 nasce ACTIVE, na mesma transacao. A
-- ordem importa — o indice `model_routing_one_active` recusa duas ACTIVE para a
-- mesma classe, e ele esta certo em recusar.
--
-- ── Sobre a escolha de modelo ────────────────────────────────────────────
--
-- A escolha de TIER ja estava feita e nao e minha para mudar: raciocinio e
-- copywriting em Sonnet, extracao e classificacao em Haiku. Esta migration so
-- troca o identificador pelo que existe hoje na geracao correspondente, e
-- corrige os precos, que estavam na tabela da geracao anterior.
--
-- Se em algum momento a qualidade de copywriting ou de planejamento pedir mais
-- que Sonnet, a rota para Opus e uma migration nova — nao uma constante no
-- codigo. E por isso que isto e dado.
-- =====================================================================

-- Precos em centavos por 1M de tokens, na tabela vigente:
--   claude-sonnet-5   input US$ 2,00  -> 200    output US$ 10,00 -> 1000
--   claude-haiku-4-5  input US$ 1,00  -> 100    output US$  5,00 ->  500

update mkt_v2.model_routing
   set status = 'DEPRECATED'
 where version = 1
   and task_class in ('reasoning','extraction','classification','copywriting','vision');

insert into mkt_v2.model_routing
 (task_class, version, status, primary_target, fallback, max_cost_cents, timeout_ms, data_policy, owner)
values
 ('reasoning', 2, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-sonnet-5","price":{"input_cents_per_mtok":200,"output_cents_per_mtok":1000}}'::jsonb,
  '[]'::jsonb, 15, 60000, 'sem PII no prompt', 'AI Platform'),

 ('extraction', 2, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-haiku-4-5","price":{"input_cents_per_mtok":100,"output_cents_per_mtok":500}}'::jsonb,
  '[]'::jsonb, 30, 90000, 'conteudo publico do site do cliente', 'Brand'),

 ('classification', 2, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-haiku-4-5","price":{"input_cents_per_mtok":100,"output_cents_per_mtok":500}}'::jsonb,
  '[]'::jsonb, 10, 30000, 'sem PII', 'Compliance'),

 ('copywriting', 2, 'ACTIVE',
  '{"provider":"anthropic","model":"claude-sonnet-5","price":{"input_cents_per_mtok":200,"output_cents_per_mtok":1000}}'::jsonb,
  '[]'::jsonb, 40, 90000, 'sem PII no prompt', 'Content'),

 -- Continua CANDIDATE: visao entra na Fase 3. O id e corrigido junto porque
 -- deixar um identificador invalido dormindo na tabela e deixar a mesma
 -- armadilha armada para quem promover a rota.
 ('vision', 2, 'CANDIDATE',
  '{"provider":"anthropic","model":"claude-sonnet-5","price":{"input_cents_per_mtok":200,"output_cents_per_mtok":1000}}'::jsonb,
  '[]'::jsonb, 50, 90000, 'foto enviada pelo cliente', 'Content');

-- image_generation e embedding ficam como estao: provider "none", bloqueados
-- ate a Fase 3 por decisao de custo (MKT-17, achado G12). Nao ha id errado ali
-- para corrigir — ha uma decisao registrada.

comment on column mkt_v2.model_routing.primary_target is
  'Identificador REAL do provider. Nome de familia sem versao ("claude-sonnet") nao e aceito pela API: a chamada falha com modelo desconhecido, e falha na primeira vez que alguem roda de verdade.';


-- ─── 0012_taxonomia_mercado.sql ──────────────────────────────────

-- =====================================================================
-- 0012_taxonomia_mercado.sql  |  A camada canonica do mercado segurador.
--
-- Primeira metade do passo 2 de docs/JORNADA-PERFIL.md.
--
-- ── Por que estas tabelas nao tem org_id ─────────────────────────────────
--
-- Porque o que elas guardam nao pertence a nenhum cliente. Ramo de seguro,
-- publico-alvo, tipo de conteudo e termo vedado sao do MERCADO: valem igual
-- para toda corretora, seguradora e MGA que usar a plataforma.
--
-- A separacao nao e organizacao, e o que torna duas coisas possiveis:
--
--   1. compliance deterministico — "cobertura ilimitada" e vedacao do mercado,
--      e nao pode depender de o cliente ter digitado essa proibicao no proprio
--      perfil. Hoje depende, e esse e o achado 4 de docs/REVISAO-AGENTES.md.
--   2. comparar e curar — se cada tenant tiver o proprio vocabulario, ninguem
--      consegue medir nada entre clientes, e o mesmo produto aparece com cinco
--      nomes diferentes.
--
-- A regua que separa as duas camadas: se a afirmacao vale para o mercado
-- inteiro, e canonica e mora aqui. Se vale para esta empresa, e perfil e mora
-- na camada do tenant. "Seguro garantia e um ramo" e canonico; "nos vendemos
-- seguro garantia para construtoras medias" e perfil.
--
-- ── Por que tudo nasce CANDIDATE ─────────────────────────────────────────
--
-- Esta e a unica coisa do sistema que NAO pode ser gerada por modelo sem
-- revisao humana: ela e a regua contra a qual todo conteudo vai ser julgado.
-- Uma taxonomia errada promovida contamina todo julgamento posterior, e
-- ninguem percebe a origem — o mesmo motivo pelo qual o Brand Brain do agente
-- nasce CANDIDATE.
--
-- Entao a carga abaixo e PROPOSTA, nao verdade. Nasce CANDIDATE, o codigo so
-- le ACTIVE, e enquanto ninguem curar, a taxonomia nao decide nada. Ha teste
-- afirmando que nenhuma linha semeada esta ACTIVE.
--
-- ── O que NAO esta semeado, e por que ────────────────────────────────────
--
-- `taxonomy_audiences` e `taxonomy_content_types` sobem VAZIAS. Publico-alvo e
-- taxonomia editorial nao tem fonte publica de onde partir; propo-las seria
-- inventar a estrutura do mercado a partir do que o modelo acha. Uma lacuna
-- declarada e corrigivel; uma lacuna preenchida com palpite vira fato falso
-- que todo mundo passa a citar.
-- =====================================================================

-- ── Produtos e ramos ─────────────────────────────────────────────────────
create table mkt_v2.taxonomy_products (
  product_code   text primary key,
  version        integer not null default 1,
  status         mkt_v2.lifecycle_status not null default 'CANDIDATE',
  label          text not null,
  -- O codigo oficial fica NULO ate a curadoria preencher a partir da fonte
  -- normativa. Um codigo de ramo errado e pior que nenhum: ele parece
  -- autoridade regulatoria e vai ser citado como se fosse.
  ramo_susep     text,
  regulator      text check (regulator in ('SUSEP','ANS')),
  parent_code    text references mkt_v2.taxonomy_products(product_code),
  synonyms       text[] not null default '{}',
  required_disclaimers jsonb not null default '[]'::jsonb,
  notes          text,
  created_at     timestamptz not null default now(),
  curated_at     timestamptz,
  curated_by     text,
  -- Curado e um fato com dono e data. Sem os dois, nao ha o que auditar.
  constraint taxonomy_product_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

comment on table mkt_v2.taxonomy_products is
  'Ramos e produtos do mercado segurador. Dado de mercado, nao do tenant. Nasce CANDIDATE: o codigo so le ACTIVE, e promover e ato de curadoria humana.';

-- ── Publicos-alvo ────────────────────────────────────────────────────────
create table mkt_v2.taxonomy_audiences (
  audience_code  text primary key,
  version        integer not null default 1,
  status         mkt_v2.lifecycle_status not null default 'CANDIDATE',
  label          text not null,
  segment        text not null check (segment in ('PF','PJ')),
  synonyms       text[] not null default '{}',
  notes          text,
  created_at     timestamptz not null default now(),
  curated_at     timestamptz,
  curated_by     text,
  constraint taxonomy_audience_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

comment on table mkt_v2.taxonomy_audiences is
  'Sobe vazia de proposito: publico-alvo nao tem fonte publica de onde partir, e inventar a estrutura do mercado seria fato falso com aparencia de dado.';

-- ── Tipos de conteudo ────────────────────────────────────────────────────
create table mkt_v2.taxonomy_content_types (
  content_type_code text primary key,
  version           integer not null default 1,
  status            mkt_v2.lifecycle_status not null default 'CANDIDATE',
  label             text not null,
  suited_channels   mkt_v2.channel[] not null default '{}',
  default_claim_type text not null default 'GENERAL'
    check (default_claim_type in ('COVERAGE','PRICE','DEADLINE','PERFORMANCE','GENERAL')),
  notes             text,
  created_at        timestamptz not null default now(),
  curated_at        timestamptz,
  curated_by        text,
  constraint taxonomy_content_type_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

comment on table mkt_v2.taxonomy_content_types is
  'Idem: a taxonomia editorial do mercado e curadoria, nao inferencia.';

-- ── Vocabulario: o que o mercado nao deixa dizer ─────────────────────────
--
-- Esta e a tabela que fecha o achado 4 da revisao. Hoje a unica defesa contra
-- "cobertura ilimitada" e a lista de proibicoes que o proprio cliente escreveu
-- no Brand Brain dele. Vedacao de mercado nao pode depender disso.
create table mkt_v2.taxonomy_terms (
  id            bigserial primary key,
  version       integer not null default 1,
  status        mkt_v2.lifecycle_status not null default 'CANDIDATE',
  term          text not null,
  kind          text not null check (kind in ('FORBIDDEN','SENSITIVE','PREFERRED')),
  -- NULL = vale para todo o mercado. Preenchido = so naquele ramo.
  scope_product text references mkt_v2.taxonomy_products(product_code),
  claim_type    text check (claim_type in ('COVERAGE','PRICE','DEADLINE','PERFORMANCE','GENERAL')),
  -- Por que e vedado. Aparece na recusa: "termo X, porque Y" e acionavel;
  -- "termo proibido" manda a pessoa adivinhar o que escrever no lugar.
  rationale     text not null,
  suggestion    text,
  source        text,
  created_at    timestamptz not null default now(),
  curated_at    timestamptz,
  curated_by    text,
  constraint taxonomy_term_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

create unique index taxonomy_term_unico
  on mkt_v2.taxonomy_terms (lower(term), coalesce(scope_product, ''));
create index on mkt_v2.taxonomy_terms (status) where status = 'ACTIVE';

comment on table mkt_v2.taxonomy_terms is
  'Termos vedados, sensiveis e preferidos do mercado. Conteudo julgado por esta lista nao depende de o cliente ter escrito a proibicao. Nasce CANDIDATE.';

-- ── RLS ──────────────────────────────────────────────────────────────────
--
-- Sem org_id nao e desculpa para ficar sem RLS: o teste do schema exige RLS em
-- toda tabela. Leitura liberada porque e dado de mercado, igual para todos;
-- escrita nao tem policy nenhuma, entao so migration e service_role escrevem.
alter table mkt_v2.taxonomy_products enable row level security;
alter table mkt_v2.taxonomy_products force row level security;
create policy taxonomy_products_read on mkt_v2.taxonomy_products for select using (true);

alter table mkt_v2.taxonomy_audiences enable row level security;
alter table mkt_v2.taxonomy_audiences force row level security;
create policy taxonomy_audiences_read on mkt_v2.taxonomy_audiences for select using (true);

alter table mkt_v2.taxonomy_content_types enable row level security;
alter table mkt_v2.taxonomy_content_types force row level security;
create policy taxonomy_content_types_read on mkt_v2.taxonomy_content_types for select using (true);

alter table mkt_v2.taxonomy_terms enable row level security;
alter table mkt_v2.taxonomy_terms force row level security;
create policy taxonomy_terms_read on mkt_v2.taxonomy_terms for select using (true);

-- =====================================================================
-- CARGA PROPOSTA — toda ela CANDIDATE, nenhuma linha vale ate ser curada.
-- =====================================================================

-- Agrupadores. Existem para o perfil dizer "opera patrimonial" sem listar
-- oito produtos, e para o termo vedado poder ter escopo de ramo inteiro.
insert into mkt_v2.taxonomy_products (product_code, label, regulator, notes) values
 ('AUTO',            'Automovel',                    'SUSEP', 'Agrupador de ramo'),
 ('PATRIMONIAL',     'Patrimonial',                  'SUSEP', 'Agrupador de ramo'),
 ('PESSOAS',         'Pessoas',                      'SUSEP', 'Agrupador de ramo'),
 ('SAUDE',           'Saude e odontologico',         'ANS',   'Agrupador de ramo'),
 ('RESPONSABILIDADE','Responsabilidade civil',       'SUSEP', 'Agrupador de ramo'),
 ('FINANCEIRO',      'Riscos financeiros e garantia','SUSEP', 'Agrupador de ramo'),
 ('ESPECIAIS',       'Riscos especiais',             'SUSEP', 'Agrupador de ramo');

insert into mkt_v2.taxonomy_products (product_code, label, parent_code, regulator, synonyms) values
 ('AUTO_INDIVIDUAL',   'Automovel individual',        'AUTO',            'SUSEP', '{"seguro auto","seguro de carro","auto PF"}'),
 ('AUTO_FROTA',        'Frota',                       'AUTO',            'SUSEP', '{"seguro de frota","frotista"}'),
 ('AUTO_MOTO',         'Motocicleta',                 'AUTO',            'SUSEP', '{"seguro moto"}'),

 ('RESIDENCIAL',       'Residencial',                 'PATRIMONIAL',     'SUSEP', '{"seguro residencial","seguro da casa","compreensivo residencial"}'),
 ('CONDOMINIO',        'Condominio',                  'PATRIMONIAL',     'SUSEP', '{"seguro de condominio"}'),
 ('EMPRESARIAL',       'Empresarial / patrimonial PJ','PATRIMONIAL',     'SUSEP', '{"seguro empresarial","compreensivo empresarial"}'),
 ('EQUIPAMENTOS',      'Equipamentos e riscos diversos','PATRIMONIAL',   'SUSEP', '{"seguro de equipamento","riscos diversos"}'),

 ('VIDA_INDIVIDUAL',   'Vida individual',             'PESSOAS',         'SUSEP', '{"seguro de vida"}'),
 ('VIDA_EM_GRUPO',     'Vida em grupo',               'PESSOAS',         'SUSEP', '{"vida em grupo","seguro de vida empresarial"}'),
 ('ACIDENTES_PESSOAIS','Acidentes pessoais',          'PESSOAS',         'SUSEP', '{"AP","acidentes pessoais coletivo"}'),
 ('PREVIDENCIA',       'Previdencia',                 'PESSOAS',         'SUSEP', '{"PGBL","VGBL","previdencia privada"}'),
 ('VIAGEM',            'Viagem',                      'PESSOAS',         'SUSEP', '{"seguro viagem"}'),

 ('SAUDE_PME',         'Saude PME',                   'SAUDE',           'ANS',   '{"plano de saude PME","saude empresarial"}'),
 ('SAUDE_ADESAO',      'Saude por adesao',            'SAUDE',           'ANS',   '{"plano por adesao","coletivo por adesao"}'),
 ('ODONTOLOGICO',      'Odontologico',                'SAUDE',           'ANS',   '{"plano odontologico","plano dental"}'),

 ('RC_GERAL',          'Responsabilidade civil geral','RESPONSABILIDADE','SUSEP', '{"RC geral"}'),
 ('RC_PROFISSIONAL',   'Responsabilidade civil profissional','RESPONSABILIDADE','SUSEP','{"E&O","RC profissional"}'),
 ('DO',                'D&O',                         'RESPONSABILIDADE','SUSEP', '{"D&O","responsabilidade de administradores"}'),
 ('CYBER',             'Riscos cibernéticos',         'RESPONSABILIDADE','SUSEP', '{"cyber","seguro cibernetico"}'),

 ('SEGURO_GARANTIA',   'Seguro garantia',             'FINANCEIRO',      'SUSEP', '{"garantia de obra","performance bond"}'),
 ('FIANCA_LOCATICIA',  'Fianca locaticia',            'FINANCEIRO',      'SUSEP', '{"seguro fianca","fianca de aluguel"}'),
 ('CREDITO',           'Credito interno',             'FINANCEIRO',      'SUSEP', '{"seguro de credito"}'),

 ('TRANSPORTES',       'Transportes',                 'ESPECIAIS',       'SUSEP', '{"seguro de carga","RCTR-C","RCF-DC"}'),
 ('AGRO',              'Rural / agro',                'ESPECIAIS',       'SUSEP', '{"seguro agricola","seguro rural","penhor rural"}'),
 ('GARANTIA_ESTENDIDA','Garantia estendida',          'ESPECIAIS',       'SUSEP', '{"garantia estendida"}');

-- ── Termos vedados ───────────────────────────────────────────────────────
--
-- A lista abaixo e de promessa comercial que o texto de seguro nao sustenta:
-- absolutos ("ilimitado", "total", "sempre"), garantias de resultado
-- ("garantido", "aprovacao imediata") e superlativos comparativos ("o melhor
-- do Brasil"). Sao os que aparecem em material de marketing e que nenhuma
-- apolice consegue honrar, porque toda apolice tem limite, carencia e
-- exclusao.
--
-- `suggestion` existe porque recusar sem oferecer saida faz o redator tentar
-- de novo com um sinonimo.
insert into mkt_v2.taxonomy_terms (term, kind, claim_type, rationale, suggestion, source) values
 ('cobertura ilimitada', 'FORBIDDEN', 'COVERAGE',
  'Nenhuma apolice tem cobertura sem limite: existe limite maximo de indenizacao.',
  'Diga o limite contratado, ou "cobertura ate o limite da apolice".',
  'proposta desta sessao, nao curado'),

 ('cobertura total', 'FORBIDDEN', 'COVERAGE',
  'Sugere ausencia de exclusao, o que nenhuma apolice oferece.',
  'Liste as coberturas contratadas.',
  'proposta desta sessao, nao curado'),

 ('cobre tudo', 'FORBIDDEN', 'COVERAGE',
  'Mesma promessa de ausencia de exclusao, em linguagem coloquial.',
  'Diga o que cobre, com as principais exclusoes.',
  'proposta desta sessao, nao curado'),

 ('sem carencia', 'FORBIDDEN', 'DEADLINE',
  'Prazo de carencia e clausula contratual e varia por produto e por operadora.',
  'Informe a carencia real do produto.',
  'proposta desta sessao, nao curado'),

 ('sem franquia', 'SENSITIVE', 'COVERAGE',
  'Existe em alguns produtos, mas e afirmacao material: precisa de condicao geral que sustente.',
  'Cite a condicao que preve a isencao.',
  'proposta desta sessao, nao curado'),

 ('garantido', 'FORBIDDEN', 'PERFORMANCE',
  'Garantia de resultado nao existe em seguro: indenizacao depende de regulacao do sinistro.',
  'Descreva o processo, nao o desfecho.',
  'proposta desta sessao, nao curado'),

 ('aprovacao imediata', 'FORBIDDEN', 'DEADLINE',
  'Aceitacao passa por analise de risco; imediato so se o produto for de aceitacao automatica.',
  'Diga o prazo medio real de analise.',
  'proposta desta sessao, nao curado'),

 ('indenizacao garantida', 'FORBIDDEN', 'COVERAGE',
  'Indenizacao depende de cobertura, vigencia e regulacao — nunca e garantida de antemao.',
  'Explique quando ha cobertura.',
  'proposta desta sessao, nao curado'),

 ('o melhor seguro do brasil', 'FORBIDDEN', 'PERFORMANCE',
  'Superlativo comparativo sem lastro verificavel; publicidade comparativa exige prova.',
  'Traga um diferencial verificavel.',
  'proposta desta sessao, nao curado'),

 ('mais barato do mercado', 'FORBIDDEN', 'PRICE',
  'Afirmacao de preco comparativa que muda a cada cotacao e nao se sustenta.',
  'Fale em economia possivel, com a condicao.',
  'proposta desta sessao, nao curado'),

 ('100% de cobertura', 'FORBIDDEN', 'COVERAGE',
  'Percentual absoluto de cobertura nao existe diante de limite e exclusao.',
  'Diga o percentual real sobre o valor segurado.',
  'proposta desta sessao, nao curado'),

 ('sem analise de perfil', 'FORBIDDEN', 'COVERAGE',
  'Perfil e base de precificacao e de aceitacao em varios ramos.',
  'Diga o que dispensa vistoria, se for o caso.',
  'proposta desta sessao, nao curado'),

 ('livre de impostos', 'FORBIDDEN', 'PRICE',
  'Premio de seguro tem IOF; a isencao e excecao por produto e precisa ser nomeada.',
  'Cite o tributo e a base legal, se houver isencao.',
  'proposta desta sessao, nao curado'),

 ('reembolso integral', 'SENSITIVE', 'COVERAGE',
  'Existe em alguns planos, sempre com limite e tabela — afirmacao material.',
  'Informe o limite de reembolso.',
  'proposta desta sessao, nao curado');

-- Vedacao de ramo: prazo de carencia e regra de saude, e falar em "atendimento
-- imediato" ali e promessa diferente de falar em auto.
insert into mkt_v2.taxonomy_terms (term, kind, scope_product, claim_type, rationale, suggestion, source) values
 ('atendimento imediato', 'SENSITIVE', 'SAUDE', 'DEADLINE',
  'Em saude, prazo de atendimento e regulado e depende de carencia e rede.',
  'Informe o prazo previsto e a carencia aplicavel.',
  'proposta desta sessao, nao curado'),

 ('cobertura vitalicia', 'FORBIDDEN', 'PESSOAS', 'COVERAGE',
  'Vigencia e renovacao sao contratuais; vitalicio exige produto que efetivamente preveja.',
  'Diga a vigencia e as condicoes de renovacao.',
  'proposta desta sessao, nao curado');


-- ─── 0013_perfil_da_empresa.sql ──────────────────────────────────

-- =====================================================================
-- 0013_perfil_da_empresa.sql  |  A camada do tenant: quem e ESTA empresa.
--
-- Passo 3 de docs/JORNADA-PERFIL.md.
--
-- O Brand Brain guarda identidade, tom em prosa, claims permitidos, proibicoes
-- e disclaimers, lidos do site. E pouco para o produto nao escrever a mesma
-- coisa para toda corretora. Faltam as quatro coisas que efetivamente
-- diferenciam uma da outra: produtos operados, seguradoras representadas,
-- publico-alvo e o tom que a empresa PRATICA — que raramente e o que ela
-- declara.
--
-- ── Por que uma tabela nova em vez de colunas no Brand Brain ─────────────
--
-- Porque o que muda nao e o conteudo de um campo: e a forma. Produto, publico
-- e mix de conteudo sao LISTAS que referenciam a taxonomia do mercado, com
-- peso e prioridade. Enfiar isso em jsonb dentro de brand_brain_versions
-- pareceria mais barato hoje e impediria a unica coisa que justifica ter
-- taxonomia: perguntar "quais clientes operam seguro garantia" com um join, em
-- vez de varrer json.
--
-- O Brand Brain continua onde esta. A migracao dos dados de um para o outro e
-- decisao separada (docs/JORNADA-PERFIL.md §8, decisao 2), e ate ela acontecer
-- os dois convivem — com o perfil sendo o que a jornada nova escreve.
--
-- ── O que se mantem, palavra por palavra ────────────────────────────────
--
-- O invariante do Brand Brain: o agente propoe CANDIDATE, quem promove para
-- ACTIVE e uma pessoa, e a promocao guarda QUEM. Um perfil errado promovido
-- contamina todo conteudo gerado depois, e ninguem percebe a origem — e agora
-- ele carrega tambem produto e publico, entao o estrago e maior.
-- =====================================================================

create table mkt_v2.company_profile_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  brand_id       uuid not null references mkt_v2.brands(id) on delete cascade,
  version        integer not null,
  status         mkt_v2.lifecycle_status not null default 'CANDIDATE',

  company_type   text not null default 'CORRETORA'
    check (company_type in ('CORRETORA','SEGURADORA','MGA','INSURTECH')),

  identity       jsonb not null default '{}'::jsonb,

  -- Tom em EIXOS, nao em prosa.
  --
  -- "Tom profissional e proximo" nao e verificavel: dois redatores leem duas
  -- coisas, e nenhum revisor consegue dizer se o texto saiu do tom. Cinco
  -- eixos de 1 a 5 sao. E, principalmente, permitem comparar o tom DECLARADO
  -- com o tom OBSERVADO nas publicacoes reais — quando os dois divergem, isso
  -- e uma conversa a ter com o cliente, nao um dado a esconder.
  tone_axes      jsonb not null default '{}'::jsonb,
  tone_observed  jsonb not null default '{}'::jsonb,
  voice_examples jsonb not null default '[]'::jsonb,

  prohibitions   jsonb not null default '[]'::jsonb,
  disclaimers    jsonb not null default '[]'::jsonb,

  -- Lacuna DECLARADA. O que a leitura nao achou entra aqui e a tela pergunta.
  -- Sem este campo, o modelo preenche o que faltou com o que e razoavel, e
  -- razoavel inventado vira fato sobre a marca do cliente.
  gaps           jsonb not null default '[]'::jsonb,

  created_by_actor_type mkt_v2.actor_type not null default 'agent',
  created_by_actor_id   text,
  created_at     timestamptz not null default now(),

  activated_at   timestamptz,
  activated_by_actor_type mkt_v2.actor_type,
  activated_by_actor_id   text,
  superseded_at  timestamptz,

  unique (brand_id, version),

  -- Ativacao sem dono nao passa. Aqui, diferente da 0010, a constraint nasce
  -- valida: nao ha linha antiga para acomodar.
  constraint profile_active_tem_dono
    check (status <> 'ACTIVE' or activated_by_actor_id is not null)
);

-- Uma ACTIVE por marca, nem por um instante. O mesmo indice do Brand Brain,
-- pela mesma razao: duas verdades simultaneas sobre quem a empresa e nao e um
-- estado transitorio aceitavel, e um `update` sem transacao criaria um.
create unique index company_profile_one_active
  on mkt_v2.company_profile_versions (brand_id) where status = 'ACTIVE';

comment on table mkt_v2.company_profile_versions is
  'Quem e esta empresa: produtos, publico, tom e mix. Nasce CANDIDATE; promover e ato humano com dono registrado.';

-- ── As listas que referenciam a taxonomia ───────────────────────────────
--
-- Todas carregam org_id. Nao e redundancia: e o que permite a policy de RLS
-- padrao (mkt_v2.enable_org_rls) valer aqui como vale em claims e evidence. Sem
-- a coluna, cada tabela precisaria da propria policy com join — e policy com
-- join e onde vazamento cross-tenant nasce.

create table mkt_v2.profile_products (
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt_v2.company_profile_versions(id) on delete cascade,
  product_code       text not null references mkt_v2.taxonomy_products(product_code),
  priority           integer not null default 3 check (priority between 1 and 5),
  is_focus           boolean not null default false,
  notes              text,
  primary key (profile_version_id, product_code)
);

create table mkt_v2.profile_audiences (
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt_v2.company_profile_versions(id) on delete cascade,
  audience_code      text not null references mkt_v2.taxonomy_audiences(audience_code),
  weight             integer not null default 3 check (weight between 1 and 5),
  primary key (profile_version_id, audience_code)
);

create table mkt_v2.profile_content_mix (
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt_v2.company_profile_versions(id) on delete cascade,
  content_type_code  text not null references mkt_v2.taxonomy_content_types(content_type_code),
  share_pct          integer not null check (share_pct between 0 and 100),
  primary key (profile_version_id, content_type_code)
);

-- Seguradoras representadas. Importa para o que pode ser citado: nome de
-- terceiro em peca de marketing tem regra de marca que nao e nossa.
create table mkt_v2.profile_carriers (
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt_v2.company_profile_versions(id) on delete cascade,
  carrier_name       text not null,
  relationship       text not null check (relationship in ('REPRESENTA','PARCEIRO','RESSEGURO','PROPRIA')),
  can_mention        boolean not null default false,
  primary key (profile_version_id, carrier_name)
);

-- ── A procedencia, campo a campo ────────────────────────────────────────
--
-- Esta e a tabela que muda o que o sistema consegue provar.
--
-- Hoje nenhum claim material se sustenta porque nada produz evidence citavel
-- para conteudo (achado 5 de docs/REVISAO-AGENTES.md): so o Brand Brain grava
-- a fonte que leu. Com o perfil, cada AFIRMACAO sobre a empresa passa a ter
-- origem, citacao e confianca — e o perfil vira a primeira fonte citavel do
-- produto.
--
-- `source_kind` separa o que a maquina leu do que a pessoa afirmou. Quem
-- revisa precisa saber qual e qual: uma inferencia do LinkedIn e hipotese;
-- uma resposta na entrevista e fato.
create table mkt_v2.profile_field_sources (
  id                 bigserial primary key,
  org_id             uuid not null references mkt_v2.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt_v2.company_profile_versions(id) on delete cascade,
  field_path         text not null,
  source_kind        text not null check (source_kind in ('SITE','LINKEDIN','POST','ENTREVISTA','INFERIDO')),
  evidence_id        uuid references mkt_v2.evidence(id),
  quote              text,
  confidence         text not null check (confidence in ('HIGH','MEDIUM','LOW')),
  created_at         timestamptz not null default now()
);

create index on mkt_v2.profile_field_sources (profile_version_id, field_path);

-- Afirmacao lida de fora sem citacao nao e procedencia, e "eu li em algum
-- lugar". Entrevista e inferencia declarada nao precisam: numa, a fonte e a
-- pessoa; na outra, a ausencia de fonte E a informacao.
alter table mkt_v2.profile_field_sources
  add constraint profile_source_lido_tem_citacao
  check (source_kind not in ('SITE','LINKEDIN','POST') or quote is not null);

select mkt_v2.enable_org_rls('mkt_v2.company_profile_versions');
select mkt_v2.enable_org_rls('mkt_v2.profile_products');
select mkt_v2.enable_org_rls('mkt_v2.profile_audiences');
select mkt_v2.enable_org_rls('mkt_v2.profile_content_mix');
select mkt_v2.enable_org_rls('mkt_v2.profile_carriers');
select mkt_v2.enable_org_rls('mkt_v2.profile_field_sources');

-- =====================================================================
-- A capability que propoe, e a policy que a deixa acontecer.
-- =====================================================================

insert into mkt_v2.capability_registry
 (capability_id, version, status, mode, side_effect, risk_tier, input_schema_ref, output_schema_ref,
  error_codes, permissions, idempotency_required, idempotency_key_template, provider_adapter,
  timeout_ms, max_attempts, owner)
values
 ('profile.propose', 1, 'ACTIVE', 'write', 'internal', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{EVIDENCE_INSUFFICIENT,SCHEMA_VALIDATION_FAILED,NORMALIZATION_FAILED}','{OWNER,MARKETING}',
  false, null, null, 60000, 2, 'Brand');

insert into mkt_v2.rule_policies
 (org_id, policy_id, version, status, priority, scope, conditions, effect, max_autonomy,
  reason_code, message_key, note)
values
 (null, 'POL_PROFILE_PROPOSE_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"profile.propose"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.brand_propose_allowed',
  'O agente propoe perfil CANDIDATE; promover para ACTIVE e ato humano.');

-- =====================================================================
-- O charter do AGT-MKT-BRAND.
--
-- Ele deixa de ser "o agente do Brand Brain" e passa a ser o dono da jornada
-- de entrada: le o site, le o LinkedIn, conduz a entrevista e propoe o perfil.
-- docs/JORNADA-PERFIL.md §5 propoe renomea-lo para AGT-MKT-PROFILE; o nome
-- fica para quando a decisao 2 (perfil substitui ou convive com o Brand Brain)
-- estiver tomada, porque renomear agente muda o que os traces antigos citam.
--
-- O que muda agora e so a capability. O agente continua CANDIDATE: nada disto
-- serve usuario nenhum ate uma promocao explicita, com migration propria.
-- =====================================================================

update mkt_v2.agent_registry
   set capabilities = capabilities || '{profile.propose}',
       mission = 'Construir o perfil da empresa a partir do site, do LinkedIn e de revisao humana estruturada.'
 where agent_id = 'AGT-MKT-BRAND' and version = 1;

comment on table mkt_v2.profile_field_sources is
  'Procedencia campo a campo do perfil. E o que separa o que a maquina leu do que a pessoa afirmou — e o que faz o perfil ser citavel como evidence.';


-- Controle de versao das migrations, para o runner reconhecer o que ja rodou.
create table if not exists mkt_v2.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Nenhuma tabela do schema fica alcancavel pela anon key, nem o ledger do runner.
alter table mkt_v2.schema_migrations enable row level security;
insert into mkt_v2.schema_migrations (name) values
  ('0001_iam.sql'),
  ('0002_brand_content.sql'),
  ('0003_publishing.sql'),
  ('0004_governance.sql'),
  ('0005_runtime_events.sql'),
  ('0006_seed_registries.sql'),
  ('0007_model_routing_budget.sql'),
  ('0008_rls_processed_events.sql'),
  ('0009_promote_copilot.sql'),
  ('0010_brand_brain_promocao.sql'),
  ('0011_model_ids_reais.sql'),
  ('0012_taxonomia_mercado.sql'),
  ('0013_perfil_da_empresa.sql')
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = 'mkt_v2';
--   select capability_id, status from mkt_v2.capability_registry order by 1;
