-- =====================================================================
-- 0002_brand_content.sql  |  Brand Brain, conteudo versionado, evidence e claims.
-- Regra transversal (MKT-08 §5): org_id obrigatorio, status como enum,
-- versao imutavel apos ACTIVE, ator de criacao registrado.
-- =====================================================================

create type mkt.content_state as enum (
  'DRAFT','AI_REVIEW','HUMAN_REVIEW','COMPLIANCE_REVIEW','APPROVED',
  'SCHEDULED','PUBLISHING','PUBLISHED','REJECTED','FAILED','CANCELLED'
);
create type mkt.risk_tier as enum ('LOW','MEDIUM','HIGH');
create type mkt.channel as enum ('INSTAGRAM','FACEBOOK','LINKEDIN','BLOG','EMAIL','WHATSAPP');
create type mkt.actor_type as enum ('user','agent','system','provider');

create table mkt.brands (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id uuid not null references mkt.workspaces(id) on delete cascade,
  name         text not null,
  website_url  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table mkt.brand_brain_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  brand_id       uuid not null references mkt.brands(id) on delete cascade,
  version        integer not null,
  status         mkt.lifecycle_status not null default 'CANDIDATE',
  identity       jsonb not null default '{}'::jsonb,
  tone           jsonb not null default '{}'::jsonb,
  claims_allowed jsonb not null default '[]'::jsonb,
  prohibitions   jsonb not null default '[]'::jsonb,
  disclaimers    jsonb not null default '[]'::jsonb,
  source_refs    jsonb not null default '[]'::jsonb,
  created_by_actor_type mkt.actor_type not null default 'user',
  created_by_actor_id   text,
  created_at     timestamptz not null default now(),
  activated_at   timestamptz,
  unique (brand_id, version)
);

-- Apenas uma versao ACTIVE por marca.
create unique index brand_brain_one_active
  on mkt.brand_brain_versions (brand_id) where status = 'ACTIVE';

create table mkt.evidence (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id uuid not null references mkt.workspaces(id) on delete cascade,
  source_kind  text not null check (source_kind in ('BRAND_BRAIN','SOURCE_ARTIFACT','UPLOADED_FILE','PROVIDER_RESPONSE','DOMAIN_RECORD')),
  locator      text not null,
  hash         text not null,
  fact         text,
  quality      text check (quality in ('HIGH','MEDIUM','LOW')),
  retrieved_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create table mkt.contents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id uuid not null references mkt.workspaces(id) on delete cascade,
  brand_id     uuid not null references mkt.brands(id) on delete cascade,
  title        text not null,
  objective    text,
  created_by_actor_type mkt.actor_type not null default 'user',
  created_by_actor_id   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table mkt.content_versions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references mkt.organizations(id) on delete cascade,
  content_id             uuid not null references mkt.contents(id) on delete cascade,
  version                integer not null,
  state                  mkt.content_state not null default 'DRAFT',
  risk_tier              mkt.risk_tier not null default 'LOW',
  master_body            text not null,
  brand_brain_version_id uuid references mkt.brand_brain_versions(id),
  agent_id               text,
  agent_version          integer,
  trace_id               text,
  created_by_actor_type  mkt.actor_type not null default 'agent',
  created_by_actor_id    text,
  created_at             timestamptz not null default now(),
  approved_at            timestamptz,
  unique (content_id, version)
);

create table mkt.channel_variants (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  content_version_id uuid not null references mkt.content_versions(id) on delete cascade,
  channel            mkt.channel not null,
  headline           text,
  body               text not null,
  cta                text,
  asset_refs         jsonb not null default '[]'::jsonb,
  char_count         integer,
  created_at         timestamptz not null default now(),
  unique (content_version_id, channel)
);

create table mkt.claims (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  content_version_id uuid not null references mkt.content_versions(id) on delete cascade,
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

create index on mkt.brands (workspace_id);
create index on mkt.contents (workspace_id, created_at desc);
create index on mkt.content_versions (content_id, version desc);
create index on mkt.content_versions (state);
create index on mkt.channel_variants (content_version_id);

select mkt.enable_org_rls('mkt.brands');
select mkt.enable_org_rls('mkt.brand_brain_versions');
select mkt.enable_org_rls('mkt.evidence');
select mkt.enable_org_rls('mkt.contents');
select mkt.enable_org_rls('mkt.content_versions');
select mkt.enable_org_rls('mkt.channel_variants');
select mkt.enable_org_rls('mkt.claims');

-- ---------------------------------------------------------------------
-- State machine aplicada no banco. O agente nao consegue pular de DRAFT
-- para PUBLISHED nem por bug de aplicacao nem por SQL direto.
-- ---------------------------------------------------------------------
create or replace function mkt.assert_content_transition() returns trigger
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
  before update of state on mkt.content_versions
  for each row execute function mkt.assert_content_transition();

-- Alteracao do corpo apos aprovacao invalida a aprovacao (MKT-04-05 §6.2).
create or replace function mkt.invalidate_approval_on_edit() returns trigger
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
  before update of master_body on mkt.content_versions
  for each row execute function mkt.invalidate_approval_on_edit();
