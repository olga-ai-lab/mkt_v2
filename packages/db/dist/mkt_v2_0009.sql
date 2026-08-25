-- =====================================================================
-- Olga Marketing OS — schema mkt_v2
--
-- Bundle das 1 migrations, geradas a partir de packages/db/migrations/.
-- NAO EDITAR: regenere com  MKT_SCHEMA=mkt_v2 node packages/db/scripts/bundle.mjs
--
-- Aplicar: cole no SQL Editor do Supabase e execute uma vez.
-- Tudo roda numa transacao: ou entra inteiro, ou nao entra nada.
--
-- Reverter:  drop schema mkt_v2 cascade;
-- =====================================================================

begin;

-- ─── 0009_promote_copilot.sql ────────────────────────────────────

-- =====================================================================
-- 0009_promote_copilot.sql  |  Primeira promocao de agente para ACTIVE.
--
-- Promover um agente e ato de governanca, nao passo tecnico. Esta migration
-- existe para que a decisao fique no historico, com o motivo junto — e nao
-- como um UPDATE solto que alguem rodou no SQL Editor e ninguem lembra.
--
-- ── Por que o COPILOT, e nao outro ───────────────────────────────────────
--
-- Ele e o unico dos quatro em que a promocao nao amplia superficie de efeito:
--
--   modes         {read,simulate}   nao escreve
--   capabilities  brand.read, evidence.read, quality.precheck   as tres leem
--   autonomia     A1 -> A2          nunca chega em GOVERNED_EXECUTE
--
-- Ou seja: um COPILOT ACTIVE pode interpretar, consultar e explicar. Ele nao
-- cria conteudo, nao agenda e nao publica. Se algo der errado ali, o custo e
-- uma resposta ruim — nao um post no perfil do cliente.
--
-- Os outros tres continuam CANDIDATE de proposito. CONTENT e BRAND tem
-- capability de escrita, e promove-los e uma decisao separada, que merece a
-- propria migration e o proprio motivo. COMPLIANCE e o proximo natural, por
-- ser somente-leitura como este — mas nao ha razao para promover dois de uma
-- vez quando um ja ensina o que precisa ser aprendido em operacao.
--
-- ── Em que a decisao se apoia ────────────────────────────────────────────
--
-- Nos evals de packages/runtime/evals/AGT-MKT-COPILOT.json, rodados contra
-- este mesmo banco por packages/db/test/evals.test.mjs: um caso golden e
-- quatro adversariais, cobrindo injecao no texto do usuario, referencia que
-- nao resolve, ambiguidade material e tenant devolvido pelo modelo.
--
-- Os evals medem governanca, nao qualidade de texto. A qualidade continua
-- dependendo do golden dataset da Fase 2, construido com as corretoras
-- piloto (MKT-17, achado G11). Esta promocao NAO antecipa aquilo: ela libera
-- um agente que so le.
--
-- ── Para reverter ────────────────────────────────────────────────────────
--
--   update mkt_v2.agent_registry set status = 'CANDIDATE'
--    where agent_id = 'AGT-MKT-COPILOT' and version = 1;
-- =====================================================================

update mkt_v2.agent_registry
   set status = 'ACTIVE'
 where agent_id = 'AGT-MKT-COPILOT'
   and version = 1
   and status = 'CANDIDATE';

-- Se a linha nao existir ou ja tiver sido promovida, o update acima nao faz
-- nada e a migration segue. O que NAO pode passar em silencio e promover algo
-- que escreve: isto aqui derruba a transacao se um agente com capability de
-- escrita estiver ACTIVE.
do $$
declare escritores text[];
begin
  select array_agg(agent_id) into escritores
    from mkt_v2.agent_registry
   where status = 'ACTIVE'
     and (capabilities && array['content.create_draft','content.create_variant',
                                'publishing.publish','publishing.schedule',
                                'approval.request','brand.propose_version',
                                'brand.extract_from_url','channel.connect']);
  if escritores is not null then
    raise exception 'agente com capability de escrita esta ACTIVE: %. Promover um deles exige migration propria e motivo proprio.', escritores;
  end if;
end $$;

comment on table mkt_v2.agent_registry is
  'Agente nasce CANDIDATE. Promover para ACTIVE e ato de governanca e entra por migration, com o motivo junto.';


-- Controle de versao das migrations, para o runner reconhecer o que ja rodou.
create table if not exists mkt_v2.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Nenhuma tabela do schema fica alcancavel pela anon key, nem o ledger do runner.
alter table mkt_v2.schema_migrations enable row level security;
insert into mkt_v2.schema_migrations (name) values
  ('0009_promote_copilot.sql')
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = 'mkt_v2';
--   select capability_id, status from mkt_v2.capability_registry order by 1;
