-- =====================================================================
-- 0003_publishing.sql  |  Conexoes de canal, publicacoes e tentativas.
-- A idempotencia mora aqui, como constraint, nao como boa intencao.
-- =====================================================================

create type mkt.connection_status as enum ('PENDING','ACTIVE','DEGRADED','REVOKED','EXPIRED');
create type mkt.publication_status as enum ('SCHEDULED','PUBLISHING','PUBLISHED','FAILED','CANCELLED');
create type mkt.attempt_status as enum ('STARTED','SUCCEEDED','FAILED','DEDUPLICATED');

create table mkt.connections (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt.workspaces(id) on delete cascade,
  channel        mkt.channel not null,
  provider       text not null,
  external_account_id text not null,
  display_name   text,
  status         mkt.connection_status not null default 'PENDING',
  -- Segredo NUNCA fica aqui. Guardamos a referencia; o adapter resolve no vault.
  secret_ref     text,
  scopes         text[] not null default '{}',
  expires_at     timestamptz,
  last_checked_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (workspace_id, channel, external_account_id)
);

comment on column mkt.connections.secret_ref is
  'Referencia no secret manager (ADR-005). Token de provider nunca entra em prompt, evidence ou trace.';

create table mkt.publications (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id       uuid not null references mkt.workspaces(id) on delete cascade,
  content_version_id uuid not null references mkt.content_versions(id) on delete cascade,
  channel_variant_id uuid not null references mkt.channel_variants(id) on delete cascade,
  connection_id      uuid not null references mkt.connections(id),
  channel            mkt.channel not null,
  status             mkt.publication_status not null default 'SCHEDULED',
  scheduled_at       timestamptz,
  published_at       timestamptz,
  external_id        text,
  approval_id        uuid,
  autonomy_used      text check (autonomy_used in ('A0','A1','A2','A3','A4')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table mkt.publication_attempts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references mkt.organizations(id) on delete cascade,
  publication_id  uuid not null references mkt.publications(id) on delete cascade,
  attempt_number  integer not null,
  idempotency_key text not null,
  status          mkt.attempt_status not null default 'STARTED',
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
  on mkt.publication_attempts (org_id, idempotency_key);

create index on mkt.publications (workspace_id, status);
create index on mkt.publications (scheduled_at) where status = 'SCHEDULED';
create index on mkt.publication_attempts (publication_id, attempt_number);

select mkt.enable_org_rls('mkt.connections');
select mkt.enable_org_rls('mkt.publications');
select mkt.enable_org_rls('mkt.publication_attempts');
