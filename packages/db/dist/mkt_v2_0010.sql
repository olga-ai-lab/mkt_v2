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

-- ─── 0010_brand_extraction.sql ───────────────────────────────────

-- =====================================================================
-- 0010_brand_extraction.sql  |  brand.extract_from_url passa a extrair.
--
-- A Fase 2 comeca por esta capability: e por ela que uma corretora que nunca
-- usou o produto ganha um Brand Brain a partir do proprio site, sem formulario.
--
-- ── O que estava errado, e nao era o adapter ────────────────────────────
--
-- `provider_adapter` era 'web_fetch'. Aquele adapter busca a pagina com toda a
-- defesa de SSRF e devolve { texto, hash, url_final } — sem a chave `output`,
-- que e a unica que o gateway entrega ao chamador. A pagina era buscada e o
-- texto era jogado fora. A capability chamada "extract" nao extraia nada.
--
-- Agora ela aponta para 'brand_extract', que compoe as duas metades: delega a
-- busca ao web_fetch (que continua sendo o unico lugar que fala com a rede),
-- delega a leitura a uma porta de modelo (que e quem conhece o Model Gateway),
-- e faz o que nenhum dos dois faz sozinho — conferir que cada claim e cada
-- disclaimer propostos tem citacao literal na pagina, e assinar a procedencia.
--
-- ── output_schema_ref deixa de ser 'execution-result' ───────────────────
--
-- Enquanto o ref for o proprio envelope de execucao, o gateway nao confere
-- nada: quem monta o envelope e ele mesmo. Uma capability que existe pelo que
-- DEVOLVE precisa declarar o contrato do que devolve, ou a saida do adapter
-- passa direto — foi assim que `output_schema_ref` ficou tres migrations sendo
-- decoracao.
--
-- olga://io/brand-proposal exige source_refs com pelo menos uma fonte e fecha
-- prohibitions em maxItems: 0. As duas coisas sao regra, nao formalidade:
-- proposta sem fonte nao e proposta, e proibicao nao se le de um site — uma
-- pagina diz o que a marca fala, nao o que ela se recusa a falar. Quem preenche
-- proibicao e a pessoa que revisa o CANDIDATE.
--
-- ── error_codes passa a dizer a verdade ────────────────────────────────
--
-- Estava {SOURCE_STALE, PROVIDER_UNAVAILABLE}. SOURCE_STALE sai: nada nesta
-- capability o emite — quem julga idade de fonte e o retrieval, no Validator do
-- loop. Entram os codigos que a cadeia realmente produz, incluindo os do Model
-- Gateway, que agora faz parte dela.
--
-- ── Por que nao e uma versao 2 ─────────────────────────────────────────
--
-- Deveria ser. O loop chama registry.getCapability(capability_id, 1) com o 1
-- literal: uma v2 ACTIVE seria escrita no registry e ignorada em execucao, o
-- que e pior que nao versionar. Como nenhum chamador depende da saida antiga
-- (ela era sempre null), atualizar a v1 nao quebra contrato de ninguem.
--
-- Fica registrado como divida, e nao como decisao: enquanto a versao pedida for
-- constante no codigo, versionar capability e um mecanismo que existe no schema
-- e nao funciona na pratica.
--
-- ── Para reverter ──────────────────────────────────────────────────────
--
--   update mkt_v2.capability_registry
--      set provider_adapter = 'web_fetch',
--          output_schema_ref = 'olga://io/execution-result',
--          error_codes = '{SOURCE_STALE,PROVIDER_UNAVAILABLE}'
--    where capability_id = 'brand.extract_from_url' and version = 1;
-- =====================================================================

update mkt_v2.capability_registry
   set provider_adapter  = 'brand_extract',
       output_schema_ref = 'olga://io/brand-proposal',
       error_codes = '{UNSUPPORTED_VALUE,EVIDENCE_INSUFFICIENT,NORMALIZATION_FAILED,
                       SCHEMA_VALIDATION_FAILED,PROVIDER_UNAVAILABLE,PROVIDER_RATE_LIMITED,
                       MODEL_ROUTE_NOT_ACTIVE,MODEL_OUTPUT_INVALID,
                       BUDGET_NOT_CONFIGURED,SPEND_LIMIT_EXCEEDED}'
 where capability_id = 'brand.extract_from_url'
   and version = 1;

-- A migration nao pode passar em silencio se a linha nao existir: o registry e
-- o contrato, e um UPDATE que casa zero linhas aqui significa que o schema
-- aplicado nao e o que este repositorio descreve.
do $$
declare n integer;
begin
  select count(*) into n
    from mkt_v2.capability_registry
   where capability_id = 'brand.extract_from_url'
     and version = 1
     and provider_adapter = 'brand_extract'
     and output_schema_ref = 'olga://io/brand-proposal';

  if n <> 1 then
    raise exception
      'brand.extract_from_url v1 nao ficou apontada para brand_extract (linhas: %). '
      'O registry aplicado diverge das migrations deste repositorio.', n;
  end if;
end $$;

comment on column mkt_v2.capability_registry.output_schema_ref is
  'Contrato da saida da capability, validado pelo Capability Gateway antes de o resultado voltar. Quando aponta para olga://io/execution-result nao ha o que validar: o envelope e montado pelo proprio gateway. Capability que existe pelo que devolve — read, simulate, extract — declara aqui o contrato de verdade.';


-- Controle de versao das migrations, para o runner reconhecer o que ja rodou.
create table if not exists mkt_v2.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Nenhuma tabela do schema fica alcancavel pela anon key, nem o ledger do runner.
alter table mkt_v2.schema_migrations enable row level security;
insert into mkt_v2.schema_migrations (name) values
  ('0010_brand_extraction.sql')
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = 'mkt_v2';
--   select capability_id, status from mkt_v2.capability_registry order by 1;
