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

-- ─── 0012_marketing_profile_prompts.sql ──────────────────────────

-- =====================================================================
-- 0012_marketing_profile_prompts.sql
--
-- Duas coisas que o sistema ainda nao tinha, e que o Hub de Marketing
-- precisa antes de gerar a primeira peca:
--
--   1. mkt_v2.marketing_profiles  — o que a empresa declara sobre si no
--      formulario de onboarding: que tipo de operacao e (corretora,
--      seguradora, MGA...), qual o objetivo comercial, em quais
--      plataformas publica, o que comunica e como comunica.
--
--   2. mkt_v2.prompt_templates    — a biblioteca de prompts da Olga, com
--      variaveis declaradas. O perfil escolhe um template; o CODIGO
--      substitui as variaveis; o agente escreve a partir disso.
--
-- ── O que este perfil NAO guarda, e por que ────────────────────────────
--
-- Nao ha claims_allowed, prohibitions nem disclaimers aqui. Eles moram em
-- mkt_v2.brand_brain_versions e so la, porque sao as afirmacoes que decidem
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

create type mkt_v2.org_type as enum (
  'CORRETORA', 'CORRETOR_AUTONOMO', 'ASSESSORIA', 'SEGURADORA', 'MGA', 'BENEFICIOS'
);

create type mkt_v2.marketing_objective as enum (
  'NOVOS_NEGOCIOS', 'AUTORIDADE', 'MARCA', 'RELACIONAMENTO'
);

-- ---------------------------------------------------------------------
-- O formulario de perfil
-- ---------------------------------------------------------------------
create table mkt_v2.marketing_profiles (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt_v2.organizations(id) on delete cascade,
  workspace_id   uuid not null references mkt_v2.workspaces(id) on delete cascade,
  brand_id       uuid not null references mkt_v2.brands(id) on delete cascade,

  org_type       mkt_v2.org_type not null,
  objective      mkt_v2.marketing_objective not null,

  -- Plataformas onde a empresa publica. Reusa mkt_v2.channel (0002) de
  -- proposito: se o formulario tivesse a sua propria lista, um canal
  -- aceito aqui poderia nao existir em channel_variants nem em
  -- connections, e o perfil prometeria um destino que o sistema nao sabe
  -- alcancar.
  channels       mkt_v2.channel[] not null,

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

create index on mkt_v2.marketing_profiles (workspace_id);

select mkt_v2.enable_org_rls('mkt_v2.marketing_profiles');

-- ---------------------------------------------------------------------
-- Os modulos de marketing, por objetivo
-- ---------------------------------------------------------------------
--
-- O Hub mostra, para cada objetivo comercial, o que a plataforma
-- prioriza. Isso e DADO, nao layout: e o mesmo mapa que decide qual
-- template de prompt atende aquele objetivo. Escrito na tela e no banco,
-- um dia divergiria — e a tela venceria aos olhos de quem compra
-- enquanto o banco venceria no que o agente escreve.
create table mkt_v2.marketing_modules (
  objective   mkt_v2.marketing_objective not null,
  module_key  text not null,
  title       text not null,
  description text not null,
  ordem       integer not null default 0,
  primary key (objective, module_key)
);

alter table mkt_v2.marketing_modules enable row level security;
create policy marketing_modules_read on mkt_v2.marketing_modules for select using (true);

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
create or replace function mkt_v2.prompt_placeholders(p_body text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct m[1]), '{}')
    from regexp_matches(p_body, '\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}', 'g') as m
$$;

create table mkt_v2.prompt_templates (
  template_id  text not null,
  version      integer not null,
  status       mkt_v2.lifecycle_status not null default 'CANDIDATE',

  objective    mkt_v2.marketing_objective not null,
  module_key   text,

  -- Vazio significa "serve a qualquer tipo de operacao". Nulo nao: um
  -- array nulo obrigaria todo SELECT a decidir o que fazer com ele.
  org_types    mkt_v2.org_type[] not null default '{}',

  -- Nulo significa "serve a qualquer canal". Aqui o nulo cabe, porque a
  -- especificidade por canal e justamente o que desempata a escolha.
  channel      mkt_v2.channel,

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
    mkt_v2.prompt_placeholders(body) <@ variables
    and variables <@ mkt_v2.prompt_placeholders(body)
  )
);

create index on mkt_v2.prompt_templates (objective, status);

alter table mkt_v2.prompt_templates enable row level security;
create policy prompt_templates_read on mkt_v2.prompt_templates for select using (true);

comment on table mkt_v2.prompt_templates is
  'Biblioteca de prompts da plataforma. Global e somente-leitura para o tenant: '
  'um template editavel pelo cliente seria uma porta para reescrever o agente.';
