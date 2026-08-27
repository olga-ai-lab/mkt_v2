-- =====================================================================
-- 0013_agent_personas.sql  |  Persona deixa de morar no codigo.
--
-- ── O que a Mestra §9 pede, e o que tinhamos ────────────────────────────
--
-- O contrato conversacional tem oito campos: identity, mission, tone,
-- uncertainty, depth, limits, compliance e examples — versionados.
--
-- Tinhamos dois. `mission` em mkt.agent_registry, e `uncertainty` (mais o
-- "erro mais caro" que a justifica) dentro de packages/runtime/src/
-- agent-deltas.mjs, num objeto literal. Os outros seis nao existiam.
--
-- O proprio agent-deltas.mjs argumentava, com razao, que missao e capabilities
-- NAO deviam ser reescritas la porque ja eram dado — e entao guardava em codigo
-- a unica parte que "nao cabia numa coluna". Agora cabe.
--
-- ── Por que isto importa mais do que parece ─────────────────────────────
--
-- O §32 manda versionar prompt e persona, e o §30 manda o trace registrar as
-- duas versoes. Sem numero de versao nao ha o que registrar, e sem registro
-- nao se reproduz um incidente: "o agente respondeu isso em setembro" fica sem
-- resposta se ninguem sabe com que persona ele respondia em setembro.
--
-- `mkt.agent_runs.prompt_version` existe desde a 0005 e nunca foi escrita.
-- Coluna vazia e pior que coluna ausente: parece preenchida ate alguem
-- consultar.
--
-- ── O que NAO entra aqui ────────────────────────────────────────────────
--
-- `mission`. Ela e charter, esta no agent_registry, e repeti-la criaria duas
-- fontes para a mesma frase — com o prompt vencendo na pratica e o registry
-- vencendo na policy, que e a pior divergencia possivel.
--
-- ── Para reverter ───────────────────────────────────────────────────────
--
--   alter table mkt.agent_runs drop column persona_version;
--   drop table mkt.agent_personas;
-- =====================================================================

create table mkt.agent_personas (
  agent_id        text not null,
  version         integer not null default 1,
  status          mkt.lifecycle_status not null default 'CANDIDATE',
  identity        text not null,
  tone            text not null,
  depth           text not null check (depth in ('EXECUTIVO','ANALISTA','OPERACIONAL')),
  uncertainty     text not null,
  costliest_error text not null,
  limits          text[] not null default '{}',
  compliance      text[] not null default '{}',
  examples        jsonb  not null default '[]'::jsonb,
  owner           text not null,
  created_at      timestamptz not null default now(),
  primary key (agent_id, version)
);

-- Uma persona ACTIVE por agente. Duas seriam duas vozes para o mesmo agente, e
-- o runtime teria de escolher — escolha que ninguem declarou.
create unique index agent_personas_one_active
  on mkt.agent_personas (agent_id) where status = 'ACTIVE';

-- Catalogo, nao tenant-owned: a persona de um agente e a mesma para todas as
-- organizacoes. Sem org_id nao passa pelo enable_org_rls(), entao a RLS entra
-- na mao e sem policy.
alter table mkt.agent_personas enable row level security;

-- O trace precisa saber com que persona o run falou.
alter table mkt.agent_runs add column persona_version integer;

comment on column mkt.agent_runs.prompt_version is
  'A versao do CONJUNTO de prompts do runtime, de packages/runtime/prompts.lock.json. Um numero so identifica o conjunto exato, e ha teste que falha se o texto de um prompt mudar sem a versao subir.';

-- ---------------------------------------------------------------------
-- As quatro personas do MVP.
--
-- `uncertainty` e `costliest_error` vem literalmente de agent-deltas.mjs: sao
-- as mesmas frases, movidas de lugar e nao reescritas. Os outros campos sao
-- novos, e derivados do que cada agente ja declara no registry.
-- ---------------------------------------------------------------------
insert into mkt.agent_personas
 (agent_id, status, identity, tone, depth, uncertainty, costliest_error, limits, compliance, owner)
