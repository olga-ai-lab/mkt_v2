-- =====================================================================
-- 0012_source_contracts.sql  |  Freshness deixa de ser uma constante.
--
-- ── O que estava errado ─────────────────────────────────────────────────
--
-- `createRetrieval` tinha `maxAgeDays = 90`: um teto unico, aplicado igual ao
-- Brand Brain, a pagina de um site e ao registro da marca no nosso banco. O
-- proprio comentario dizia que aquilo esperava "o contrato de fonte, que o
-- MKT-17 coloca na Fase 2".
--
-- A Mestra §3 diz por que isso importa: "freshness e parte da verdade — dado
-- correto e desatualizado pode gerar resposta falsa". E o §7.5 diz onde a
-- resposta mora: num contrato por fonte, que declara autoridade temporal,
-- freshness, qualidade, PII, escopo de permissao e caveats.
--
-- Fontes envelhecem de formas diferentes, e quem sabe disso e o dono da fonte,
-- nao quem escreveu o retrieval.
--
-- ── `max_age_days` nulo e uma afirmacao ─────────────────────────────────
--
-- Nao e "esqueceram de preencher": e "esta fonte nao vence". O registro de uma
-- marca no nosso banco nao fica velho — ele fica errado, e errado nao se
-- detecta por idade. Um teto de 90 dias ali marcaria como vencida uma linha
-- que continua exata, e SOURCE_STALE viraria ruido que todo mundo aprende a
-- ignorar.
--
-- ── Autoridade temporal: qual carimbo conta ─────────────────────────────
--
-- Nem sempre e o `created_at`. Um Brand Brain vale a partir do `activated_at`,
-- porque foi ali que uma pessoa assumiu aquilo como a marca. Uma pagina vale a
-- partir de quando foi lida. Escolher o carimbo errado envelhece a fonte
-- errada — e o retrieval ja fazia essa escolha, so que escondida numa linha de
-- codigo (`bb.activated_at ?? bb.created_at`).
--
-- ── Para reverter ───────────────────────────────────────────────────────
--
--   drop table mkt.source_contracts;
-- =====================================================================

create table mkt.source_contracts (
  source_kind        text not null,
  version            integer not null default 1,
  status             mkt.lifecycle_status not null default 'CANDIDATE',
  temporal_authority text not null,
  max_age_days       integer check (max_age_days is null or max_age_days > 0),
  default_quality    text not null check (default_quality in ('HIGH','MEDIUM','LOW')),
  carries_pii        boolean not null default false,
  permission_scope   text[] not null default '{}',
  grain              text,
  caveats            text[] not null default '{}',
  owner              text not null,
  created_at         timestamptz not null default now(),
  primary key (source_kind, version)
);

-- Uma so ACTIVE por fonte, pela mesma razao que model_routing tem a dela: o
-- retrieval pergunta "qual contrato vale para esta fonte" e essa pergunta
-- precisa ter uma resposta, nao duas.
create unique index source_contracts_one_active
  on mkt.source_contracts (source_kind) where status = 'ACTIVE';

-- Tabela de catalogo, nao tenant-owned: o contrato de uma fonte e o mesmo para
-- todas as organizacoes. Sem org_id ela nao passa pelo enable_org_rls(), entao
-- a RLS entra na mao e sem policy — so service_role alcanca. E exatamente a
-- brecha por onde processed_events escapou na 0005.
alter table mkt.source_contracts enable row level security;

comment on column mkt.source_contracts.max_age_days is
  'Nulo NAO e ausencia de regra: e a afirmacao de que esta fonte nao vence por idade.';

insert into mkt.source_contracts
 (source_kind, temporal_authority, max_age_days, default_quality, carries_pii,
  permission_scope, grain, caveats, owner, status)
values
 ('BRAND_BRAIN', 'activated_at', 180, 'HIGH', false,
  '{OWNER,MARKETING,APPROVER}', 'uma versao de Brand Brain de uma marca',
  '{"Vale a partir de quando alguem ativou, e nao de quando o agente propos.",
    "Seis meses e o intervalo em que uma marca costuma rever posicionamento; passado isso, confirme antes de escrever em cima."}',
  'Brand', 'ACTIVE'),

 ('SOURCE_ARTIFACT', 'retrieved_at', 30, 'MEDIUM', false,
  '{OWNER,MARKETING,APPROVER}', 'uma leitura de uma pagina publica',
  '{"Site muda sem avisar: o que foi lido ha um mes pode nao estar mais la.",
    "Qualidade MEDIUM de proposito — e o que a marca publica sobre si, nao o que alguem conferiu."}',
  'Brand', 'ACTIVE'),

 ('DOMAIN_RECORD', 'created_at', null, 'HIGH', false,
  '{OWNER,MARKETING,APPROVER}', 'uma linha do nosso proprio banco de dominio',
  '{"Nao vence por idade: um registro nosso nao fica velho, fica errado — e errado nao se detecta por tempo."}',
  'AI Platform', 'ACTIVE'),

 ('UPLOADED_FILE', 'retrieved_at', 365, 'MEDIUM', true,
  '{OWNER,MARKETING}', 'um arquivo enviado pelo cliente',
  '{"Unica fonte marcada com PII: e a que recebe documento sem passar por nenhum filtro nosso.",
    "APPROVER fica de fora do escopo de proposito: aprovar texto nao exige abrir o anexo original."}',
  'Content', 'ACTIVE'),

 ('PROVIDER_RESPONSE', 'recorded_at', null, 'HIGH', false,
  '{OWNER,MARKETING,APPROVER}', 'a resposta de um provider externo, com receipt',
  '{"Nao vence: um receipt registra o que aconteceu naquele instante, e isso nao muda depois."}',
  'Publishing', 'ACTIVE');

-- Toda fonte que o EvidencePackage aceita precisa de contrato. Uma fonte sem
-- contrato cairia num default implicito no codigo — que e exatamente o que esta
-- migration existe para tirar de la.
do $$
declare faltando text[];
begin
  select array_agg(k) into faltando
    from unnest(array['BRAND_BRAIN','SOURCE_ARTIFACT','UPLOADED_FILE',
                      'PROVIDER_RESPONSE','DOMAIN_RECORD']) as k
   where not exists (
     select 1 from mkt.source_contracts s
      where s.source_kind = k and s.status = 'ACTIVE');

  if faltando is not null then
    raise exception 'fonte sem contrato ACTIVE: %', faltando;
  end if;
end $$;
