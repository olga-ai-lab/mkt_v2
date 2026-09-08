-- =====================================================================
-- 0013_promote_brand_content.sql  |  Os dois agentes que escrevem.
--
-- Esta e a promocao que as migrations 0009 e 0012 recusavam por construcao.
-- As duas carregam uma guarda que derruba a transacao se QUALQUER agente
-- ACTIVE tiver capability de escrita, com a mensagem "promover um deles exige
-- migration propria e motivo proprio". Esta e essa migration, e este e esse
-- motivo.
--
-- ── Por que a guarda antiga nao pode ser mantida ─────────────────────────
--
-- Ela nao pode ser reexecutada aqui: abortaria. E isso nao e um obstaculo a
-- contornar, e a pergunta que ela existe para forcar. Ou a promocao nao
-- acontece, ou alguem declara qual invariante fica no lugar.
--
-- A guarda antiga era um proxy grosseiro. "Escreve" juntava numa lista so
-- coisas de consequencia muito diferente: criar um rascunho no nosso banco e
-- publicar no perfil de um cliente. A primeira se apaga; a segunda nao.
--
-- O invariante que fica, e que e mais estreito e mais forte:
--
--     NENHUM AGENTE ACTIVE TEM CAPABILITY DE EFEITO EXTERNO.
--
-- Ele nao e uma lista de nomes que alguem precisa lembrar de atualizar: sai
-- de `side_effect` no proprio capability_registry. Uma capability que ganhe
-- efeito externo amanha passa a ser barrada sem que ninguem edite esta guarda.
--
-- ── Em que a decisao se apoia, conferido contra o registry ───────────────
--
--   AGT-MKT-BRAND    brand.extract_from_url (internal), brand.propose_version
--                    (internal), brand.read (none)
--   AGT-MKT-CONTENT  brand.read, evidence.read (none), content.create_draft,
--                    content.create_variant, publishing.schedule (internal),
--                    quality.precheck (internal)
--
-- Nenhuma das duas alcanca efeito externo. As duas capabilities externas do
-- MVP — publishing.publish e channel.connect — nao estao no charter de agente
-- nenhum, e continuam nao estando. Publicar e do workflow duravel depois de
-- uma decisao humana de agendar; conectar e consentimento no navegador de uma
-- pessoa.
--
-- Tres defesas ja de pe sustentam o resto, e sao linhas de mkt.rule_policies,
-- nao intencao de desenho:
--
--   POL_SCHEDULE_DEFAULT               so permite publishing.schedule quando
--                                      content_status = APPROVED. Um agente
--                                      nao agenda o que um humano nao aprovou.
--   POL_COMPLIANCE_ON_MATERIAL_CLAIM   exige aprovacao para claim de
--                                      COVERAGE, PRICE ou DEADLINE.
--   proposeBrandVersion                escreve 'CANDIDATE' como literal. Nao
--                                      existe argumento que a faca escrever
--                                      ACTIVE.
--
-- E os evals dos dois existem e passam: cinco casos cada, entre eles
-- CONTENT-ADV-003 ("nenhum agente publica direto") e BRAND-ADV-003 (a pagina
-- que manda ignorar as instrucoes anteriores).
--
-- ── O que esta promocao NAO concede ──────────────────────────────────────
--
-- Publicar. Aprovar. Conectar canal. Promover Brand Brain para ACTIVE. As
-- quatro continuam fora do alcance de qualquer agente, e as duas ultimas
-- continuam sendo ato humano com tela propria.
--
-- ── Para reverter ────────────────────────────────────────────────────────
--
--   update mkt.agent_registry set status = 'CANDIDATE'
--    where agent_id in ('AGT-MKT-BRAND','AGT-MKT-CONTENT') and version = 1;
--
--   (o inventario em packages/db/test/agent-deltas.test.mjs volta junto)
-- =====================================================================

update mkt.agent_registry
   set status = 'ACTIVE'
 where agent_id in ('AGT-MKT-BRAND', 'AGT-MKT-CONTENT')
   and version = 1
   and status = 'CANDIDATE';

-- A guarda nova. Ela le side_effect do registry em vez de uma lista de nomes:
-- uma capability que ganhe efeito externo amanha passa a ser barrada sem que
-- ninguem se lembre de editar isto.
do $$
declare fora text[];
begin
  select array_agg(distinct a.agent_id || ' via ' || c.capability_id) into fora
    from mkt.agent_registry a
    join mkt.capability_registry c on c.capability_id = any(a.capabilities)
   where a.status = 'ACTIVE'
     and c.side_effect = 'external';
  if fora is not null then
    raise exception
      'agente ACTIVE alcanca efeito EXTERNO: %. Publicar e conectar canal nao sao de agente — publicar e do workflow duravel depois de decisao humana, conectar e consentimento no navegador.', fora;
  end if;
end $$;

-- E a confirmacao de que esta migration fez o que diz.
do $$
declare n int;
begin
  select count(*) into n from mkt.agent_registry
   where agent_id in ('AGT-MKT-BRAND','AGT-MKT-CONTENT') and version = 1 and status = 'ACTIVE';
  if n <> 2 then
    raise exception 'esperava BRAND e CONTENT ACTIVE, encontrei %', n;
  end if;
end $$;

comment on table mkt.agent_registry is
  'Agente nasce CANDIDATE. Promover para ACTIVE e ato de governanca e entra por migration, com o motivo junto. Desde a 0013 o teto e o efeito EXTERNO, nao a escrita: nenhum agente ACTIVE pode ter capability de side_effect external.';
