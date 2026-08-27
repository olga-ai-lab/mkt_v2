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

-- ─── 0015_entity_aliases.sql ─────────────────────────────────────

-- =====================================================================
-- 0015_entity_aliases.sql  |  Quem resolve "a Ipe" para um id deixa de ser o modelo.
--
-- ── O buraco ────────────────────────────────────────────────────────────
--
-- A Mestra §13 e explicita: "Entity Resolution usa registry/aliases/IDs e nao
-- fuzzy matching irrestrito". O contrato olga://io/entity-resolution existe
-- desde a Fase 0, com metodos e reason codes — e NADA o implementa. Um `grep`
-- por ele no codigo nao devolve uma linha.
--
-- Na pratica, quem preenche `canonical_id` hoje e o LLM, dentro do
-- IntentResolution. Um modelo nao tem como saber um uuid. Entao ou ele devolve
-- null — e todo pedido que nomeia uma marca morre em CLARIFICATION_REQUIRED —
-- ou ele inventa um, e a recusa que vem depois e por acidente, quando o SELECT
-- nao acha a linha.
--
-- Os evals nao pegaram porque substituem `__BRAND__` pelo id real do fixture
-- antes de rodar. O caminho que eles aprovam nao e o que um cliente percorre.
--
-- ── O que entra ─────────────────────────────────────────────────────────
--
-- Uma tabela de apelidos, e uma funcao de normalizacao usada nos DOIS lados da
-- comparacao. Sem a funcao, o apelido gravado com acento nunca casaria com o
-- texto digitado sem — e a normalizacao feita so na aplicacao divergiria do
-- indice que garante unicidade.
--
-- ── O indice unico e a regra, nao a otimizacao ──────────────────────────
--
-- `(org_id, entity_type, alias_norm)` unico significa que um apelido nunca
-- resolve para duas coisas na mesma organizacao. Isso NAO e conveniencia: e o
-- que permite tratar apelido como chave natural em vez de palpite. Sem ele, a
-- resolucao teria de escolher entre dois candidatos, e escolher e o que o §13
-- proibe.
--
-- Fuzzy continua proibido. Aqui so ha igualdade — depois de normalizar caixa,
-- acento e espaco, que nao e aproximacao e sim a mesma palavra escrita de
-- outro jeito.
--
-- ── Para reverter ───────────────────────────────────────────────────────
--
--   drop table mkt_v2.entity_aliases;
--   drop function mkt_v2.norm(text);
-- =====================================================================

