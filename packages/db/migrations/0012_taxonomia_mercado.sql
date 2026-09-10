-- =====================================================================
-- 0012_taxonomia_mercado.sql  |  A camada canonica do mercado segurador.
--
-- Primeira metade do passo 2 de docs/JORNADA-PERFIL.md.
--
-- ── Por que estas tabelas nao tem org_id ─────────────────────────────────
--
-- Porque o que elas guardam nao pertence a nenhum cliente. Ramo de seguro,
-- publico-alvo, tipo de conteudo e termo vedado sao do MERCADO: valem igual
-- para toda corretora, seguradora e MGA que usar a plataforma.
--
-- A separacao nao e organizacao, e o que torna duas coisas possiveis:
--
--   1. compliance deterministico — "cobertura ilimitada" e vedacao do mercado,
--      e nao pode depender de o cliente ter digitado essa proibicao no proprio
--      perfil. Hoje depende, e esse e o achado 4 de docs/REVISAO-AGENTES.md.
--   2. comparar e curar — se cada tenant tiver o proprio vocabulario, ninguem
--      consegue medir nada entre clientes, e o mesmo produto aparece com cinco
--      nomes diferentes.
--
-- A regua que separa as duas camadas: se a afirmacao vale para o mercado
-- inteiro, e canonica e mora aqui. Se vale para esta empresa, e perfil e mora
-- na camada do tenant. "Seguro garantia e um ramo" e canonico; "nos vendemos
-- seguro garantia para construtoras medias" e perfil.
--
-- ── Por que tudo nasce CANDIDATE ─────────────────────────────────────────
--
-- Esta e a unica coisa do sistema que NAO pode ser gerada por modelo sem
-- revisao humana: ela e a regua contra a qual todo conteudo vai ser julgado.
-- Uma taxonomia errada promovida contamina todo julgamento posterior, e
-- ninguem percebe a origem — o mesmo motivo pelo qual o Brand Brain do agente
-- nasce CANDIDATE.
--
-- Entao a carga abaixo e PROPOSTA, nao verdade. Nasce CANDIDATE, o codigo so
-- le ACTIVE, e enquanto ninguem curar, a taxonomia nao decide nada. Ha teste
-- afirmando que nenhuma linha semeada esta ACTIVE.
--
-- ── O que NAO esta semeado, e por que ────────────────────────────────────
--
-- `taxonomy_audiences` e `taxonomy_content_types` sobem VAZIAS. Publico-alvo e
-- taxonomia editorial nao tem fonte publica de onde partir; propo-las seria
-- inventar a estrutura do mercado a partir do que o modelo acha. Uma lacuna
-- declarada e corrigivel; uma lacuna preenchida com palpite vira fato falso
-- que todo mundo passa a citar.
-- =====================================================================

