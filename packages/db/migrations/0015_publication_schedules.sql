-- =====================================================================
-- 0015_publication_schedules.sql  |  Agendamento recorrente (C3).
--
-- ── O que "recorrente" pode significar aqui, e o que nao pode ───────────
--
-- A tentacao e "republicar o mesmo post toda terca". A state machine da J11
-- nao permite, e isso NAO e limitacao a contornar:
--
--     when 'PUBLISHED' then array[]::text[]
--
-- PUBLISHED e terminal. Uma versao de conteudo publica UMA vez, e o motivo e
-- que a aprovacao e vinculada a versao — republicar sob a mesma aprovacao seria
-- publicar de novo com uma decisao humana que foi tomada uma vez so.
--
-- Entao recorrencia aqui e outra coisa, e e a que o plano editorial (C2) pede:
-- um SLOT no calendario. "Toda terca as 9h sai um post no Instagram." Cada
-- ocorrencia consome a proxima versao APROVADA daquele canal. A cadencia diz
-- QUANDO; o que sai continua sendo conteudo que um humano aprovou, uma vez
-- cada.
--
-- Uma consequencia honesta desse desenho: slot sem conteudo aprovado nao
-- publica nada. Isso e o esperado, nao falha — e por isso `last_outcome`
-- distingue "agendou", "nao havia conteudo" e "a policy bloqueou".
--
-- ── Por que a cadencia e colunas, e nao uma string de cron ──────────────
--
-- Cron e expressivo demais para o que o produto oferece, e a expressividade
-- extra vira superficie de erro: ninguem quer um slot "*/7 * * * *" no
-- calendario de um cliente. Tres cadencias fechadas cobrem o caso e o CHECK
-- garante que cada uma traga o campo que ela exige.
--
-- `at_monthday` para no dia 28 de proposito. Aceitar 31 criaria um slot que
-- some em fevereiro, e "meu post de todo dia 31 nao saiu" e um bug que so
-- aparece em producao, em meses especificos.
-- =====================================================================

create table mkt.publication_schedules (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt.workspaces(id) on delete cascade,
  channel        mkt.channel not null,
  connection_id  uuid not null references mkt.connections(id),

  cadence        text not null check (cadence in ('DAILY','WEEKLY','MONTHLY')),
  at_hour_utc    integer not null check (at_hour_utc between 0 and 23),
  at_weekday     integer check (at_weekday between 0 and 6),
  at_monthday    integer check (at_monthday between 1 and 28),

  active         boolean not null default true,
  next_run_at    timestamptz not null,
  last_run_at    timestamptz,

  -- O resultado da ultima ocorrencia, em tres estados possiveis. NAO e um
  -- reason code: o enum de reason codes e fechado e nenhum deles significa
  -- "nao havia conteudo aprovado". Inventar um para caber aqui contaminaria
  -- o vocabulario que a policy e a microcopy compartilham.
  last_outcome   text check (last_outcome in ('SCHEDULED','NO_CONTENT','BLOCKED')),
  -- Preenchido so quando a policy recusou, e af e um reason code de verdade.
  last_reason_code text,

  created_by     text,
  created_at     timestamptz not null default now(),

  -- Cada cadencia exige exatamente o campo que ela usa, e recusa os outros.
  -- Sem isto, um slot WEEKLY sem at_weekday seria aceito e nunca rodaria no
  -- dia certo — falha silenciosa, que e a pior classe para um agendador.
  constraint cadence_exige_o_proprio_campo check (
    (cadence = 'DAILY'   and at_weekday is null and at_monthday is null) or
    (cadence = 'WEEKLY'  and at_weekday is not null and at_monthday is null) or
    (cadence = 'MONTHLY' and at_monthday is not null and at_weekday is null)
  )
);

comment on table mkt.publication_schedules is
  'Slot recorrente no calendario editorial. Cada ocorrencia consome a proxima versao APROVADA do canal — nao republica a mesma, porque PUBLISHED e terminal e a aprovacao e vinculada a versao.';

comment on column mkt.publication_schedules.last_outcome is
  'SCHEDULED, NO_CONTENT ou BLOCKED. Slot sem conteudo aprovado e estado esperado, nao falha.';

-- O agendador varre por isto a cada passada: so o que esta vencido e ativo.
create index publication_schedules_vencidos
    on mkt.publication_schedules (next_run_at) where active;
create index on mkt.publication_schedules (workspace_id, channel);

select mkt.enable_org_rls('mkt.publication_schedules');