-- Normalizacao sem extensao: `unaccent` exigiria CREATE EXTENSION, que num
-- Supabase gerenciado e permissao que nem todo projeto tem. `translate` resolve
-- o portugues, que e o idioma deste produto.
create or replace function mkt_v2.norm(t text) returns text
language sql immutable strict as $$
  select btrim(regexp_replace(
           lower(translate(t,
             'áàâãäéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ',
             'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
           '\s+', ' ', 'g'))
$$;

comment on function mkt_v2.norm(text) is
  'Texto comparavel: minusculas, sem acento, espaco colapsado e aparado. Usada nos DOIS lados de toda comparacao de nome — no indice de apelidos e na busca por chave natural. Normalizar so de um lado e o jeito de nunca encontrar nada.';

create table mkt_v2.entity_aliases (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references mkt_v2.organizations(id) on delete cascade,
  entity_type         text not null check (entity_type in ('brand','content_version','channel')),
  canonical_id        text not null,
  alias               text not null,
  created_by_actor_id text,
  created_at          timestamptz not null default now()
);

-- Um apelido nunca resolve para duas coisas na mesma organizacao. E esta linha
-- que transforma apelido em chave natural em vez de palpite.
create unique index entity_aliases_unicos
  on mkt_v2.entity_aliases (org_id, entity_type, mkt_v2.norm(alias));

create index entity_aliases_por_alvo
  on mkt_v2.entity_aliases (org_id, entity_type, canonical_id);

select mkt_v2.enable_org_rls('mkt_v2.entity_aliases');

-- Buscar marca por nome tambem passa pela mesma funcao; sem indice, cada
-- resolucao viraria um seq scan em toda marca da organizacao.
create index brands_por_nome on mkt_v2.brands (org_id, mkt_v2.norm(name));
create index contents_por_titulo on mkt_v2.contents (org_id, mkt_v2.norm(title));

-- A normalizacao e a regra, entao ela e verificada aqui e nao so no teste: se
-- esta funcao mudar de comportamento, a migration recusa antes de o indice
-- unico passar a significar outra coisa.
do $$
begin
  if mkt_v2.norm('  Corretora   IPÊ ') <> 'corretora ipe' then
    raise exception 'mkt_v2.norm nao esta aparando e colapsando espaco: "%"',
      mkt_v2.norm('  Corretora   IPÊ ');
  end if;
  if mkt_v2.norm('IPÊ') <> mkt_v2.norm('ipe') then
    raise exception 'mkt_v2.norm nao esta normalizando acento e caixa';
  end if;
end $$;


-- ─── 0016_safety_trace.sql ───────────────────────────────────────

-- =====================================================================
-- 0016_safety_trace.sql  |  A linha Safety do trace, que nao existia.
--
-- ── O que a Mestra pede ─────────────────────────────────────────────────
--
-- §30 lista o que todo run tem de deixar registrado, e uma das linhas e
-- *Safety*: policy blocks, sinais de injecao e redacao de PII. As outras
-- linhas foram preenchidas na 0013 (Versions) e na 0007/0013 (Performance).
-- Esta ficou.
--
-- ── Por que isso nao e telemetria opcional ──────────────────────────────
--
-- A defesa contra injecao neste sistema e ESTRUTURAL: o texto do usuario entra
-- na sexta camada de contexto, nunca na de sistema, e os argumentos de toda
-- chamada nascem no compiler e nao no modelo. Isso e forte, e e a coisa certa.
--
-- Mas e silenciosa. Se um dia ela falhar, nada no banco diz que alguem tentou.
-- O `COPILOT-ADV-001` prova que uma injecao conhecida nao vira instrucao — e
-- prova isso em teste, uma vez, contra um texto que nos mesmos escrevemos.
-- Producao nao tem eval.
--
-- Entao entram tres colunas, e elas registram; nao bloqueiam. Um regex que
-- bloqueia e um regex que autoriza, e "o LLM interpreta, os contratos decidem"
-- vale tambem para as heuristicas: quem bloqueia e a policy, que e dado tipado
-- e revisavel.
--
-- ── PII: a 0012 declarou e ninguem aplicou ──────────────────────────────
--
-- `mkt_v2.source_contracts.carries_pii` existe desde a 0012. O caveat do
-- UPLOADED_FILE diz, com todas as letras, "e a que recebe documento sem passar
-- por nenhum filtro nosso". A declaracao estava certa e o filtro nao existia:
-- o texto de uma evidence dessa fonte ia inteiro para o contexto do modelo.
--
-- `pii_redacted` conta o que foi apagado antes de o texto sair daqui. Zero e
-- diferente de nulo: zero diz "olhei e nao havia"; nulo diz "nao olhei".
--
-- ── A coluna que NAO entra, e por que ───────────────────────────────────
--
-- "Policy blocks" quase virou um contador aqui. Nao virou, e a razao vale mais
-- que a coluna: o loop PARA no primeiro bloqueio, entao o contador so poderia
-- valer 0 ou 1 — e `respondability = 'POLICY_BLOCKED'` ja diz exatamente isso,
-- na mesma linha. Seria a mesma verdade escrita duas vezes, que e o
-- anti-pattern do §47 e o jeito de um dia as duas discordarem.
--
-- O que a policy de fato NAO deixava no trace era QUAL regra decidiu.
-- `evaluate()` devolve `policy_versions` — policy_id e version de cada policy
-- aplicada —, o contrato RespondabilityResult exige o campo desde a Fase 0, e
-- nada nunca o gravou. Num incidente a pergunta e "que regra barrou isso, na
-- versao de qual dia", e ate aqui a resposta era re-derivar pelo escopo.
--
-- Isso tambem fecha a metade que faltava da §32 no trace: versoes de rules.
--
-- ── Para reverter ───────────────────────────────────────────────────────
--
--   alter table mkt_v2.agent_runs
--     drop column policy_versions, drop column injection_signals,
--     drop column pii_redacted;
-- =====================================================================

alter table mkt_v2.agent_runs
  add column policy_versions   jsonb,
  add column injection_signals text[],
  add column pii_redacted      integer;

comment on column mkt_v2.agent_runs.policy_versions is
  'Qual regra decidiu este run, e em que versao: [{policy_id, version}]. Vem do `policy_versions` que evaluate() ja devolvia e que ninguem gravava. Nulo = o run parou antes de haver passo para avaliar; array vazio = avaliou e nenhuma policy casou (leitura segue sem policy explicita; escrita nesse caso e NO_ACTIVE_POLICY). A diferenca importa: um run que nunca chegou a policy nao e um run que a policy aprovou.';

comment on column mkt_v2.agent_runs.injection_signals is
  'Padroes de tentativa de injecao encontrados no texto NAO confiavel deste run. Registra, nao bloqueia: um regex que bloqueia e um regex que autoriza, e quem autoriza aqui e a policy. Serve para responder "isso ja tinha acontecido antes?" depois de um incidente — pergunta que hoje nao tem resposta.';

comment on column mkt_v2.agent_runs.pii_redacted is
  'Quantos trechos de PII foram apagados antes de o texto entrar no contexto do modelo. Zero e diferente de nulo: zero diz "olhei e nao havia", nulo diz "nao olhei".';

-- "Isso ja tinha acontecido antes?" respondida por indice, e nao por scan da
-- tabela inteira de runs.
create index agent_runs_sinais
  on mkt_v2.agent_runs (org_id, started_at desc)
  where injection_signals is not null and cardinality(injection_signals) > 0;

do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'mkt' and table_name = 'agent_runs'
     and column_name in ('policy_versions','injection_signals','pii_redacted');
  if n <> 3 then
    raise exception 'a linha Safety do trace nao ficou completa (% de 3 colunas)', n;
  end if;
end $$;


-- Controle de versao das migrations, para o runner reconhecer o que ja rodou.
create table if not exists mkt_v2.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Nenhuma tabela do schema fica alcancavel pela anon key, nem o ledger do runner.
alter table mkt_v2.schema_migrations enable row level security;
insert into mkt_v2.schema_migrations (name) values
  ('0015_entity_aliases.sql'),
  ('0016_safety_trace.sql')
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = 'mkt_v2';
--   select capability_id, status from mkt_v2.capability_registry order by 1;
