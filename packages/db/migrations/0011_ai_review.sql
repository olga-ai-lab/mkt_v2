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
--   delete from mkt.rule_policies where policy_id = 'POL_AI_REVIEW_DEFAULT';
--   delete from mkt.capability_registry where capability_id = 'quality.ai_review';
--   update mkt.agent_registry
--      set capabilities = array_remove(
--            array_remove(capabilities, 'quality.ai_review'), 'approval.request')
--    where agent_id = 'AGT-MKT-CONTENT' and version = 1;
-- =====================================================================

insert into mkt.capability_registry
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
insert into mkt.rule_policies
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
update mkt.agent_registry
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
  select count(*) into n from mkt.capability_registry
   where capability_id = 'quality.ai_review' and status = 'ACTIVE'
     and mode = 'write' and side_effect = 'internal';
  if n <> 1 then
    raise exception 'quality.ai_review nao ficou ACTIVE como write/internal (linhas: %)', n;
  end if;

  select count(*) into n from mkt.rule_policies
   where policy_id = 'POL_AI_REVIEW_DEFAULT' and status = 'ACTIVE';
  if n <> 1 then
    raise exception 'POL_AI_REVIEW_DEFAULT ausente: capability de escrita sem policy e negada pelo gateway';
  end if;

  select count(*) into n from mkt.agent_registry
   where agent_id = 'AGT-MKT-CONTENT' and version = 1
     and capabilities @> '{quality.ai_review,approval.request}';
  if n <> 1 then
    raise exception 'AGT-MKT-CONTENT nao ganhou quality.ai_review e approval.request no charter';
  end if;

  -- Capability ACTIVE que nenhum agente pode chamar e uma porta murada: existe
  -- no registry, passa em todo teste de unidade, e nunca e alcancada. Foi assim
  -- que approval.request ficou cinco migrations sem dono.
  select count(*) into n
    from mkt.capability_registry c
   where c.status = 'ACTIVE'
     and not exists (
       select 1 from mkt.agent_registry a where a.capabilities @> array[c.capability_id]);
  if n > 0 then
    raise warning 'ha % capability(s) ACTIVE que nenhum agente tem no charter', n;
  end if;
end $$;

comment on table mkt.marketing_events is
  'Fatos de dominio, para auditoria e analise. Diferente do outbox: outbox e evento que precisa ser ENTREGUE a um consumidor, e este e fato que precisa ficar REGISTRADO. O primeiro escritor e a revisao de IA, que grava aqui o laudo que justificou a transicao para AI_REVIEW — estado sem evidencia e confianca sem lastro.';