comment on column mkt_v2.prompt_templates.variables is
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
alter table mkt_v2.content_versions
  add column prompt_template_id      text,
  add column prompt_template_version integer;

comment on column mkt_v2.content_versions.prompt_template_id is
  'Template que gerou este texto. NULL em versao escrita sem perfil configurado.';


-- ─── 0013_seed_marketing_prompts.sql ─────────────────────────────

-- =====================================================================
-- 0013_seed_marketing_prompts.sql
--
-- Os modulos por objetivo e a biblioteca inicial de prompts.
--
-- Separado de 0012 pela mesma razao que 0006 e separado de 0004:
-- estrutura e conteudo governado mudam por motivos diferentes e em
-- ritmos diferentes. Um template novo nao deveria exigir DDL.
--
-- ── Sobre o status dos templates ──────────────────────────────────────
--
-- Todos entram ACTIVE. Diferente de agente e capability, um template de
-- prompt nao autoriza nada: ele so descreve o que escrever, e o que ele
-- escreve continua passando por claims, quality.precheck, policy e
-- aprovacao humana antes de existir como publicacao. O gate esta depois,
-- nao aqui.
--
-- ── Sobre o texto dos templates ───────────────────────────────────────
--
-- Nenhum deles manda afirmar cobertura, preco ou prazo. Isso e
-- deliberado: o redator recusa claim material sem evidence
-- (CLAIM_UNSUPPORTED), entao um template que pedisse "destaque nossa
-- cobertura de X" produziria recusa em vez de conteudo. Os templates
-- pedem angulo, formato e publico — nunca a afirmacao.
--
-- O corpo vai em dollar-quoting ($tpl$): o texto tem quebra de linha e
-- aspas, e escapar isso a mao e o tipo de coisa que passa despercebida
-- em revisao.
-- =====================================================================

insert into mkt_v2.marketing_modules (objective, module_key, title, description, ordem) values
  ('NOVOS_NEGOCIOS', 'planejamento_pipeline', 'Planejamento por pipeline',
   'O calendario prioriza temas de dor, solucao e prova, com CTA consultiva no fim de cada peca.', 1),
  ('NOVOS_NEGOCIOS', 'conteudo_por_publico', 'Conteudo por publico',
   'Cada segmento recebe linguagem, exemplos e produtos associados na configuracao.', 2),
  ('NOVOS_NEGOCIOS', 'captacao_distribuicao', 'Captacao e distribuicao',
   'Publicacao nos seus canais e materiais de apoio para o time comercial.', 3),

  ('AUTORIDADE', 'pilares_editoriais', 'Pilares editoriais',
   'Distribuicao percentual que faz educacao e analise ocuparem o peso certo na agenda.', 1),
  ('AUTORIDADE', 'biblioteca_inteligente', 'Biblioteca inteligente',
   'Historico organizado por tema, publico e status, pronto para reuso e aprofundamento.', 2),
  ('AUTORIDADE', 'series_recorrencia', 'Series e recorrencia',
   'Temas que voltam com cadencia definida em vez de posts avulsos.', 3),

  ('MARCA', 'posicionamento_aplicado', 'Posicionamento aplicado',
   'Proposta de valor e atributos de percepcao entram em toda peca produzida.', 1),
  ('MARCA', 'tom_de_voz_travado', 'Tom de voz travado',
   'Estilos, tons e palavras proibidas viram regra editorial, nao sugestao.', 2),
  ('MARCA', 'consistencia_entre_canais', 'Consistencia entre canais',
   'A mesma historia em site, redes e materiais comerciais.', 3),

  ('RELACIONAMENTO', 'conteudo_de_servico', 'Conteudo de servico',
   'Orientacao, prevencao e uso da apolice para a base ativa de clientes.', 1),
  ('RELACIONAMENTO', 'regua_de_contato', 'Regua de contato',
   'Cadencia de relacionamento planejada junto com o calendario editorial.', 2),
  ('RELACIONAMENTO', 'renovacao_retencao', 'Renovacao e retencao',
   'Temas ligados ao ciclo da carteira em vez de campanhas isoladas.', 3);

-- ---------------------------------------------------------------------
-- A capability passa a poder falhar por motivos novos
-- ---------------------------------------------------------------------
--
-- content.create_draft agora aplica o perfil de marketing, e com isso
-- ganha tres recusas que antes nao existiam:
--
--   AMBIGUOUS_GOAL           marca com estrategia, peca sem tema
--   UNSUPPORTED_VALUE        nao ha template para aquele objetivo/canal
--   SCHEMA_VALIDATION_FAILED template incoerente com o que declara
--
-- Declarar no registry nao e burocracia: o registry e o que a policy e a
-- microcopy leem. Uma capability que recusa por um codigo que o registry
-- nao lista age por uma regra e e julgada por outra — que e a divergencia
-- que este projeto mais evita.
--
-- Os tres codigos ja existem no enum fechado de reason codes; nenhum
-- codigo novo entra aqui.
update mkt_v2.capability_registry
   set error_codes = error_codes
                   || '{AMBIGUOUS_GOAL,UNSUPPORTED_VALUE,SCHEMA_VALIDATION_FAILED}'::text[]
 where capability_id = 'content.create_draft';

