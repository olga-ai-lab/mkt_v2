-- =====================================================================
-- 0001_iam.sql  |  Tenancy, RBAC e as funcoes que sustentam TODA a RLS.
-- Gate G0: dois tenants criados e leitura cruzada falhando no teste.
-- =====================================================================

create extension if not exists "pgcrypto";

create schema if not exists mkt;

-- ---------------------------------------------------------------------
-- Identidade do ator. No Supabase isto e exatamente o que auth.uid() faz;
-- ler a claim direto mantem o schema portavel e testavel num Postgres local.
-- ---------------------------------------------------------------------
create or replace function mkt.current_user_id() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), ''
  )::uuid
$$;

create type mkt.member_role as enum ('OWNER', 'MARKETING', 'APPROVER');
create type mkt.member_status as enum ('ACTIVE', 'INVITED', 'SUSPENDED');
create type mkt.lifecycle_status as enum ('DRAFT', 'CANDIDATE', 'ACTIVE', 'DEPRECATED', 'BLOCKED');

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
create table mkt.app_users (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  full_name   text,
  created_at  timestamptz not null default now()
);

create table mkt.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table mkt.workspaces (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references mkt.organizations(id) on delete cascade,
  name        text not null,
  timezone    text not null default 'America/Sao_Paulo',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, name)
);

create table mkt.memberships (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references mkt.organizations(id) on delete cascade,
  user_id     uuid not null references mkt.app_users(id) on delete cascade,
  role        mkt.member_role not null,
  status      mkt.member_status not null default 'ACTIVE',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index on mkt.workspaces (org_id);
create index on mkt.memberships (user_id, status);

-- ---------------------------------------------------------------------
-- Predicados de acesso.
-- security definer para que a propria consulta de membership nao caia na RLS
-- (evita recursao). search_path fixo para nao ser sequestrado.
-- ---------------------------------------------------------------------
create or replace function mkt.is_member_of_org(p_org uuid) returns boolean
language sql stable security definer set search_path = mkt, pg_temp
as $$
  select exists (
    select 1 from mkt.memberships m
    where m.org_id = p_org
      and m.user_id = mkt.current_user_id()
      and m.status = 'ACTIVE'
  )
$$;

create or replace function mkt.has_role_in_org(p_org uuid, p_roles mkt.member_role[]) returns boolean
language sql stable security definer set search_path = mkt, pg_temp
as $$
  select exists (
    select 1 from mkt.memberships m
    where m.org_id = p_org
      and m.user_id = mkt.current_user_id()
      and m.status = 'ACTIVE'
      and m.role = any(p_roles)
  )
$$;

create or replace function mkt.org_of_workspace(p_workspace uuid) returns uuid
language sql stable security definer set search_path = mkt, pg_temp
as $$ select w.org_id from mkt.workspaces w where w.id = p_workspace $$;

create or replace function mkt.can_access_workspace(p_workspace uuid) returns boolean
language sql stable security definer set search_path = mkt, pg_temp
as $$ select mkt.is_member_of_org(mkt.org_of_workspace(p_workspace)) $$;

-- ---------------------------------------------------------------------
-- Helper de migracao: liga RLS e aplica a policy padrao de tenant.
-- Toda tabela tenant-owned criada nas migracoes seguintes passa por aqui.
-- ---------------------------------------------------------------------
create or replace function mkt.enable_org_rls(p_table regclass) returns void
language plpgsql as $$
declare t text := p_table::text;
begin
  execute format('alter table %s enable row level security', t);
  execute format('alter table %s force row level security', t);
  execute format($f$
    create policy tenant_read on %s for select
      using (mkt.is_member_of_org(org_id))
  $f$, t);
  execute format($f$
    create policy tenant_write on %s for all
      using (mkt.is_member_of_org(org_id))
      with check (mkt.is_member_of_org(org_id))
  $f$, t);
end $$;

-- ---------------------------------------------------------------------
-- RLS das tabelas de IAM
-- ---------------------------------------------------------------------
alter table mkt.organizations enable row level security;
alter table mkt.organizations force row level security;
create policy org_member_read on mkt.organizations for select
  using (mkt.is_member_of_org(id));
create policy org_owner_write on mkt.organizations for all
  using (mkt.has_role_in_org(id, array['OWNER']::mkt.member_role[]))
  with check (mkt.has_role_in_org(id, array['OWNER']::mkt.member_role[]));

select mkt.enable_org_rls('mkt.workspaces');

alter table mkt.memberships enable row level security;
alter table mkt.memberships force row level security;
create policy membership_read on mkt.memberships for select
  using (mkt.is_member_of_org(org_id));
create policy membership_admin on mkt.memberships for all
  using (mkt.has_role_in_org(org_id, array['OWNER']::mkt.member_role[]))
  with check (mkt.has_role_in_org(org_id, array['OWNER']::mkt.member_role[]));

alter table mkt.app_users enable row level security;
alter table mkt.app_users force row level security;
-- Um usuario ve o proprio registro e o de quem divide organizacao com ele.
create policy user_self_read on mkt.app_users for select
  using (
    id = mkt.current_user_id()
    or exists (
      select 1 from mkt.memberships m1
      join mkt.memberships m2 on m1.org_id = m2.org_id
      where m1.user_id = mkt.current_user_id() and m1.status = 'ACTIVE'
        and m2.user_id = mkt.app_users.id and m2.status = 'ACTIVE'
    )
  );
