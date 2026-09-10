-- =====================================================================
-- 0013_perfil_da_empresa.sql  |  A camada do tenant: quem e ESTA empresa.
--
-- Passo 3 de docs/JORNADA-PERFIL.md.
--
-- O Brand Brain guarda identidade, tom em prosa, claims permitidos, proibicoes
-- e disclaimers, lidos do site. E pouco para o produto nao escrever a mesma
-- coisa para toda corretora. Faltam as quatro coisas que efetivamente
-- diferenciam uma da outra: produtos operados, seguradoras representadas,
-- publico-alvo e o tom que a empresa PRATICA — que raramente e o que ela
-- declara.
--
-- ── Por que uma tabela nova em vez de colunas no Brand Brain ─────────────
--
-- Porque o que muda nao e o conteudo de um campo: e a forma. Produto, publico
-- e mix de conteudo sao LISTAS que referenciam a taxonomia do mercado, com
-- peso e prioridade. Enfiar isso em jsonb dentro de brand_brain_versions
-- pareceria mais barato hoje e impediria a unica coisa que justifica ter
-- taxonomia: perguntar "quais clientes operam seguro garantia" com um join, em
-- vez de varrer json.
--
-- O Brand Brain continua onde esta. A migracao dos dados de um para o outro e
-- decisao separada (docs/JORNADA-PERFIL.md §8, decisao 2), e ate ela acontecer
-- os dois convivem — com o perfil sendo o que a jornada nova escreve.
--
-- ── O que se mantem, palavra por palavra ────────────────────────────────
--
-- O invariante do Brand Brain: o agente propoe CANDIDATE, quem promove para
-- ACTIVE e uma pessoa, e a promocao guarda QUEM. Um perfil errado promovido
-- contamina todo conteudo gerado depois, e ninguem percebe a origem — e agora
-- ele carrega tambem produto e publico, entao o estrago e maior.
-- =====================================================================

create table mkt.company_profile_versions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references mkt.organizations(id) on delete cascade,
  brand_id       uuid not null references mkt.brands(id) on delete cascade,
  version        integer not null,
  status         mkt.lifecycle_status not null default 'CANDIDATE',

  company_type   text not null default 'CORRETORA'
    check (company_type in ('CORRETORA','SEGURADORA','MGA','INSURTECH')),

  identity       jsonb not null default '{}'::jsonb,

  -- Tom em EIXOS, nao em prosa.
  --
  -- "Tom profissional e proximo" nao e verificavel: dois redatores leem duas
  -- coisas, e nenhum revisor consegue dizer se o texto saiu do tom. Cinco
  -- eixos de 1 a 5 sao. E, principalmente, permitem comparar o tom DECLARADO
  -- com o tom OBSERVADO nas publicacoes reais — quando os dois divergem, isso
  -- e uma conversa a ter com o cliente, nao um dado a esconder.
  tone_axes      jsonb not null default '{}'::jsonb,
  tone_observed  jsonb not null default '{}'::jsonb,
  voice_examples jsonb not null default '[]'::jsonb,

  prohibitions   jsonb not null default '[]'::jsonb,
  disclaimers    jsonb not null default '[]'::jsonb,

  -- Lacuna DECLARADA. O que a leitura nao achou entra aqui e a tela pergunta.
  -- Sem este campo, o modelo preenche o que faltou com o que e razoavel, e
  -- razoavel inventado vira fato sobre a marca do cliente.
  gaps           jsonb not null default '[]'::jsonb,

  created_by_actor_type mkt.actor_type not null default 'agent',
  created_by_actor_id   text,
  created_at     timestamptz not null default now(),

  activated_at   timestamptz,
  activated_by_actor_type mkt.actor_type,
  activated_by_actor_id   text,
  superseded_at  timestamptz,

  unique (brand_id, version),

  -- Ativacao sem dono nao passa. Aqui, diferente da 0010, a constraint nasce
  -- valida: nao ha linha antiga para acomodar.
  constraint profile_active_tem_dono
    check (status <> 'ACTIVE' or activated_by_actor_id is not null)
);

-- Uma ACTIVE por marca, nem por um instante. O mesmo indice do Brand Brain,
-- pela mesma razao: duas verdades simultaneas sobre quem a empresa e nao e um
-- estado transitorio aceitavel, e um `update` sem transacao criaria um.
create unique index company_profile_one_active
  on mkt.company_profile_versions (brand_id) where status = 'ACTIVE';

comment on table mkt.company_profile_versions is
  'Quem e esta empresa: produtos, publico, tom e mix. Nasce CANDIDATE; promover e ato humano com dono registrado.';

-- ── As listas que referenciam a taxonomia ───────────────────────────────
--
-- Todas carregam org_id. Nao e redundancia: e o que permite a policy de RLS
-- padrao (mkt.enable_org_rls) valer aqui como vale em claims e evidence. Sem
-- a coluna, cada tabela precisaria da propria policy com join — e policy com
-- join e onde vazamento cross-tenant nasce.

create table mkt.profile_products (
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt.company_profile_versions(id) on delete cascade,
  product_code       text not null references mkt.taxonomy_products(product_code),
  priority           integer not null default 3 check (priority between 1 and 5),
  is_focus           boolean not null default false,
  notes              text,
  primary key (profile_version_id, product_code)
);