-- ---------------------------------------------------------------------
-- Templates base: um por objetivo, sem canal (servem a qualquer um).
-- ---------------------------------------------------------------------
insert into mkt_v2.prompt_templates
  (template_id, version, status, objective, module_key, org_types, channel, formato, body, variables, owner)
values
  ('PT-NOVOS-NEGOCIOS-BASE', 1, 'ACTIVE', 'NOVOS_NEGOCIOS', 'conteudo_por_publico', '{}', null, 'Post',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e gerar novas oportunidades comerciais.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Estruture em torno de uma dor concreta que esse publico reconhece, o caminho para
resolve-la e um convite a conversar. Nao prometa cobertura, preco ou prazo:
descreva o problema e o criterio de decisao, nao o produto.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga'),

  ('PT-AUTORIDADE-BASE', 1, 'ACTIVE', 'AUTORIDADE', 'pilares_editoriais', '{}', null, 'Artigo',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e construir autoridade tecnica.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Explique o mecanismo, nao so a conclusao: quem le tem de terminar entendendo por
que a coisa funciona assim. Prefira precisao a entusiasmo. Onde faltar dado para
sustentar uma afirmacao, escreva sem ela.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga'),

  ('PT-MARCA-BASE', 1, 'ACTIVE', 'MARCA', 'posicionamento_aplicado', '{}', null, 'Post',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e fortalecer a percepcao de marca.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

A peca deve soar como essa empresa e nao como qualquer outra do setor. Escolha um
angulo que so ela poderia assinar. Evite superlativo: o que diferencia aparece no
criterio que ela usa, nao no adjetivo que ela escolhe.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga'),

  ('PT-RELACIONAMENTO-BASE', 1, 'ACTIVE', 'RELACIONAMENTO', 'conteudo_de_servico', '{}', null, 'Post',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e servir quem ja e cliente.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Escreva para quem ja comprou: orientacao pratica, prevencao, como usar o que ja se
tem. Nao venda de novo o que a pessoa ja contratou.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga');

-- ---------------------------------------------------------------------
-- Templates por canal: mais especificos, vencem o base na escolha.
-- ---------------------------------------------------------------------
insert into mkt_v2.prompt_templates
  (template_id, version, status, objective, module_key, org_types, channel, formato, body, variables, owner)
values
  ('PT-AUTORIDADE-LINKEDIN', 1, 'ACTIVE', 'AUTORIDADE', 'pilares_editoriais', '{}', 'LINKEDIN', 'Artigo',
$tpl$Escreva para {{brand_name}} publicar no LinkedIn.
Publico: {{publico_alvo}}.
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Abra com a afirmacao mais util do texto, nao com contexto. Paragrafos curtos. Uma
ideia por paragrafo. Termine com a pergunta que voce genuinamente faria a quem
trabalha com isso — nao com pedido de engajamento.$tpl$,
   '{brand_name,publico_alvo,como_comunica,briefing}',
   'olga'),

  ('PT-RELACIONAMENTO-INSTAGRAM', 1, 'ACTIVE', 'RELACIONAMENTO', 'conteudo_de_servico', '{}', 'INSTAGRAM', 'Carrossel',
$tpl$Escreva para {{brand_name}} publicar no Instagram, em formato de carrossel.
Publico: {{publico_alvo}}.
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Cada tela precisa fazer sentido sozinha e puxar a proxima. Primeira tela: o
problema em uma frase. Ultimas: o que fazer na pratica. Linguagem direta, sem
jargao de seguro que o cliente final nao usa.$tpl$,
   '{brand_name,publico_alvo,como_comunica,briefing}',
   'olga');


-- Controle de versao das migrations, para o runner reconhecer o que ja rodou.
create table if not exists mkt_v2.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Nenhuma tabela do schema fica alcancavel pela anon key, nem o ledger do runner.
alter table mkt_v2.schema_migrations enable row level security;
insert into mkt_v2.schema_migrations (name) values
  ('0012_marketing_profile_prompts.sql'),
  ('0013_seed_marketing_prompts.sql')
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = 'mkt_v2';
--   select capability_id, status from mkt_v2.capability_registry order by 1;
