// GERADO POR scripts/generate.mjs - NAO EDITAR A MAO
//
// Imports estaticos de proposito: o rastreador de arquivos do bundler segue
// `import` e nao caminho montado em tempo de execucao. Ler o diretorio aqui
// deixaria os .json fora do bundle, e toda rota quebraria na primeira
// requisicao — porque `assertValid` esta em todas.

import s_enums_autonomy from "../enums/autonomy.json" with { type: "json" };
import s_enums_capability_mode from "../enums/capability-mode.json" with { type: "json" };
import s_enums_channel from "../enums/channel.json" with { type: "json" };
import s_enums_claim_type from "../enums/claim-type.json" with { type: "json" };
import s_enums_content_state from "../enums/content-state.json" with { type: "json" };
import s_enums_policy_fact from "../enums/policy-fact.json" with { type: "json" };
import s_enums_reason_codes from "../enums/reason-codes.json" with { type: "json" };
import s_enums_respondability from "../enums/respondability.json" with { type: "json" };
import s_enums_risk_tier from "../enums/risk-tier.json" with { type: "json" };
import s_enums_source_kind from "../enums/source-kind.json" with { type: "json" };
import s_enums_task_class from "../enums/task-class.json" with { type: "json" };
import s_schemas_io_action_receipt from "../schemas/io/action-receipt.json" with { type: "json" };
import s_schemas_io_brand_edit from "../schemas/io/brand-edit.json" with { type: "json" };
import s_schemas_io_brand_extraction from "../schemas/io/brand-extraction.json" with { type: "json" };
import s_schemas_io_brand_proposal from "../schemas/io/brand-proposal.json" with { type: "json" };
import s_schemas_io_capability_request from "../schemas/io/capability-request.json" with { type: "json" };
import s_schemas_io_claim_set from "../schemas/io/claim-set.json" with { type: "json" };
import s_schemas_io_draft_composition from "../schemas/io/draft-composition.json" with { type: "json" };
import s_schemas_io_entity_resolution from "../schemas/io/entity-resolution.json" with { type: "json" };
import s_schemas_io_evidence_package from "../schemas/io/evidence-package.json" with { type: "json" };
import s_schemas_io_execution_result from "../schemas/io/execution-result.json" with { type: "json" };
import s_schemas_io_final_response from "../schemas/io/final-response.json" with { type: "json" };
import s_schemas_io_intent_resolution from "../schemas/io/intent-resolution.json" with { type: "json" };
import s_schemas_io_respondability_result from "../schemas/io/respondability-result.json" with { type: "json" };
import s_schemas_io_task_plan from "../schemas/io/task-plan.json" with { type: "json" };
import s_schemas_io_validated_result from "../schemas/io/validated-result.json" with { type: "json" };
import s_schemas_io_variant_composition from "../schemas/io/variant-composition.json" with { type: "json" };
import s_schemas_registry_agent_definition from "../schemas/registry/agent-definition.json" with { type: "json" };
import s_schemas_registry_agent_persona from "../schemas/registry/agent-persona.json" with { type: "json" };
import s_schemas_registry_capability_definition from "../schemas/registry/capability-definition.json" with { type: "json" };
import s_schemas_registry_rule_policy from "../schemas/registry/rule-policy.json" with { type: "json" };
import s_schemas_registry_source_contract from "../schemas/registry/source-contract.json" with { type: "json" };
import s_schemas_domain_channel_variant_draft from "../schemas/domain/channel-variant-draft.json" with { type: "json" };
import s_schemas_domain_content_brief from "../schemas/domain/content-brief.json" with { type: "json" };

export const enums = [
  s_enums_autonomy,
  s_enums_capability_mode,
  s_enums_channel,
  s_enums_claim_type,
  s_enums_content_state,
  s_enums_policy_fact,
  s_enums_reason_codes,
  s_enums_respondability,
  s_enums_risk_tier,
  s_enums_source_kind,
  s_enums_task_class,
];
export const ioSchemas = [
  s_schemas_io_action_receipt,
  s_schemas_io_brand_edit,
  s_schemas_io_brand_extraction,
  s_schemas_io_brand_proposal,
  s_schemas_io_capability_request,
  s_schemas_io_claim_set,
  s_schemas_io_draft_composition,
  s_schemas_io_entity_resolution,
  s_schemas_io_evidence_package,
  s_schemas_io_execution_result,
  s_schemas_io_final_response,
  s_schemas_io_intent_resolution,
  s_schemas_io_respondability_result,
  s_schemas_io_task_plan,
  s_schemas_io_validated_result,
  s_schemas_io_variant_composition,
];
export const registrySchemas = [
  s_schemas_registry_agent_definition,
  s_schemas_registry_agent_persona,
  s_schemas_registry_capability_definition,
  s_schemas_registry_rule_policy,
  s_schemas_registry_source_contract,
];
export const domainSchemas = [
  s_schemas_domain_channel_variant_draft,
  s_schemas_domain_content_brief,
];

export const allSchemas = [...enums, ...ioSchemas, ...registrySchemas, ...domainSchemas];
