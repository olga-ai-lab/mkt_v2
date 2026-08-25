-- =====================================================================
-- 0006_seed_registries.sql  |  Capabilities, agentes e policies globais do MVP.
-- Dados, nao codigo. Alterar aqui e uma migracao, com revisao e rastro.
-- =====================================================================

insert into mkt.capability_registry
 (capability_id, version, status, mode, side_effect, risk_tier, input_schema_ref, output_schema_ref,
  error_codes, permissions, idempotency_required, idempotency_key_template, provider_adapter, timeout_ms, max_attempts, owner)
values
 ('brand.read', 1, 'ACTIVE', 'read', 'none', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{}','{OWNER,MARKETING,APPROVER}', false, null, null, 10000, 2, 'AI Platform'),

 ('brand.extract_from_url', 1, 'ACTIVE', 'read', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{SOURCE_STALE,PROVIDER_UNAVAILABLE}','{OWNER,MARKETING}', false, null, 'web_fetch', 60000, 2, 'Brand'),

 ('brand.propose_version', 1, 'ACTIVE', 'write', 'internal', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{SCHEMA_VALIDATION_FAILED}','{OWNER,MARKETING}', false, null, null, 15000, 2, 'Brand'),

 ('evidence.read', 1, 'ACTIVE', 'read', 'none', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{}','{OWNER,MARKETING,APPROVER}', false, null, null, 10000, 2, 'AI Platform'),

 ('content.create_draft', 1, 'ACTIVE', 'write', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{EVIDENCE_INSUFFICIENT,CLAIM_UNSUPPORTED,BRAND_BRAIN_NOT_ACTIVE}','{OWNER,MARKETING}',
  false, null, null, 90000, 2, 'Content'),

 ('content.create_variant', 1, 'ACTIVE', 'write', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{CONTENT_DUPLICATE_RISK}','{OWNER,MARKETING}', false, null, null, 60000, 2, 'Content'),

 ('quality.precheck', 1, 'ACTIVE', 'simulate', 'none', 'LOW',
  'olga://io/capability-request','olga://io/validated-result',
  '{CLAIM_UNSUPPORTED,EVIDENCE_INSUFFICIENT,CONTENT_DUPLICATE_RISK}','{OWNER,MARKETING,APPROVER}',
  false, null, null, 20000, 2, 'Content'),

 ('compliance.review', 1, 'ACTIVE', 'simulate', 'none', 'HIGH',
  'olga://io/capability-request','olga://io/validated-result',
  '{COMPLIANCE_REVIEW_REQUIRED,CLAIM_UNSUPPORTED}','{OWNER,APPROVER}', false, null, null, 30000, 2, 'Compliance'),

 ('approval.request', 1, 'ACTIVE', 'write', 'internal', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{CONTENT_NOT_APPROVED}','{OWNER,MARKETING}', false, null, null, 10000, 2, 'Governance'),

 ('channel.connect', 1, 'ACTIVE', 'write', 'external', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{CHANNEL_NOT_CONNECTED,PROVIDER_UNAVAILABLE}','{OWNER}',
  true, '{workspace_id}:{channel}:{external_account_id}', 'meta_graph', 30000, 3, 'Publishing'),

 ('publishing.schedule', 1, 'ACTIVE', 'write', 'internal', 'LOW',
  'olga://io/capability-request','olga://io/execution-result',
  '{CONTENT_NOT_APPROVED,CHANNEL_NOT_CONNECTED}','{OWNER,MARKETING}', false, null, null, 10000, 2, 'Publishing'),

 ('publishing.publish', 1, 'ACTIVE', 'write', 'external', 'MEDIUM',
  'olga://io/capability-request','olga://io/execution-result',
  '{CHANNEL_NOT_CONNECTED,CONTENT_NOT_APPROVED,PROVIDER_RATE_LIMITED,DUPLICATE_OPERATION_PREVENTED,PROVIDER_UNAVAILABLE}',
  '{OWNER,MARKETING}', true,
  '{workspace_id}:{content_version_id}:{channel}:{connection_id}', 'meta_graph', 45000, 5, 'Publishing');

insert into mkt.agent_registry
 (agent_id, version, status, mission, modes, baseline_autonomy, max_autonomy, capabilities, reason_codes, model_profile, deviates_from_base, owner)
values
 ('AGT-MKT-COPILOT', 1, 'CANDIDATE',
  'Interpretar pedidos, manter contexto, escolher o especialista correto e explicar o proximo passo.',
  '{read,simulate}', 'A1', 'A2',
  '{brand.read,evidence.read,quality.precheck}',
  '{AMBIGUOUS_GOAL,AMBIGUOUS_ENTITY,UNSUPPORTED_VALUE,TENANT_SCOPE_VIOLATION}',
  '{"task_class":"reasoning","max_cost_cents_per_run":8}', '{}', 'AI Platform'),

 ('AGT-MKT-BRAND', 1, 'CANDIDATE',
  'Construir o Brand Brain a partir do site e de revisao humana estruturada.',
  '{read,write}', 'A2', 'A2',
  '{brand.extract_from_url,brand.propose_version,brand.read}',
  '{SOURCE_STALE,EVIDENCE_INSUFFICIENT,BRAND_BRAIN_NOT_ACTIVE}',
  '{"task_class":"extraction","max_cost_cents_per_run":25}',
  '{"Promove versao apenas para CANDIDATE; a promocao para ACTIVE e sempre humana."}', 'Brand'),

 ('AGT-MKT-CONTENT', 1, 'CANDIDATE',
  'Criar master content e variantes por canal alinhadas a BrandBrain, evidence e objetivo.',
  '{read,write}', 'A2', 'A3',
  '{brand.read,evidence.read,content.create_draft,content.create_variant,quality.precheck,publishing.schedule}',
  '{CONTENT_DUPLICATE_RISK,CLAIM_UNSUPPORTED,EVIDENCE_INSUFFICIENT,COMPLIANCE_REVIEW_REQUIRED}',
  '{"task_class":"copywriting","max_cost_cents_per_run":40}',
  '{"Absorve INTEL, PLANNER e VISUAL como capabilities ate a Fase 3 (MKT-17 §5.6)."}', 'Content'),

 ('AGT-MKT-COMPLIANCE', 1, 'CANDIDATE',
  'Verificar claims contra o Brand Brain, a lista de proibicoes e os disclaimers por produto.',
  '{read,simulate}', 'A1', 'A2',
  '{brand.read,evidence.read,compliance.review}',
  '{COMPLIANCE_REVIEW_REQUIRED,CLAIM_UNSUPPORTED,EVIDENCE_INSUFFICIENT}',
  '{"task_class":"classification","max_cost_cents_per_run":10}', '{}', 'Compliance');

-- ---------------------------------------------------------------------
-- Policies globais (org_id NULL). Restringem; nunca concedem alem do teto.
-- ---------------------------------------------------------------------
insert into mkt.rule_policies
 (org_id, policy_id, version, status, priority, scope, conditions, effect, max_autonomy, reason_code, message_key, note)
values
 (null, 'POL_BLOCK_UNCONNECTED_CHANNEL', 1, 'ACTIVE', 10,
  '{}'::jsonb,
  '[{"fact":"channel_connected","op":"is_false","value":true}]'::jsonb,
  'BLOCK', null, 'CHANNEL_NOT_CONNECTED', 'policy.channel_not_connected',
  'Sem conexao valida nao existe publicacao possivel.'),

 (null, 'POL_BLOCK_UNAPPROVED_CONTENT', 1, 'ACTIVE', 20,
  '{"capability_id":"publishing.publish"}'::jsonb,
  '[{"fact":"content_status","op":"not_in","value":["APPROVED","SCHEDULED","PUBLISHING"]}]'::jsonb,
  'BLOCK', null, 'CONTENT_NOT_APPROVED', 'policy.content_not_approved',
  'Conteudo nao aprovado nao vira efeito externo.'),

 (null, 'POL_COMPLIANCE_ON_MATERIAL_CLAIM', 1, 'ACTIVE', 30,
  '{}'::jsonb,
  '[{"fact":"claim_types","op":"contains_any","value":["COVERAGE","PRICE","DEADLINE"]}]'::jsonb,
  'REQUIRE_APPROVAL', 'A2', 'COMPLIANCE_REVIEW_REQUIRED', 'policy.compliance_required',
  'Claim de cobertura, preco ou prazo sempre passa por humano.'),

 (null, 'POL_FIRST_PUBLISH_NEEDS_HUMAN', 1, 'ACTIVE', 40,
  '{"capability_id":"publishing.publish"}'::jsonb,
  '[{"fact":"workspace_first_publish","op":"is_true","value":true}]'::jsonb,
  'REQUIRE_APPROVAL', 'A3', 'WORKSPACE_FIRST_PUBLISH', 'policy.first_publish',
  'A primeira publicacao de um workspace e sempre aprovada por uma pessoa.'),

 (null, 'POL_PUBLISH_SOCIAL_DEFAULT', 1, 'ACTIVE', 500,
  '{"capability_id":"publishing.publish"}'::jsonb,
  '[{"fact":"channel_connected","op":"is_true","value":true},
    {"fact":"content_status","op":"in","value":["APPROVED","SCHEDULED"]}]'::jsonb,
  'ALLOW', 'A3', null, 'policy.publish_allowed',
  'Default do MVP: publicar exige aprovacao por item (A3). A4 so apos o gate G3.'),

 (null, 'POL_DRAFT_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"content.create_draft"}'::jsonb,
  '[]'::jsonb,
  'ALLOW', 'A2', null, 'policy.draft_allowed',
  'Rascunho e sempre permitido ate A2: cria objeto em DRAFT, sem efeito externo.'),

 (null, 'POL_VARIANT_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"content.create_variant"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.draft_allowed', 'Idem para variantes por canal.'),

 (null, 'POL_SCHEDULE_DEFAULT', 1, 'ACTIVE', 550,
  '{"capability_id":"publishing.schedule"}'::jsonb,
  '[{"fact":"content_status","op":"in","value":["APPROVED"]}]'::jsonb,
  'ALLOW', 'A3', null, 'policy.schedule_allowed', 'Agendar conteudo ja aprovado.'),

 (null, 'POL_APPROVAL_REQUEST_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"approval.request"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.approval_request_allowed', 'Pedir revisao humana nunca e bloqueado.'),

 (null, 'POL_BRAND_PROPOSE_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"brand.propose_version"}'::jsonb,
  '[]'::jsonb, 'ALLOW', 'A2', null, 'policy.brand_propose_allowed',
  'O agente propoe versao CANDIDATE; promover para ACTIVE e ato humano.'),

 (null, 'POL_CHANNEL_CONNECT_DEFAULT', 1, 'ACTIVE', 600,
  '{"capability_id":"channel.connect"}'::jsonb,
  '[]'::jsonb, 'REQUIRE_APPROVAL', 'A3', null, 'policy.channel_connect',
  'Conectar canal e ato do OWNER, sempre com confirmacao.');
