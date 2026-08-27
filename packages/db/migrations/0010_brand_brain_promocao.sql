-- =====================================================================
-- 0010_brand_brain_promocao.sql
--
-- Promover uma versao do Brand Brain para ACTIVE e ato de governanca: e a
-- decisao humana que separa "o agente propos" de "a marca passou a valer
-- assim". A tabela guardava `activated_at` — QUANDO — e nao guardava QUEM.
--
-- Isso importa mais aqui do que em quase qualquer outro lugar do sistema.
-- Todo conteudo gerado depois herda o Brand Brain ativo. Quando um texto
-- publicado estiver errado, a pergunta que se faz e "de onde veio essa
-- afirmacao", e a resposta precisa chegar a uma pessoa, nao a um timestamp.
--
-- Nao ha `activated_by` em nenhuma outra tabela porque em nenhuma outra a
-- ativacao e o momento em que um humano assume a responsabilidade por um
-- artefato que o agente escreveu.
-- =====================================================================

alter table mkt.brand_brain_versions
  add column activated_by_actor_type mkt.actor_type,
  add column activated_by_actor_id   text,
  add column superseded_at           timestamptz;

comment on column mkt.brand_brain_versions.activated_by_actor_id is
  'Quem promoveu esta versao para ACTIVE. NULL em versao que nunca foi ativada.';
comment on column mkt.brand_brain_versions.superseded_at is
  'Quando esta versao deixou de ser a ACTIVE. Preenchido ao promover a proxima.';

-- Ativacao sem dono nao passa.
--
-- O CHECK vale para linhas novas E para updates das antigas: uma versao que
-- chegar a ACTIVE daqui em diante tem de dizer quem a promoveu. As linhas
-- ACTIVE que ja existem ficam de fora — nao da para inventar retroativamente
-- quem apertou um botao que nao existia, e preencher com 'system' seria
-- afirmar algo falso sobre uma decisao humana.
alter table mkt.brand_brain_versions
  add constraint brand_brain_active_tem_dono
  check (
    status <> 'ACTIVE'
    or activated_by_actor_id is not null
    or activated_at is null
  ) not valid;

-- `not valid` de proposito: a constraint passa a valer para o que vier, sem
-- derrubar a migration por causa do seed que ja esta la. Validar depois, se
-- alguem quiser, e uma decisao separada.
