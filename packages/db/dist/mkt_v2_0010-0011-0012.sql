-- =====================================================================
-- Olga Marketing OS — schema mkt_v2
--
-- Bundle das 3 migrations, geradas a partir de packages/db/migrations/.
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


-- ─── 0011_ai_review.sql ──────────────────────────────────────────

-- =====================================================================
-- 0011_ai_review.sql  |  A etapa que a J11 exigia e ninguem cumpria.
--
-- ── O buraco ────────────────────────────────────────────────────────────
--
-- A state machine da J11 nao liga DRAFT a revisao humana: AI_REVIEW vem antes.
-- E nada movia DRAFT para AI_REVIEW.
--
-- `quality.precheck` era a revisao de IA em intencao — ela confere exatamente o
-- que precisa ser conferido — mas o `side_effect` dela e `none`, e capability
-- que nao escreve nao muda estado. O resultado era um beco silencioso: todo
-- conteudo criado pelo agente ficava em DRAFT, e `approval.request` recusava,
-- corretamente, por uma etapa que ninguem tinha como cumprir.
--
-- ── Por que nao foi so trocar o side_effect do precheck ─────────────────
--
-- Porque `mode: simulate` significa "calcula um veredito e nao produz efeito".
-- Um simulate que escreve e uma mentira no registry — e o registry e onde a
-- policy decide, o gateway roteia e os evals conferem. Mentir ali quebra as
-- tres de uma vez, e a mentira e barata de escrever e cara de descobrir.
--
-- Entao entram DUAS capabilities sobre a MESMA conferencia:
--
--   quality.precheck   simulate  "como esta?"     devolve o laudo
--   quality.ai_review  write     "entao passa"    devolve o laudo E transiciona
--
-- A conferencia e uma funcao so, em packages/gateway/src/adapters/internal.mjs.
-- Duas copias da mesma regra sao duas chances de divergir, e no dia em que
-- divergissem o conteudo entraria em revisao dizendo ter passado por um check
-- que a outra capability teria reprovado.
--
-- ── O laudo que reprova nao e falha ─────────────────────────────────────
--
-- Achar problema e a capability funcionando. Ela devolve `valid: false`, nao
-- transiciona, e quem para o loop e o laudo. Por isso `output_schema_ref` e o
-- ValidatedResult: e o laudo que o gateway valida, e nao um envelope vazio.
--
-- ── Para reverter ───────────────────────────────────────────────────────
--
--   delete from mkt_v2.rule_policies where policy_id = 'POL_AI_REVIEW_DEFAULT';
--   delete from mkt_v2.capability_registry where capability_id = 'quality.ai_review';
--   update mkt_v2.agent_registry
--      set capabilities = array_remove(
--            array_remove(capabilities, 'quality.ai_review'), 'approval.request')
--    where agent_id = 'AGT-MKT-CONTENT' and version = 1;
-- =====================================================================

insert into mkt_v2.capability_registry
 (capability_id, version, status, mode, side_effect, risk_tier, input_schema_ref, output_schema_ref,
  error_codes, permissions, idempotency_required, idempotency_key_template, provider_adapter, timeout_ms, max_attempts, owner)
values
 ('quality.ai_review', 1, 'ACTIVE', 'write', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/validated-result',
  '{CLAIM_UNSUPPORTED,EVIDENCE_INSUFFICIENT,CONTENT_DUPLICATE_RISK,CONTENT_NOT_APPROVED,SCHEMA_VALIDATION_FAILED}',
  '{OWNER,MARKETING}', false, null, null, 20000, 2, 'Content');

-- Capability de escrita sem policy ACTIVE e negada pelo gateway. A regra e a
-- mesma do rascunho: conferir o proprio texto antes de pedir olho humano nao
-- produz efeito externo nenhum, e nao ha por que exigir mais que A2.
insert into mkt_v2.rule_policies
 (org_id, policy_id, version, status, priority, scope, conditions, effect, max_autonomy, reason_code, message_key, note)
values
 (null, 'POL_AI_REVIEW_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"quality.ai_review"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.ai_review_allowed',
  'Passar o proprio rascunho pela revisao de IA nao produz efeito externo: ate A2.');