-- ── Produtos e ramos ─────────────────────────────────────────────────────
create table mkt.taxonomy_products (
  product_code   text primary key,
  version        integer not null default 1,
  status         mkt.lifecycle_status not null default 'CANDIDATE',
  label          text not null,
  -- O codigo oficial fica NULO ate a curadoria preencher a partir da fonte
  -- normativa. Um codigo de ramo errado e pior que nenhum: ele parece
  -- autoridade regulatoria e vai ser citado como se fosse.
  ramo_susep     text,
  regulator      text check (regulator in ('SUSEP','ANS')),
  parent_code    text references mkt.taxonomy_products(product_code),
  synonyms       text[] not null default '{}',
  required_disclaimers jsonb not null default '[]'::jsonb,
  notes          text,
  created_at     timestamptz not null default now(),
  curated_at     timestamptz,
  curated_by     text,
  -- Curado e um fato com dono e data. Sem os dois, nao ha o que auditar.
  constraint taxonomy_product_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

comment on table mkt.taxonomy_products is
  'Ramos e produtos do mercado segurador. Dado de mercado, nao do tenant. Nasce CANDIDATE: o codigo so le ACTIVE, e promover e ato de curadoria humana.';

-- ── Publicos-alvo ────────────────────────────────────────────────────────
create table mkt.taxonomy_audiences (
  audience_code  text primary key,
  version        integer not null default 1,
  status         mkt.lifecycle_status not null default 'CANDIDATE',
  label          text not null,
  segment        text not null check (segment in ('PF','PJ')),
  synonyms       text[] not null default '{}',
  notes          text,
  created_at     timestamptz not null default now(),
  curated_at     timestamptz,
  curated_by     text,
  constraint taxonomy_audience_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

comment on table mkt.taxonomy_audiences is
  'Sobe vazia de proposito: publico-alvo nao tem fonte publica de onde partir, e inventar a estrutura do mercado seria fato falso com aparencia de dado.';

-- ── Tipos de conteudo ────────────────────────────────────────────────────
create table mkt.taxonomy_content_types (
  content_type_code text primary key,
  version           integer not null default 1,
  status            mkt.lifecycle_status not null default 'CANDIDATE',
  label             text not null,
  suited_channels   mkt.channel[] not null default '{}',
  default_claim_type text not null default 'GENERAL'
    check (default_claim_type in ('COVERAGE','PRICE','DEADLINE','PERFORMANCE','GENERAL')),
  notes             text,
  created_at        timestamptz not null default now(),
  curated_at        timestamptz,
  curated_by        text,
  constraint taxonomy_content_type_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

comment on table mkt.taxonomy_content_types is
  'Idem: a taxonomia editorial do mercado e curadoria, nao inferencia.';

-- ── Vocabulario: o que o mercado nao deixa dizer ─────────────────────────
--
-- Esta e a tabela que fecha o achado 4 da revisao. Hoje a unica defesa contra
-- "cobertura ilimitada" e a lista de proibicoes que o proprio cliente escreveu
-- no Brand Brain dele. Vedacao de mercado nao pode depender disso.
create table mkt.taxonomy_terms (
  id            bigserial primary key,
  version       integer not null default 1,
  status        mkt.lifecycle_status not null default 'CANDIDATE',
  term          text not null,
  kind          text not null check (kind in ('FORBIDDEN','SENSITIVE','PREFERRED')),
  -- NULL = vale para todo o mercado. Preenchido = so naquele ramo.
  scope_product text references mkt.taxonomy_products(product_code),
  claim_type    text check (claim_type in ('COVERAGE','PRICE','DEADLINE','PERFORMANCE','GENERAL')),
  -- Por que e vedado. Aparece na recusa: "termo X, porque Y" e acionavel;
  -- "termo proibido" manda a pessoa adivinhar o que escrever no lugar.
  rationale     text not null,
  suggestion    text,
  source        text,
  created_at    timestamptz not null default now(),
  curated_at    timestamptz,
  curated_by    text,
  constraint taxonomy_term_active_curado
    check (status <> 'ACTIVE' or (curated_at is not null and curated_by is not null))
);

create unique index taxonomy_term_unico
  on mkt.taxonomy_terms (lower(term), coalesce(scope_product, ''));
create index on mkt.taxonomy_terms (status) where status = 'ACTIVE';

comment on table mkt.taxonomy_terms is
  'Termos vedados, sensiveis e preferidos do mercado. Conteudo julgado por esta lista nao depende de o cliente ter escrito a proibicao. Nasce CANDIDATE.';

-- ── RLS ──────────────────────────────────────────────────────────────────
--
-- Sem org_id nao e desculpa para ficar sem RLS: o teste do schema exige RLS em
-- toda tabela. Leitura liberada porque e dado de mercado, igual para todos;
-- escrita nao tem policy nenhuma, entao so migration e service_role escrevem.
alter table mkt.taxonomy_products enable row level security;
alter table mkt.taxonomy_products force row level security;
create policy taxonomy_products_read on mkt.taxonomy_products for select using (true);

alter table mkt.taxonomy_audiences enable row level security;
alter table mkt.taxonomy_audiences force row level security;
create policy taxonomy_audiences_read on mkt.taxonomy_audiences for select using (true);

alter table mkt.taxonomy_content_types enable row level security;
alter table mkt.taxonomy_content_types force row level security;
create policy taxonomy_content_types_read on mkt.taxonomy_content_types for select using (true);

alter table mkt.taxonomy_terms enable row level security;
alter table mkt.taxonomy_terms force row level security;
create policy taxonomy_terms_read on mkt.taxonomy_terms for select using (true);

-- =====================================================================
-- CARGA PROPOSTA — toda ela CANDIDATE, nenhuma linha vale ate ser curada.
-- =====================================================================

-- Agrupadores. Existem para o perfil dizer "opera patrimonial" sem listar
-- oito produtos, e para o termo vedado poder ter escopo de ramo inteiro.
insert into mkt.taxonomy_products (product_code, label, regulator, notes) values
 ('AUTO',            'Automovel',                    'SUSEP', 'Agrupador de ramo'),
 ('PATRIMONIAL',     'Patrimonial',                  'SUSEP', 'Agrupador de ramo'),
 ('PESSOAS',         'Pessoas',                      'SUSEP', 'Agrupador de ramo'),
 ('SAUDE',           'Saude e odontologico',         'ANS',   'Agrupador de ramo'),
 ('RESPONSABILIDADE','Responsabilidade civil',       'SUSEP', 'Agrupador de ramo'),
 ('FINANCEIRO',      'Riscos financeiros e garantia','SUSEP', 'Agrupador de ramo'),
 ('ESPECIAIS',       'Riscos especiais',             'SUSEP', 'Agrupador de ramo');

insert into mkt.taxonomy_products (product_code, label, parent_code, regulator, synonyms) values
 ('AUTO_INDIVIDUAL',   'Automovel individual',        'AUTO',            'SUSEP', '{"seguro auto","seguro de carro","auto PF"}'),
 ('AUTO_FROTA',        'Frota',                       'AUTO',            'SUSEP', '{"seguro de frota","frotista"}'),
 ('AUTO_MOTO',         'Motocicleta',                 'AUTO',            'SUSEP', '{"seguro moto"}'),

 ('RESIDENCIAL',       'Residencial',                 'PATRIMONIAL',     'SUSEP', '{"seguro residencial","seguro da casa","compreensivo residencial"}'),
 ('CONDOMINIO',        'Condominio',                  'PATRIMONIAL',     'SUSEP', '{"seguro de condominio"}'),
 ('EMPRESARIAL',       'Empresarial / patrimonial PJ','PATRIMONIAL',     'SUSEP', '{"seguro empresarial","compreensivo empresarial"}'),
 ('EQUIPAMENTOS',      'Equipamentos e riscos diversos','PATRIMONIAL',   'SUSEP', '{"seguro de equipamento","riscos diversos"}'),

 ('VIDA_INDIVIDUAL',   'Vida individual',             'PESSOAS',         'SUSEP', '{"seguro de vida"}'),
 ('VIDA_EM_GRUPO',     'Vida em grupo',               'PESSOAS',         'SUSEP', '{"vida em grupo","seguro de vida empresarial"}'),
 ('ACIDENTES_PESSOAIS','Acidentes pessoais',          'PESSOAS',         'SUSEP', '{"AP","acidentes pessoais coletivo"}'),
 ('PREVIDENCIA',       'Previdencia',                 'PESSOAS',         'SUSEP', '{"PGBL","VGBL","previdencia privada"}'),
 ('VIAGEM',            'Viagem',                      'PESSOAS',         'SUSEP', '{"seguro viagem"}'),

 ('SAUDE_PME',         'Saude PME',                   'SAUDE',           'ANS',   '{"plano de saude PME","saude empresarial"}'),
 ('SAUDE_ADESAO',      'Saude por adesao',            'SAUDE',           'ANS',   '{"plano por adesao","coletivo por adesao"}'),
 ('ODONTOLOGICO',      'Odontologico',                'SAUDE',           'ANS',   '{"plano odontologico","plano dental"}'),

 ('RC_GERAL',          'Responsabilidade civil geral','RESPONSABILIDADE','SUSEP', '{"RC geral"}'),
 ('RC_PROFISSIONAL',   'Responsabilidade civil profissional','RESPONSABILIDADE','SUSEP','{"E&O","RC profissional"}'),
 ('DO',                'D&O',                         'RESPONSABILIDADE','SUSEP', '{"D&O","responsabilidade de administradores"}'),
 ('CYBER',             'Riscos cibernéticos',         'RESPONSABILIDADE','SUSEP', '{"cyber","seguro cibernetico"}'),

 ('SEGURO_GARANTIA',   'Seguro garantia',             'FINANCEIRO',      'SUSEP', '{"garantia de obra","performance bond"}'),
 ('FIANCA_LOCATICIA',  'Fianca locaticia',            'FINANCEIRO',      'SUSEP', '{"seguro fianca","fianca de aluguel"}'),
 ('CREDITO',           'Credito interno',             'FINANCEIRO',      'SUSEP', '{"seguro de credito"}'),

 ('TRANSPORTES',       'Transportes',                 'ESPECIAIS',       'SUSEP', '{"seguro de carga","RCTR-C","RCF-DC"}'),
 ('AGRO',              'Rural / agro',                'ESPECIAIS',       'SUSEP', '{"seguro agricola","seguro rural","penhor rural"}'),
 ('GARANTIA_ESTENDIDA','Garantia estendida',          'ESPECIAIS',       'SUSEP', '{"garantia estendida"}');

-- ── Termos vedados ───────────────────────────────────────────────────────
--
-- A lista abaixo e de promessa comercial que o texto de seguro nao sustenta:
-- absolutos ("ilimitado", "total", "sempre"), garantias de resultado
-- ("garantido", "aprovacao imediata") e superlativos comparativos ("o melhor
-- do Brasil"). Sao os que aparecem em material de marketing e que nenhuma
-- apolice consegue honrar, porque toda apolice tem limite, carencia e
-- exclusao.
--
-- `suggestion` existe porque recusar sem oferecer saida faz o redator tentar
-- de novo com um sinonimo.
insert into mkt.taxonomy_terms (term, kind, claim_type, rationale, suggestion, source) values
 ('cobertura ilimitada', 'FORBIDDEN', 'COVERAGE',
  'Nenhuma apolice tem cobertura sem limite: existe limite maximo de indenizacao.',
  'Diga o limite contratado, ou "cobertura ate o limite da apolice".',
  'proposta desta sessao, nao curado'),

 ('cobertura total', 'FORBIDDEN', 'COVERAGE',
  'Sugere ausencia de exclusao, o que nenhuma apolice oferece.',
  'Liste as coberturas contratadas.',
  'proposta desta sessao, nao curado'),

 ('cobre tudo', 'FORBIDDEN', 'COVERAGE',
  'Mesma promessa de ausencia de exclusao, em linguagem coloquial.',
  'Diga o que cobre, com as principais exclusoes.',
  'proposta desta sessao, nao curado'),

 ('sem carencia', 'FORBIDDEN', 'DEADLINE',
  'Prazo de carencia e clausula contratual e varia por produto e por operadora.',
  'Informe a carencia real do produto.',
  'proposta desta sessao, nao curado'),

 ('sem franquia', 'SENSITIVE', 'COVERAGE',
  'Existe em alguns produtos, mas e afirmacao material: precisa de condicao geral que sustente.',
  'Cite a condicao que preve a isencao.',
  'proposta desta sessao, nao curado'),

 ('garantido', 'FORBIDDEN', 'PERFORMANCE',
  'Garantia de resultado nao existe em seguro: indenizacao depende de regulacao do sinistro.',
  'Descreva o processo, nao o desfecho.',
  'proposta desta sessao, nao curado'),

 ('aprovacao imediata', 'FORBIDDEN', 'DEADLINE',
  'Aceitacao passa por analise de risco; imediato so se o produto for de aceitacao automatica.',
  'Diga o prazo medio real de analise.',
  'proposta desta sessao, nao curado'),

 ('indenizacao garantida', 'FORBIDDEN', 'COVERAGE',
  'Indenizacao depende de cobertura, vigencia e regulacao — nunca e garantida de antemao.',
  'Explique quando ha cobertura.',
  'proposta desta sessao, nao curado'),

 ('o melhor seguro do brasil', 'FORBIDDEN', 'PERFORMANCE',
  'Superlativo comparativo sem lastro verificavel; publicidade comparativa exige prova.',
  'Traga um diferencial verificavel.',
  'proposta desta sessao, nao curado'),

 ('mais barato do mercado', 'FORBIDDEN', 'PRICE',
  'Afirmacao de preco comparativa que muda a cada cotacao e nao se sustenta.',
  'Fale em economia possivel, com a condicao.',
  'proposta desta sessao, nao curado'),

 ('100% de cobertura', 'FORBIDDEN', 'COVERAGE',
  'Percentual absoluto de cobertura nao existe diante de limite e exclusao.',
  'Diga o percentual real sobre o valor segurado.',
  'proposta desta sessao, nao curado'),

 ('sem analise de perfil', 'FORBIDDEN', 'COVERAGE',
  'Perfil e base de precificacao e de aceitacao em varios ramos.',
  'Diga o que dispensa vistoria, se for o caso.',
  'proposta desta sessao, nao curado'),

 ('livre de impostos', 'FORBIDDEN', 'PRICE',
  'Premio de seguro tem IOF; a isencao e excecao por produto e precisa ser nomeada.',
  'Cite o tributo e a base legal, se houver isencao.',
  'proposta desta sessao, nao curado'),

 ('reembolso integral', 'SENSITIVE', 'COVERAGE',
  'Existe em alguns planos, sempre com limite e tabela — afirmacao material.',
  'Informe o limite de reembolso.',
  'proposta desta sessao, nao curado');

-- Vedacao de ramo: prazo de carencia e regra de saude, e falar em "atendimento
-- imediato" ali e promessa diferente de falar em auto.
insert into mkt.taxonomy_terms (term, kind, scope_product, claim_type, rationale, suggestion, source) values
 ('atendimento imediato', 'SENSITIVE', 'SAUDE', 'DEADLINE',
  'Em saude, prazo de atendimento e regulado e depende de carencia e rede.',
  'Informe o prazo previsto e a carencia aplicavel.',
  'proposta desta sessao, nao curado'),

 ('cobertura vitalicia', 'FORBIDDEN', 'PESSOAS', 'COVERAGE',
  'Vigencia e renovacao sao contratuais; vitalicio exige produto que efetivamente preveja.',
  'Diga a vigencia e as condicoes de renovacao.',
  'proposta desta sessao, nao curado');
