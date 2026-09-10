-- =====================================================================
-- 0011_content_briefs.sql
--
-- O formulario de geracao de conteudo (apps/web/app/content/generate-form.tsx)
-- vira `text` para o Resolver e some: nada do que a pessoa preencheu ficava
-- gravado, so o que o modelo produziu a partir daquilo. Quando um conteudo
-- sair errado, a pergunta "o que foi pedido" nao tinha resposta no banco -
-- so no log de aplicacao, que gira e nao e evidence.
--
-- Esta tabela e a metade que faltava: o PEDIDO, nao a resposta. Ela nao
-- substitui `mkt.contents`/`mkt.content_versions` - e o registro do briefing
-- que originou a chamada ao AGT-MKT-CONTENT, goste ou nao do resultado a
-- chamada.
--
-- ── Por que nao e so uma coluna em content_versions ─────────────────────
--
-- Porque um briefing pode nao virar versao nenhuma: a marca pode nao ter
-- Brand Brain ativo, o agente pode recusar por AMBIGUOUS_ENTITY, o modelo
-- pode falhar. O registro do PEDIDO precisa sobreviver a essas recusas -
-- e por isso content_version_id e nullable e reason_code existe: uma linha
-- sem versao e sem reason_code e a definicao de "ainda rodando"; com
-- reason_code e a definicao de "recusado, e aqui esta o motivo".
--
-- ── Por que nao guarda os args resolvidos (brand_id, etc.) ──────────────
--
-- Porque quem resolve marca, canal e objetivo a partir do texto e o
-- Resolver do loop (LLM), nunca este INSERT. Gravar aqui um brand_id que a
-- rota decidisse sozinha seria abrir o mesmo atalho que o compiler existe
-- para fechar: um id de fora virando argumento sem passar pela resolucao de
-- entidade. brand_name fica como o usuario digitou; a marca de verdade so
-- aparece se e quando content_version_id apontar para um content_versions
-- cujo content aponta para ela.
-- =====================================================================

create table mkt.content_briefs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id       uuid not null references mkt.workspaces(id) on delete cascade,

  -- Como veio do formulario, nao resolvido. Ver nota acima.
  brand_name         text not null,
  objective          text,
  channel            mkt.channel,
  briefing           text,

  submitted_by_actor_id text not null,
  trace_id           text,
  run_id             text,

  -- Preenchidos depois do loop responder. Os dois sao mutuamente exclusivos
  -- na pratica (um resultado ou tem versao ou tem motivo de recusa), mas
  -- nao ha constraint disso: uma corrida em que o processo cai entre o
  -- INSERT e o UPDATE deixa os dois nulos, e essa linha - "pedido feito,
  -- resposta desconhecida" - e um terceiro estado legitimo, nao um bug.
  content_version_id uuid references mkt.content_versions(id) on delete set null,
  reason_code        text,

  created_at         timestamptz not null default now(),
  resolved_at        timestamptz
);

create index on mkt.content_briefs (workspace_id, created_at desc);
create index on mkt.content_briefs (content_version_id) where content_version_id is not null;

select mkt.enable_org_rls('mkt.content_briefs');

comment on table mkt.content_briefs is
  'O pedido que um formulario fez ao AGT-MKT-CONTENT, antes de qualquer resolucao. '
  'content_version_id e reason_code registram o desfecho quando ele chega.';
comment on column mkt.content_briefs.brand_name is
  'Texto livre do formulario, nao um brand_id: quem resolve marca e o Resolver do loop, nao esta tabela.';