-- ── O charter que nao alcancava a propria cadeia ────────────────────────
--
-- Quem escreve conteudo e quem o submete a revisao. Sem isto o AGT-MKT-CONTENT
-- teria a capability disponivel no registry e fora do proprio charter — e o
-- loop recusaria o passo com "este agente nao faz isso".
--
-- E entra `approval.request` junto, porque montar a etapa nova sem ela deixaria
-- a cadeia editorial cortada um passo adiante: aquela capability esta ACTIVE
-- desde a 0006, tem compilador e tem policy, e NENHUM dos quatro agentes a
-- tinha no charter. Ou seja, ninguem conseguia pedir revisao humana — o mesmo
-- tipo de beco silencioso que esta migration existe para fechar, so que uma
-- etapa depois.
--
-- O CONTENT e o dono natural das duas: ele escreve o rascunho e ele agenda.
-- Pedir olho humano e exatamente o passo entre uma coisa e outra.
update mkt_v2.agent_registry
   set capabilities = capabilities || '{quality.ai_review,approval.request}'
 where agent_id = 'AGT-MKT-CONTENT'
   and version = 1
   and not (capabilities @> '{quality.ai_review,approval.request}');

-- Conferencia, na propria transacao. Um insert que nao casou ou um charter que
-- nao ganhou a capability deixaria o registry aplicado divergindo do que este
-- repositorio descreve — e a divergencia so apareceria no primeiro pedido real.
do $$
declare n integer;
begin
  select count(*) into n from mkt_v2.capability_registry
   where capability_id = 'quality.ai_review' and status = 'ACTIVE'
     and mode = 'write' and side_effect = 'internal';
  if n <> 1 then
    raise exception 'quality.ai_review nao ficou ACTIVE como write/internal (linhas: %)', n;
  end if;

  select count(*) into n from mkt_v2.rule_policies
   where policy_id = 'POL_AI_REVIEW_DEFAULT' and status = 'ACTIVE';
  if n <> 1 then
    raise exception 'POL_AI_REVIEW_DEFAULT ausente: capability de escrita sem policy e negada pelo gateway';
  end if;

  select count(*) into n from mkt_v2.agent_registry
   where agent_id = 'AGT-MKT-CONTENT' and version = 1
     and capabilities @> '{quality.ai_review,approval.request}';
  if n <> 1 then
    raise exception 'AGT-MKT-CONTENT nao ganhou quality.ai_review e approval.request no charter';
  end if;

  -- Capability ACTIVE que nenhum agente pode chamar e uma porta murada: existe
  -- no registry, passa em todo teste de unidade, e nunca e alcancada. Foi assim
  -- que approval.request ficou cinco migrations sem dono.
  select count(*) into n
    from mkt_v2.capability_registry c
   where c.status = 'ACTIVE'
     and not exists (
       select 1 from mkt_v2.agent_registry a where a.capabilities @> array[c.capability_id]);
  if n > 0 then
    raise warning 'ha % capability(s) ACTIVE que nenhum agente tem no charter', n;
  end if;
end $$;

comment on table mkt_v2.marketing_events is
  'Fatos de dominio, para auditoria e analise. Diferente do outbox: outbox e evento que precisa ser ENTREGUE a um consumidor, e este e fato que precisa ficar REGISTRADO. O primeiro escritor e a revisao de IA, que grava aqui o laudo que justificou a transicao para AI_REVIEW — estado sem evidencia e confianca sem lastro.';


-- ─── 0012_source_contracts.sql ───────────────────────────────────

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
--   drop table mkt_v2.source_contracts;
-- =====================================================================

create table mkt_v2.source_contracts (
  source_kind        text not null,
  version            integer not null default 1,
  status             mkt_v2.lifecycle_status not null default 'CANDIDATE',
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
  on mkt_v2.source_contracts (source_kind) where status = 'ACTIVE';

-- Tabela de catalogo, nao tenant-owned: o contrato de uma fonte e o mesmo para
-- todas as organizacoes. Sem org_id ela nao passa pelo enable_org_rls(), entao
-- a RLS entra na mao e sem policy — so service_role alcanca. E exatamente a
-- brecha por onde processed_events escapou na 0005.
alter table mkt_v2.source_contracts enable row level security;

comment on column mkt_v2.source_contracts.max_age_days is
  'Nulo NAO e ausencia de regra: e a afirmacao de que esta fonte nao vence por idade.';

insert into mkt_v2.source_contracts
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
     select 1 from mkt_v2.source_contracts s
      where s.source_kind = k and s.status = 'ACTIVE');

  if faltando is not null then
    raise exception 'fonte sem contrato ACTIVE: %', faltando;
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
  ('0010_brand_extraction.sql'),
  ('0011_ai_review.sql'),
  ('0012_source_contracts.sql')
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = 'mkt_v2';
--   select capability_id, status from mkt_v2.capability_registry order by 1;