create table mkt.profile_audiences (
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt.company_profile_versions(id) on delete cascade,
  audience_code      text not null references mkt.taxonomy_audiences(audience_code),
  weight             integer not null default 3 check (weight between 1 and 5),
  primary key (profile_version_id, audience_code)
);

create table mkt.profile_content_mix (
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt.company_profile_versions(id) on delete cascade,
  content_type_code  text not null references mkt.taxonomy_content_types(content_type_code),
  share_pct          integer not null check (share_pct between 0 and 100),
  primary key (profile_version_id, content_type_code)
);

-- Seguradoras representadas. Importa para o que pode ser citado: nome de
-- terceiro em peca de marketing tem regra de marca que nao e nossa.
create table mkt.profile_carriers (
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt.company_profile_versions(id) on delete cascade,
  carrier_name       text not null,
  relationship       text not null check (relationship in ('REPRESENTA','PARCEIRO','RESSEGURO','PROPRIA')),
  can_mention        boolean not null default false,
  primary key (profile_version_id, carrier_name)
);

-- ── A procedencia, campo a campo ────────────────────────────────────────
--
-- Esta e a tabela que muda o que o sistema consegue provar.
--
-- Hoje nenhum claim material se sustenta porque nada produz evidence citavel
-- para conteudo (achado 5 de docs/REVISAO-AGENTES.md): so o Brand Brain grava
-- a fonte que leu. Com o perfil, cada AFIRMACAO sobre a empresa passa a ter
-- origem, citacao e confianca — e o perfil vira a primeira fonte citavel do
-- produto.
--
-- `source_kind` separa o que a maquina leu do que a pessoa afirmou. Quem
-- revisa precisa saber qual e qual: uma inferencia do LinkedIn e hipotese;
-- uma resposta na entrevista e fato.
create table mkt.profile_field_sources (
  id                 bigserial primary key,
  org_id             uuid not null references mkt.organizations(id) on delete cascade,
  profile_version_id uuid not null references mkt.company_profile_versions(id) on delete cascade,
  field_path         text not null,
  source_kind        text not null check (source_kind in ('SITE','LINKEDIN','POST','ENTREVISTA','INFERIDO')),
  evidence_id        uuid references mkt.evidence(id),
  quote              text,
  confidence         text not null check (confidence in ('HIGH','MEDIUM','LOW')),
  created_at         timestamptz not null default now()
);

create index on mkt.profile_field_sources (profile_version_id, field_path);

-- Afirmacao lida de fora sem citacao nao e procedencia, e "eu li em algum
-- lugar". Entrevista e inferencia declarada nao precisam: numa, a fonte e a
-- pessoa; na outra, a ausencia de fonte E a informacao.
alter table mkt.profile_field_sources
  add constraint profile_source_lido_tem_citacao
  check (source_kind not in ('SITE','LINKEDIN','POST') or quote is not null);

select mkt.enable_org_rls('mkt.company_profile_versions');
select mkt.enable_org_rls('mkt.profile_products');
select mkt.enable_org_rls('mkt.profile_audiences');
select mkt.enable_org_rls('mkt.profile_content_mix');
select mkt.enable_org_rls('mkt.profile_carriers');
select mkt.enable_org_rls('mkt.profile_field_sources');

-- =====================================================================
-- A capability que propoe, e a policy que a deixa acontecer.
-- =====================================================================

insert into mkt.capability_registry
 (capability_id, version, status, mode, side_effect, risk_tier, input_schema_ref, output_schema_ref,
  error_codes, permissions, idempotency_required, idempotency_key_template, provider_adapter,
  timeout_ms, max_attempts, owner)
values
 ('profile.propose', 1, 'ACTIVE', 'write', 'internal', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{EVIDENCE_INSUFFICIENT,SCHEMA_VALIDATION_FAILED,NORMALIZATION_FAILED}','{OWNER,MARKETING}',
  false, null, null, 60000, 2, 'Brand');

insert into mkt.rule_policies
 (org_id, policy_id, version, status, priority, scope, conditions, effect, max_autonomy,
  reason_code, message_key, note)
values
 (null, 'POL_PROFILE_PROPOSE_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"profile.propose"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.brand_propose_allowed',
  'O agente propoe perfil CANDIDATE; promover para ACTIVE e ato humano.');

-- =====================================================================
-- O charter do AGT-MKT-BRAND.
--
-- Ele deixa de ser "o agente do Brand Brain" e passa a ser o dono da jornada
-- de entrada: le o site, le o LinkedIn, conduz a entrevista e propoe o perfil.
-- docs/JORNADA-PERFIL.md §5 propoe renomea-lo para AGT-MKT-PROFILE; o nome
-- fica para quando a decisao 2 (perfil substitui ou convive com o Brand Brain)
-- estiver tomada, porque renomear agente muda o que os traces antigos citam.
--
-- O que muda agora e so a capability. O agente continua CANDIDATE: nada disto
-- serve usuario nenhum ate uma promocao explicita, com migration propria.
-- =====================================================================

update mkt.agent_registry
   set capabilities = capabilities || '{profile.propose}',
       mission = 'Construir o perfil da empresa a partir do site, do LinkedIn e de revisao humana estruturada.'
 where agent_id = 'AGT-MKT-BRAND' and version = 1;

comment on table mkt.profile_field_sources is
  'Procedencia campo a campo do perfil. E o que separa o que a maquina leu do que a pessoa afirmou — e o que faz o perfil ser citavel como evidence.';
