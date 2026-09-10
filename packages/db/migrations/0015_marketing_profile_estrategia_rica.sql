-- =====================================================================
-- 0015_marketing_profile_estrategia_rica.sql
--
-- O formulario de perfil (0012) tinha seis campos. O wizard real de
-- onboarding pede oito etapas — empresa, atuacao, produtos, publicos,
-- posicionamento, comunicacao, pilares, revisao — e a maior parte disso
-- e LISTA estruturada (produtos com prioridade, publicos com dores e
-- produtos associados, pilares com percentual), nao texto livre. Forcar
-- isso em colunas de mkt.marketing_profiles seria json solto demais para
-- o codigo validar (soma de pilares, publico sem produto) e demais texto
-- livre para telas somarem/filtrarem.
--
-- Por isso: marketing_profiles GANHA colunas para o que e mesmo campo
-- unico (descricao, proposta de valor, tons...), e GANHA tres tabelas
-- filhas para o que e lista com identidade propria.
--
-- ── Por que produto/publico/pilar sao tabelas, e nao array de texto ────
--
-- Um produto tem prioridade (normal/estrategico) e descricao proprios;
-- um publico tem dores, objetivos E os produtos que ele atende; um pilar
-- tem percentual que precisa somar 100 entre todos os da marca. Nenhuma
-- dessas relacoes cabe num text[] sem duplicar a mesma logica de
-- validacao em todo lugar que le o array.
--
-- ── Por que marketing_audiences.produto_ids e array sem FK ─────────────
--
-- Mesma situacao de mkt.claims.evidence_ids (0002): Postgres nao tem FK
-- de array de escalar. Apagar um produto referenciado por um publico
-- deixa o id pendurado — aceito pelo mesmo motivo que la: a alternativa
-- seria uma tabela de juncao so para isso, e o ganho de integridade nao
-- paga a complexidade extra nesta fase.
--
-- ── Suporte a mais de uma marca ─────────────────────────────────────────
--
-- ate aqui toda leitura no app assumia "a primeira marca do workspace".
-- brands ja tinha RLS (0001/0002) mas nunca grant de escrita para
-- authenticated: ninguem no app criava marca. Agora cria.
-- =====================================================================

-- ---------------------------------------------------------------------
-- marketing_profiles: os campos que sao um valor so por marca.
-- ---------------------------------------------------------------------
alter table mkt.marketing_profiles
  add column descricao               text,
  add column anos_mercado            integer,
  add column tamanho_equipe          integer,
  add column cidade                  text,
  add column estado                  text,
  add column site                    text,
  add column social                  text,
  add column regioes                 text[] not null default '{}',
  add column diferenciais            text[] not null default '{}',
  add column objetivos_secundarios   mkt.marketing_objective[] not null default '{}',
  add column proposta_valor          text,
  add column razoes_confianca        text[] not null default '{}',
  add column percepcao_desejada      text[] not null default '{}',
  add column estilos_comunicacao     text[] not null default '{}',
  add column tons_voz                text[] not null default '{}',
  add column diretrizes_adicionais   text,
  add column palavras_evitar         text[] not null default '{}',
  -- O resumo que o composer usa como {{briefing}} nos quatro templates de
  -- objetivo. Nasce de codigo (concatenacao deterministica dos campos
  -- acima), nunca de modelo — a mesma regra de "o codigo calcula" que
  -- vale para prompt-templates.mjs. Nulo ate a Etapa 8 (Revisao) ser
  -- concluida.
  add column resumo                  text;

comment on column mkt.marketing_profiles.resumo is
  'Resumo montado por codigo a partir dos campos da marca, usado como {{briefing}} '
  'nos templates de prompt. Nunca escrito por modelo.';

-- ---------------------------------------------------------------------
-- Produtos ofertados pela marca
-- ---------------------------------------------------------------------
create table mkt.marketing_products (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt.organizations(id) on delete cascade,
  brand_id     uuid not null references mkt.brands(id) on delete cascade,
  nome         text not null,
  prioridade   text not null default 'NORMAL' check (prioridade in ('NORMAL', 'ESTRATEGICO')),
  descricao    text,
  created_at   timestamptz not null default now(),
  unique (brand_id, nome)
);

create index on mkt.marketing_products (brand_id);
select mkt.enable_org_rls('mkt.marketing_products');

-- ---------------------------------------------------------------------
-- Publicos que a marca quer alcancar
-- ---------------------------------------------------------------------
create table mkt.marketing_audiences (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt.organizations(id) on delete cascade,
  brand_id     uuid not null references mkt.brands(id) on delete cascade,
  nome         text not null,
  descricao    text,
  dores        text[] not null default '{}',
  objetivos    text[] not null default '{}',
  -- Sem FK: mesmo caso de mkt.claims.evidence_ids (0002). Ver nota no
  -- cabecalho.
  produto_ids  uuid[] not null default '{}',
  principal    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (brand_id, nome)
);

create index on mkt.marketing_audiences (brand_id);
-- No maximo um publico principal por marca — a mesma pergunta que o
-- wizard faz ("qual e o principal?") so faz sentido com resposta unica.
create unique index marketing_audiences_um_principal
  on mkt.marketing_audiences (brand_id) where principal;
select mkt.enable_org_rls('mkt.marketing_audiences');

-- ---------------------------------------------------------------------
-- Pilares editoriais e o peso de cada um
-- ---------------------------------------------------------------------
create table mkt.marketing_pillars (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references mkt.organizations(id) on delete cascade,
  brand_id     uuid not null references mkt.brands(id) on delete cascade,
  nome         text not null,
  descricao    text,
  percentual   integer not null default 0 check (percentual between 0 and 100),
  created_at   timestamptz not null default now(),
  unique (brand_id, nome)
);

create index on mkt.marketing_pillars (brand_id);
select mkt.enable_org_rls('mkt.marketing_pillars');

comment on table mkt.marketing_pillars is
  'A soma dos percentuais de uma marca deveria ser 100, mas isso nao e '
  'constraint de banco: check entre linhas exigiria trigger, e a mesma '
  'checagem ja e feita na Etapa 8 do wizard antes de deixar concluir. '
  'Uma marca com soma diferente de 100 e um rascunho, nao um dado invalido.';

-- ---------------------------------------------------------------------
-- Grants: as tres tabelas novas, e brands ganhando escrita
-- ---------------------------------------------------------------------
-- Mesmo padrao de 0014: RLS restringe linha, GRANT decide se o papel
-- tenta a operacao.
grant select, insert, update, delete on mkt.marketing_products  to authenticated;
grant select, insert, update, delete on mkt.marketing_audiences to authenticated;
grant select, insert, update, delete on mkt.marketing_pillars   to authenticated;

-- brands tinha so SELECT: ninguem no app criava marca ate agora. O botao
-- "adicionar marca" precisa de INSERT; UPDATE cobre editar nome/site depois.
grant insert, update on mkt.brands to authenticated;

grant select, insert, update, delete, truncate, references, trigger
  on mkt.marketing_products, mkt.marketing_audiences, mkt.marketing_pillars
  to service_role;
