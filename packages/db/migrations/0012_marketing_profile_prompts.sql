-- =====================================================================
-- 0012_marketing_profile_prompts.sql
--
-- Duas coisas que o sistema ainda nao tinha, e que o Hub de Marketing
-- precisa antes de gerar a primeira peca:
--
--   1. mkt.marketing_profiles  — o que a empresa declara sobre si no
--      formulario de onboarding: que tipo de operacao e (corretora,
--      seguradora, MGA...), qual o objetivo comercial, em quais
--      plataformas publica, o que comunica e como comunica.
--
--   2. mkt.prompt_templates    — a biblioteca de prompts da Olga, com
--      variaveis declaradas. O perfil escolhe um template; o CODIGO
--      substitui as variaveis; o agente escreve a partir disso.
--
-- ── O que este perfil NAO guarda, e por que ────────────────────────────
--
-- Nao ha claims_allowed, prohibitions nem disclaimers aqui. Eles moram em
-- mkt.brand_brain_versions e so la, porque sao as afirmacoes que decidem
-- se um conteudo pode existir — e o Brand Brain tem versao, status e
-- promocao humana justamente por isso (0002, 0010).
--
-- Duplicar aqui criaria a pior divergencia possivel: o formulario venceria
-- na geracao enquanto o Brand Brain venceria no compliance.review, e o
-- conteudo seria escrito por uma regra e julgado por outra. O perfil
-- responde "quem eu sou comercialmente e onde publico"; o Brand Brain
-- responde "o que eu posso afirmar". Sao perguntas diferentes.
--
-- ── Por que o template e global, e nao do tenant ───────────────────────
--
-- prompt_templates segue o padrao dos outros registries (0004): leitura
-- para todo autenticado, escrita so por service_role/migracao. Um template
-- que o tenant pudesse editar seria um lugar por onde quem edita uma linha
-- reescreve o comportamento do agente — a mesma razao pela qual o Brand
-- Brain entra no prompt como material e nunca como instrucao de sistema
-- (packages/runtime/src/composer.mjs).
-- =====================================================================

create type mkt.org_type as enum (
  'CORRETORA', 'CORRETOR_AUTONOMO', 'ASSESSORIA', 'SEGURADORA', 'MGA', 'BENEFICIOS'
);

create type mkt.marketing_objective as enum (
  'NOVOS_NEGOCIOS', 'AUTORIDADE', 'MARCA', 'RELACIONAMENTO'
);

-- ---------------------------------------------------------------------
-- O formulario de perfil
-- ---------------------------------------------------------------------
create table mkt.marketing_profiles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt.workspaces(id) on delete cascade,
  brand_id       uuid not null references mkt.brands(id) on delete cascade,

  org_type       mkt.org_type not null,
  objective      mkt.marketing_objective not null,

  -- Plataformas onde a empresa publica. Reusa mkt.channel (0002) de
  -- proposito: se o formulario tivesse a sua propria lista, um canal
  -- aceito aqui poderia nao existir em channel_variants nem em
  -- connections, e o perfil prometeria um destino que o sistema nao sabe
  -- alcancar.
  channels       mkt.channel[] not null,

  o_que_comunica text,
  como_comunica  text,
  publico_alvo   text,

  created_by_actor_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- Um perfil por marca. Duas linhas para a mesma marca seriam duas
  -- estrategias concorrentes, e nada diria qual vale.
  unique (brand_id),

  -- Perfil sem canal nenhum nao e perfil incompleto: e um perfil que
  -- promete publicar em lugar nenhum. Recusar na entrada e melhor que
  -- descobrir na hora de escolher o template.
  constraint profile_tem_canal check (cardinality(channels) >= 1)
);

create index on mkt.marketing_profiles (workspace_id);

select mkt.enable_org_rls('mkt.marketing_profiles');

-- ---------------------------------------------------------------------
-- Os modulos de marketing, por objetivo
-- ---------------------------------------------------------------------
--
-- O Hub mostra, para cada objetivo comercial, o que a plataforma
-- prioriza. Isso e DADO, nao layout: e o mesmo mapa que decide qual
-- template de prompt atende aquele objetivo. Escrito na tela e no banco,
-- um dia divergiria — e a tela venceria aos olhos de quem compra
-- enquanto o banco venceria no que o agente escreve.
create table mkt.marketing_modules (
  objective   mkt.marketing_objective not null,
  module_key  text not null,
  title       text not null,
  description text not null,
  ordem       integer not null default 0,
  primary key (objective, module_key)
);