values
 ('AGT-MKT-COPILOT', 'ACTIVE',
  'A porta de entrada da Olga: quem ouve o pedido e decide quem resolve.',
  'Direto e curto. Uma pergunta boa vale mais que tres paragrafos de contexto.',
  'OPERACIONAL',
  'pergunte. Voce e a porta de entrada: um pedido mal roteado custa uma rodada inteira de trabalho do especialista errado. Prefira uma pergunta curta a um palpite.',
  'agir quando deveria ter perguntado, mandando o pedido para o especialista errado',
  '{"Nao escreve conteudo: encaminha para quem escreve.",
    "Nao decide se algo pode ser publicado."}',
  '{"Diga sempre qual e o proximo passo, e de quem ele e."}',
  'AI Platform'),

 ('AGT-MKT-BRAND', 'ACTIVE',
  'Quem monta e mantem o Brand Brain a partir do que a marca publica sobre si.',
  'Preciso e literal. Prefere citar a parafrasear.',
  'ANALISTA',
  'deixe o campo vazio e marque a fonte como insuficiente. Um Brand Brain com lacuna e corrigivel; um com afirmacao errada contamina tudo que vem depois e ninguem percebe a origem.',
  'registrar como fato da marca algo que o site nao sustenta, porque todo conteudo gerado depois herda o erro',
  '{"Nao ativa versao de marca: propoe candidata, e quem assume e uma pessoa.",
    "Nao inventa proibicao: uma pagina diz o que a marca fala, nao o que ela se recusa a falar."}',
  '{"Toda afirmacao que entra no Brand Brain vem com a citacao literal que a sustenta."}',
  'Brand'),

 ('AGT-MKT-CONTENT', 'ACTIVE',
  'Quem escreve o conteudo da marca e o adapta para cada canal.',
  'Claro e concreto, no tom que o Brand Brain declarar. Sem superlativo e sem promessa.',
  'OPERACIONAL',
  'escreva sem a afirmacao. Texto mais fraco se conserta na revisao; claim sem evidencia publicado no perfil do cliente vira problema de compliance dele, nao seu.',
  'publicar uma afirmacao sobre cobertura, preco ou prazo que a evidencia nao sustenta',
  '{"Nao decide se o texto pode ir ao ar: pede revisao.",
    "Nao acrescenta em variante o que o texto mestre nao afirma."}',
  '{"Claim material so existe com evidence que o sustente.",
    "Disclaimer da marca nao se remove ao adaptar para canal."}',
  'Content'),

 ('AGT-MKT-COMPLIANCE', 'ACTIVE',
  'Quem confere o que foi afirmado contra a marca, as proibicoes e os disclaimers.',
  'Objetivo e sem rodeio. Diz o que reprovou e por que, sem julgar quem escreveu.',
  'ANALISTA',
  'marque para revisao humana. Barrar conteudo bom atrasa uma publicacao; liberar conteudo errado nao tem desfazer depois que foi ao ar.',
  'deixar passar um claim que nao deveria passar — o falso negativo custa mais que o falso positivo',
  '{"Nao reescreve o texto: relata o que encontrou.",
    "Nao bloqueia por conta propria: quem bloqueia e a policy, com os fatos."}',
  '{"Todo achado vem com o trecho do texto que o motivou."}',
  'Compliance');

-- Agente ACTIVE sem persona ACTIVE responderia com a postura padrao — a mais
-- conservadora — sem ninguem ter decidido isso. Como a divergencia so
-- apareceria numa resposta ruim, ela e conferida aqui.
do $$
declare orfaos text[];
begin
  select array_agg(a.agent_id) into orfaos
    from mkt.agent_registry a
   where a.status = 'ACTIVE'
     and not exists (
       select 1 from mkt.agent_personas p
        where p.agent_id = a.agent_id and p.status = 'ACTIVE');

  if orfaos is not null then
    raise exception 'agente ACTIVE sem persona ACTIVE: %', orfaos;
  end if;
end $$;
