-- =====================================================================
-- 0011_model_ids_reais.sql  |  As rotas apontavam para modelos que nao existem.
--
-- A migration 0006 e a 0007 semearam `mkt.model_routing` com os nomes
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

update mkt.model_routing
   set status = 'DEPRECATED'
 where version = 1
   and task_class in ('reasoning','extraction','classification','copywriting','vision');

insert into mkt.model_routing
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

comment on column mkt.model_routing.primary_target is
  'Identificador REAL do provider. Nome de familia sem versao ("claude-sonnet") nao e aceito pela API: a chamada falha com modelo desconhecido, e falha na primeira vez que alguem roda de verdade.';