alter table mkt.marketing_modules enable row level security;
create policy marketing_modules_read on mkt.marketing_modules for select using (true);

-- ---------------------------------------------------------------------
-- A biblioteca de prompts
-- ---------------------------------------------------------------------
--
-- `variables` nao e documentacao: e contrato. O renderizador em
-- packages/runtime/src/prompt-templates.mjs recusa render sem todos os
-- valores declarados, em vez de deixar um {{buraco}} chegar ao modelo ou,
-- pior, virar string vazia — que e como uma instrucao "escreva para
-- {{publico_alvo}}" vira "escreva para " sem ninguem perceber.

-- Os placeholders que o corpo do template realmente usa.
--
-- IMMUTABLE porque e usada num CHECK: o Postgres so aceita constraint
-- sobre funcao imutavel, e uma extracao por regex sobre o proprio texto e
-- imutavel de fato. A mesma gramatica {{ nome }} esta implementada no
-- renderizador do runtime, e ha teste comparando as duas — duas
-- implementacoes da mesma regra so sao seguras enquanto alguem as compara.
create or replace function mkt.prompt_placeholders(p_body text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct m[1]), '{}')
    from regexp_matches(p_body, '\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}', 'g') as m
$$;

create table mkt.prompt_templates (
  template_id  text not null,
  version      integer not null,
  status       mkt.lifecycle_status not null default 'CANDIDATE',

  objective    mkt.marketing_objective not null,
  module_key   text,

  -- Vazio significa "serve a qualquer tipo de operacao". Nulo nao: um
  -- array nulo obrigaria todo SELECT a decidir o que fazer com ele.
  org_types    mkt.org_type[] not null default '{}',

  -- Nulo significa "serve a qualquer canal". Aqui o nulo cabe, porque a
  -- especificidade por canal e justamente o que desempata a escolha.
  channel      mkt.channel,

  formato      text not null,
  body         text not null,
  variables    text[] not null default '{}',

  owner        text,
  created_at   timestamptz not null default now(),

  primary key (template_id, version),

  -- Toda variavel usada no corpo tem de estar declarada, e toda declarada
  -- tem de ser usada. Os dois lados importam: sem o primeiro, o render
  -- descobre a variavel faltando so na frente do modelo; sem o segundo,
  -- o formulario pede um campo que nenhum prompt consome.
  constraint template_declara_o_que_usa check (
    mkt.prompt_placeholders(body) <@ variables
    and variables <@ mkt.prompt_placeholders(body)
  )
);

create index on mkt.prompt_templates (objective, status);

alter table mkt.prompt_templates enable row level security;
create policy prompt_templates_read on mkt.prompt_templates for select using (true);

comment on table mkt.prompt_templates is
  'Biblioteca de prompts da plataforma. Global e somente-leitura para o tenant: '
  'um template editavel pelo cliente seria uma porta para reescrever o agente.';
comment on column mkt.prompt_templates.variables is
  'Contrato do template. O renderizador recusa valor faltando em vez de render buraco.';

-- ---------------------------------------------------------------------
-- Qual template escreveu cada versao
-- ---------------------------------------------------------------------
--
-- Mesma razao de brand_brain_version_id e agent_id estarem nesta tabela
-- (0002): quando um texto publicado se revela errado, a pergunta e "de
-- onde veio isso". Sem esta coluna, um template ruim so seria descoberto
-- lendo peca por peca — e nao haveria como recolher o que ele produziu.
--
-- Sem FK para prompt_templates de proposito: a versao gravada precisa
-- sobreviver ao template ser removido da biblioteca. Um rastro que some
-- quando alguem limpa o catalogo nao e rastro.
alter table mkt.content_versions
  add column prompt_template_id      text,
  add column prompt_template_version integer;

comment on column mkt.content_versions.prompt_template_id is
  'Template que gerou este texto. NULL em versao escrita sem perfil configurado.';
