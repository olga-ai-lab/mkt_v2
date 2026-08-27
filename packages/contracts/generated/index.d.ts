// GERADO POR scripts/generate.mjs - NAO EDITAR A MAO

/**
 * MKT-17 §5.1. O nivel descreve o que o agente pode fazer sozinho, nao quanto ele acerta.
 */
export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";

/**
 * Comprovante de efeito externo material. Sem receipt nao existe A3 nem A4.
 */
export interface ActionReceipt {
  receipt_id: string;
  trace_id: string;
  tenant: {
    org_id: string;
    workspace_id: string;
    actor_type?: "user" | "agent" | "system" | "provider";
    actor_id?: string;
    actor_role?: "OWNER" | "MARKETING" | "APPROVER";
  };
  capability_id: string;
  idempotency_key: string;
  provider?: string | null;
  external_id?: string | null;
  /**
   * Hash do request quando o adapter consegue produzi-lo. null e legitimo; o que nao pode faltar e a idempotency_key.
   */
  request_hash?: string | null;
  status: "EFFECTED" | "DEDUPLICATED" | "FAILED";
  autonomy_used?: AutonomyLevel;
  approval_id?: string | null;
  recorded_at: string;
}

/**
 * @maxItems 40
 */
export type Lista = string[];
/**
 * O campo que so existe por aqui. Uma pagina nunca diz o que a marca se recusa a dizer, entao toda versao vinda de extracao chega com esta lista vazia — e enquanto ela estiver vazia o compliance.review confere lista vazia. Preencher e trabalho humano por natureza, e nao por limitacao da extracao.
 *
 * @maxItems 40
 */
export type Lista1 = string[];

/**
 * O que uma pessoa pode mudar ao derivar uma nova versao candidata de Brand Brain. Campo ausente e herdado da versao de origem; campo presente substitui. NAO ha `source_refs` aqui, e nao ha `status`: procedencia nao se reescreve digitando, e promover e outro ato, com outro papel.
 */
export interface BrandEdit {
  identity?: {
    summary?: string;
    audience?: string;
    /**
     * @maxItems 8
     */
    differentiators?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string];
  };
  tone?: {
    voice?: string;
    /**
     * @maxItems 8
     */
    avoid?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string];
  };
  claims_allowed?: Lista;
  prohibitions?: Lista1;
  disclaimers?: Lista;
}

/**
 * O que o MODELO devolve ao ler a pagina publica de uma marca. Nao e a proposta de Brand Brain — e a materia dela. A separacao entre este contrato e olga://io/brand-proposal existe para uma coisa so: procedencia e produzida por codigo, nunca declarada pelo modelo. Por isso nao ha `source_refs` aqui, e additionalProperties: false impede que ele invente uma.
 */
export interface BrandExtraction {
  /**
   * Interpretacao. Uma sintese nao aparece literalmente na pagina, entao nao se exige citacao dela — o que se exige e que seja descricao, nunca permissao.
   */
  identity: {
    summary: string;
    audience?: string;
    /**
     * @maxItems 8
     */
    differentiators?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string];
  };
  /**
   * Interpretacao, como identity: descreve como a marca fala.
   */
  tone: {
    voice: string;
    /**
     * @maxItems 8
     */
    avoid?:
      | []
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string]
      | [string, string, string, string, string]
      | [string, string, string, string, string, string]
      | [string, string, string, string, string, string, string]
      | [string, string, string, string, string, string, string, string];
  };
  /**
   * O que a marca ja afirma publicamente sobre si. Permissao, e nao descricao: um item daqui autoriza o redator a repetir aquilo. Por isso cada um exige a citacao literal que o sustenta, conferida contra a pagina por codigo.
   *
   * @maxItems 20
   */
  claims_allowed:
    | []
    | [Grounded]
    | [Grounded, Grounded]
    | [Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ]
    | [
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded,
        Grounded
      ];
  /**
   * Texto legal presente na pagina — registro SUSEP, remissao as condicoes gerais. Mesma exigencia de lastro dos claims.
   *
   * @maxItems 10
   */
  disclaimers:
    | []
    | [Grounded]
    | [Grounded, Grounded]
    | [Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded]
    | [Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded, Grounded];
}
export interface Grounded {
  /**
   * Como o item entra no Brand Brain.
   */
  text: string;
  /**
   * Trecho LITERAL da pagina que sustenta o item. Quem confere e o adapter, comparando com o texto buscado; item cuja citacao nao esta la nao entra na proposta.
   */
  quote: string;
}

/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Saida de brand.extract_from_url: a materia de uma versao de Brand Brain, ja conferida contra a pagina que a sustenta. Nao e a versao — quem escreve e brand.propose_version, e sempre como CANDIDATE.
 */
export interface BrandProposal {
  brand_id: string;
  identity: {};
  tone: {};
  /**
   * So o que passou pela conferencia de citacao. Strings, que e a forma que mkt.brand_brain_versions ja guarda.
   */
  claims_allowed: string[];
  /**
   * Sempre vazia, e o maxItems: 0 e o que garante isso. Uma pagina nao diz o que a marca NAO quer dizer — ela diz o que a marca diz. Proibicao extraida de site seria invencao com aparencia de regra, e ela alimenta o compliance.review. Quem preenche e a pessoa que revisa o CANDIDATE.
   *
   * @maxItems 0
   */
  prohibitions: [];
  disclaimers: string[];
  /**
   * Procedencia, construida pelo adapter a partir do que foi realmente buscado. minItems: 1 porque proposta sem fonte nao e proposta.
   *
   * @minItems 1
   */
  source_refs: [
    {
      kind: "WEB_PAGE";
      /**
       * A URL FINAL, depois dos redirecionamentos. Guardar a pedida esconderia para onde a leitura foi parar.
       */
      locator: string;
      /**
       * Hash do texto extraido, nao do HTML: e o texto que o modelo leu.
       */
      hash: string;
      retrieved_at: string;
    },
    ...{
      kind: "WEB_PAGE";
      /**
       * A URL FINAL, depois dos redirecionamentos. Guardar a pedida esconderia para onde a leitura foi parar.
       */
      locator: string;
      /**
       * Hash do texto extraido, nao do HTML: e o texto que o modelo leu.
       */
      hash: string;
      retrieved_at: string;
    }[]
  ];
  /**
   * O que o modelo propos e a conferencia recusou. Descartar em silencio seria pior que aceitar: quem revisa o CANDIDATE precisa saber que houve item sem lastro, porque isso diz algo sobre a extracao inteira.
   */
  discarded: {
    field: "claims_allowed" | "disclaimers";
    text: string;
    reason_code: ReasonCode;
  }[];
}

export type CapabilityMode = "read" | "simulate" | "write";
/**
 * MKT-17 §5.1. O nivel descreve o que o agente pode fazer sozinho, nao quanto ele acerta.
 */
export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";

/**
 * Pedido tipado ao Capability Gateway. args e produzido pelo compiler deterministico.
 */
export interface CapabilityRequest {
  trace_id: string;
  tenant: {
    org_id: string;
    workspace_id: string;
    actor_type?: "user" | "agent" | "system" | "provider";
    actor_id?: string;
    actor_role?: "OWNER" | "MARKETING" | "APPROVER";
  };
  capability_id: string;
  capability_version: number;
  mode: CapabilityMode;
  args: {};
  /**
   * Chave estavel por efeito material. Nunca derivada apenas de texto livre do LLM (MKT-09 03).
   */
  idempotency_key: string;
  requested_autonomy?: AutonomyLevel;
  approval_id?: string | null;
}

/**
 * Toda afirmacao material precisa de mapeamento claim -> evidence. Sem isso o conteudo nao passa do gate de qualidade.
 */
export interface ClaimSet {
  trace_id: string;
  claims: {
    claim_id: string;
    text: string;
    /**
     * Material = afirma cobertura, preco, prazo, sinistro ou resultado.
     */
    material: boolean;
    claim_type?: "COVERAGE" | "PRICE" | "DEADLINE" | "PERFORMANCE" | "GENERAL";
    evidence_ids: string[];
  }[];
}

/**
 * Enum fechado. Classifica o que uma peca de conteudo AFIRMA. COVERAGE, PRICE e DEADLINE sao os tres que a policy global POL_COMPLIANCE_ON_MATERIAL_CLAIM trata como materiais: afirmacao sobre cobertura, preco ou prazo sempre passa por humano. A mesma lista esta no CHECK de mkt.claims.claim_type (migracao 0002) — mudar aqui exige mudar la, e vice-versa.
 */
export type ClaimType = "COVERAGE" | "PRICE" | "DEADLINE" | "PERFORMANCE" | "GENERAL";

/**
 * Saida do redator para content.create_draft. O modelo escreve o texto e DECLARA o que afirmou; a declaracao nao e permissao — claim material sem evidence e recusado pela capability e pela constraint claim_material_requires_evidence.
 */
export interface DraftComposition {
  title: string;
  master_body: string;
  /**
   * Lista, possivelmente vazia. Vazia significa 'nao afirmei nada verificavel', e o compliance.review le o texto gravado para conferir.
   */
  claims: {
    text: string;
    claim_type: ClaimType;
    material: boolean;
  }[];
}

/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Resolucao determinista de referencia para ID canonico.
 */
export interface EntityResolution {
  trace_id: string;
  tenant: {
    org_id: string;
    workspace_id: string;
    actor_type?: "user" | "agent" | "system" | "provider";
    actor_id?: string;
    actor_role?: "OWNER" | "MARKETING" | "APPROVER";
  };
  resolved: {
    entity_type: string;
    canonical_id: string;
    /**
     * Fuzzy merge irrestrito e proibido no caminho principal (MKT-08 §8).
     */
    method: "exact_id" | "unique_natural_key" | "user_confirmed";
    confidence_band?: "HIGH" | "MEDIUM" | "LOW";
  }[];
  unresolved?: {
    entity_type: string;
    raw?: string;
    reason_code: ReasonCode;
  }[];
}

/**
 * Provenance. Evidence sem origem e proibida (MKT-09B §5).
 */
export interface EvidencePackage {
  trace_id: string;
  items: {
    evidence_id: string;
    source_kind: "BRAND_BRAIN" | "SOURCE_ARTIFACT" | "UPLOADED_FILE" | "PROVIDER_RESPONSE" | "DOMAIN_RECORD";
    locator: string;
    hash: string;
    retrieved_at?: string;
    quality?: "HIGH" | "MEDIUM" | "LOW";
  }[];
}

/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Resultado bruto do adapter, ja normalizado quanto ao erro.
 */
export interface ExecutionResult {
  trace_id: string;
  capability_id: string;
  status: "SUCCEEDED" | "FAILED" | "DEDUPLICATED" | "BLOCKED";
  provider?: string | null;
  external_id?: string | null;
  error?: null | {
    class: "TRANSIENT" | "PERMANENT" | "POLICY" | "VALIDATION";
    reason_code: ReasonCode;
    retryable: boolean;
    provider_message?: string;
  };
  /**
   * Zero quando a execucao foi bloqueada por policy ou deduplicada por idempotencia — nesses casos o provider nunca foi chamado.
   */
  attempts?: number;
  started_at: string;
  finished_at: string;
}

/**
 * MKT-SPEC-STANDARD-01 §10. Os oito estados sao fechados; nenhum estado pode ser inventado em texto livre.
 */
export type RespondabilityState =
  | "EXECUTABLE"
  | "CLARIFICATION_REQUIRED"
  | "UNSUPPORTED"
  | "POLICY_BLOCKED"
  | "QUALITY_BLOCKED"
  | "TEMPORARILY_UNAVAILABLE"
  | "APPROVAL_REQUIRED"
  | "HANDOFF_HUMAN";
/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Resposta ao usuario. Sempre carrega estado e proximo passo (MKT-06 §2).
 */
export interface FinalResponse {
  trace_id: string;
  respondability: RespondabilityState;
  message: string;
  next_step: string;
  /**
   * MKT-06A §7: toda acao da Olga carrega modo visivel.
   */
  autonomy_mode?: ("SUGGEST" | "DRAFT" | "GOVERNED_EXECUTE" | "AUTOPILOT") | null;
  reason_codes?: ReasonCode[];
  evidence_ids?: string[];
  receipt_ids?: string[];
}

/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Saida do resolver. O LLM interpreta; nada aqui autoriza execucao.
 */
export interface IntentResolution {
  trace_id: string;
  tenant: {
    org_id: string;
    workspace_id: string;
    actor_type?: "user" | "agent" | "system" | "provider";
    actor_id?: string;
    actor_role?: "OWNER" | "MARKETING" | "APPROVER";
  };
  intent:
    | "CREATE_CONTENT"
    | "PLAN_EDITORIAL"
    | "PUBLISH_CONTENT"
    | "REVIEW_CONTENT"
    | "CONNECT_CHANNEL"
    | "ONBOARD_BRAND"
    | "EXPLAIN"
    | "UNKNOWN";
  /**
   * Banda, nunca percentual. MKT-06A §7 proibe 'confianca 92%' como substituto de reason code.
   */
  confidence_band: "HIGH" | "MEDIUM" | "LOW";
  entities: {
    type: string;
    canonical_id: string | null;
    raw?: string;
  }[];
  ambiguities: {
    field: string;
    reason_code: ReasonCode;
    options?: string[];
  }[];
}

/**
 * MKT-SPEC-STANDARD-01 §10. Os oito estados sao fechados; nenhum estado pode ser inventado em texto livre.
 */
export type RespondabilityState =
  | "EXECUTABLE"
  | "CLARIFICATION_REQUIRED"
  | "UNSUPPORTED"
  | "POLICY_BLOCKED"
  | "QUALITY_BLOCKED"
  | "TEMPORARILY_UNAVAILABLE"
  | "APPROVAL_REQUIRED"
  | "HANDOFF_HUMAN";
/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";
/**
 * MKT-17 §5.1. O nivel descreve o que o agente pode fazer sozinho, nao quanto ele acerta.
 */
export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";

/**
 * Decisao do gate. Nenhuma capability de escrita executa sem um EXECUTABLE aqui.
 */
export interface RespondabilityResult {
  trace_id: string;
  state: RespondabilityState;
  reason_codes?: ReasonCode[];
  granted_autonomy?: AutonomyLevel | null;
  required_approval?: boolean;
  user_message_key?: string;
  evaluated_at: string;
  policy_versions: {
    policy_id: string;
    version: number;
  }[];
}

export type CapabilityMode = "read" | "simulate" | "write";

/**
 * Plano proposto pelo agente. Proposta, nao autorizacao.
 */
export interface TaskPlan {
  trace_id: string;
  tenant: {
    org_id: string;
    workspace_id: string;
    actor_type?: "user" | "agent" | "system" | "provider";
    actor_id?: string;
    actor_role?: "OWNER" | "MARKETING" | "APPROVER";
  };
  agent_id: string;
  agent_version: string;
  /**
   * @minItems 1
   */
  steps: [
    {
      step_id: string;
      capability_id: string;
      mode: CapabilityMode;
      /**
       * Resumo humano. Os args reais sao construidos pelo compiler, nunca pelo LLM.
       */
      args_summary: string;
      depends_on?: string[];
    },
    ...{
      step_id: string;
      capability_id: string;
      mode: CapabilityMode;
      /**
       * Resumo humano. Os args reais sao construidos pelo compiler, nunca pelo LLM.
       */
      args_summary: string;
      depends_on?: string[];
    }[]
  ];
  expected_outcome?: string;
}

/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Conjunto de checks nomeados com o resultado de cada um. Duas familias usam este contrato: o Result Validator do loop (MKT-09B §5) com os cinco checks tecnicos, e as capabilities de modo simulate (quality.precheck, compliance.review) com os checks de conteudo. Nunca converte erro em sucesso.
 */
export interface ValidatedResult {
  trace_id: string;
  valid: boolean;
  checks: {
    check:
      | "schema"
      | "freshness"
      | "cardinality"
      | "tenant_scope"
      | "failure_normalized"
      | "claims_supported"
      | "evidence_sufficient"
      | "duplicate_risk"
      | "prohibitions"
      | "material_claims"
      | "disclaimers";
    passed: boolean;
    detail?: string;
  }[];
  reason_codes?: ReasonCode[];
}

/**
 * Saida do redator para content.create_variant. Adapta forma, nao substancia: nao ha campo para claim aqui porque uma variante nao afirma nada novo — o que foi afirmado ja passou pelos claims do master.
 */
export interface VariantComposition {
  headline?: string | null;
  body: string;
  cta?: string | null;
}

export type CapabilityMode = "read" | "simulate" | "write";
/**
 * MKT-17 §5.1. O nivel descreve o que o agente pode fazer sozinho, nao quanto ele acerta.
 */
export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";
/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Delta por agente. Tudo que e comum vive em docs/AGT-BASE.md (aprimoramento M1).
 */
export interface AgentDefinition {
  agent_id: string;
  version: number;
  status: "DRAFT" | "CANDIDATE" | "ACTIVE" | "DEPRECATED" | "BLOCKED";
  mission: string;
  most_expensive_failure?: string;
  /**
   * @minItems 1
   */
  modes: [CapabilityMode, ...CapabilityMode[]];
  baseline_autonomy: AutonomyLevel;
  max_autonomy?: AutonomyLevel;
  /**
   * @minItems 1
   */
  capabilities: [string, ...string[]];
  /**
   * @minItems 1
   */
  primary_schemas: [string, ...string[]];
  reason_codes: ReasonCode[];
  model_profile?: {
    task_class?:
      "reasoning" | "extraction" | "classification" | "copywriting" | "vision" | "image_generation" | "embedding";
    primary?: string;
    fallback?: string | null;
    max_cost_cents_per_run?: number;
  };
  owner: string;
  /**
   * Unico lugar onde o agente pode divergir do AGT-BASE. Lista vazia = segue a base.
   */
  deviates_from_base?: string[];
}

/**
 * Fecha o G7. O Capability Gateway so executa o que esta ACTIVE neste registry.
 */
export type CapabilityDefinition = {
  [k: string]: unknown;
} & {
  capability_id: string;
  version: number;
  status: "DRAFT" | "CANDIDATE" | "ACTIVE" | "DEPRECATED" | "BLOCKED";
  mode: CapabilityMode;
  side_effect: "none" | "internal" | "external";
  risk_tier: RiskTier;
  input_schema_ref: string;
  output_schema_ref: string;
  error_codes: ReasonCode[];
  /**
   * @minItems 1
   */
  permissions: ["OWNER" | "MARKETING" | "APPROVER", ...("OWNER" | "MARKETING" | "APPROVER")[]];
  idempotency?: {
    required: boolean;
    /**
     * Ex: {workspace_id}:{content_version_id}:{channel}:{connection_id}
     */
    key_template?: string;
  };
  provider_adapter?: string | null;
  timeout_ms?: number;
  retry_policy?: {
    max_attempts?: number;
    backoff?: "none" | "linear" | "exponential";
    retry_on?: "TRANSIENT"[];
  };
  owner?: string;
};
export type CapabilityMode = "read" | "simulate" | "write";
/**
 * MKT-17 §5.1. Determina a autonomia maxima permitida.
 */
export type RiskTier = "LOW" | "MEDIUM" | "HIGH";
/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Canal canonico. Nunca o nome livre do provider (MKT-08 §16).
 */
export type Channel = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "BLOG" | "EMAIL" | "WHATSAPP";
/**
 * MKT-17 §5.1. Determina a autonomia maxima permitida.
 */
export type RiskTier = "LOW" | "MEDIUM" | "HIGH";
/**
 * Fatos avaliaveis pelo Policy Engine. O avaliador nunca le texto livre.
 */
export type PolicyFact =
  | "consent_status"
  | "channel_connected"
  | "content_status"
  | "risk_tier"
  | "actor_role"
  | "claim_types"
  | "audience_size"
  | "autonomy_requested"
  | "brand_brain_status"
  | "evidence_coverage"
  | "workspace_first_publish"
  | "capability_mode"
  | "estimated_cost_cents";
/**
 * MKT-17 §5.1. O nivel descreve o que o agente pode fazer sozinho, nao quanto ele acerta.
 */
export type AutonomyLevel = "A0" | "A1" | "A2" | "A3" | "A4";
/**
 * Enum fechado. Reason code explica o ponto de falha sem depender de chain-of-thought (MKT-SPEC §11). Novo codigo entra apenas por pull request neste arquivo.
 */
export type ReasonCode =
  | "AMBIGUOUS_AUDIENCE"
  | "AMBIGUOUS_GOAL"
  | "AMBIGUOUS_ENTITY"
  | "UNSUPPORTED_VALUE"
  | "CONSENT_MISSING"
  | "CHANNEL_NOT_CONNECTED"
  | "CONTENT_NOT_APPROVED"
  | "COMPLIANCE_REVIEW_REQUIRED"
  | "CLAIM_UNSUPPORTED"
  | "EVIDENCE_INSUFFICIENT"
  | "CONTENT_DUPLICATE_RISK"
  | "SOURCE_STALE"
  | "PROVIDER_RATE_LIMITED"
  | "DUPLICATE_OPERATION_PREVENTED"
  | "TENANT_SCOPE_VIOLATION"
  | "UNSUPPORTED_CAMPAIGN_ACTION"
  | "AUTONOMY_EXCEEDED"
  | "NO_ACTIVE_POLICY"
  | "CAPABILITY_NOT_ACTIVE"
  | "ACTOR_ROLE_FORBIDDEN"
  | "BRAND_BRAIN_NOT_ACTIVE"
  | "WORKSPACE_FIRST_PUBLISH"
  | "SPEND_LIMIT_EXCEEDED"
  | "PROVIDER_UNAVAILABLE"
  | "SCHEMA_VALIDATION_FAILED"
  | "MODEL_ROUTE_NOT_ACTIVE"
  | "AGENT_NOT_ACTIVE"
  | "MODEL_OUTPUT_INVALID"
  | "BUDGET_NOT_CONFIGURED"
  | "NORMALIZATION_FAILED";

/**
 * Policy como dado tipado (aprimoramento M4). O avaliador e deterministico; o LLM nunca interpreta policy.
 */
export interface RulePolicy {
  policy_id: string;
  version: number;
  status: "DRAFT" | "CANDIDATE" | "ACTIVE" | "DEPRECATED" | "BLOCKED";
  /**
   * Menor vence. Primeira correspondencia decide.
   */
  priority: number;
  scope: {
    capability_id?: string | null;
    channel?: Channel | null;
    agent_id?: string | null;
    risk_tier?: RiskTier | null;
  };
  conditions: {
    fact: PolicyFact;
    op: "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte" | "contains_any" | "is_true" | "is_false";
    value: unknown;
  }[];
  effect: "ALLOW" | "REQUIRE_APPROVAL" | "BLOCK";
  max_autonomy?: AutonomyLevel;
  reason_code?: ReasonCode;
  message_key?: string;
  note?: string;
}

/**
 * Canal canonico. Nunca o nome livre do provider (MKT-08 §16).
 */
export type Channel = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "BLOG" | "EMAIL" | "WHATSAPP";
/**
 * MKT-17 §5.1. Determina a autonomia maxima permitida.
 */
export type RiskTier = "LOW" | "MEDIUM" | "HIGH";

export interface ChannelVariantDraft {
  channel: Channel;
  headline?: string | null;
  body: string;
  cta?: string | null;
  hashtags?: string[];
  asset_refs?: string[];
  claim_set_ref: string;
  risk_tier?: RiskTier;
  char_count?: number;
}

/**
 * Canal canonico. Nunca o nome livre do provider (MKT-08 §16).
 */
export type Channel = "INSTAGRAM" | "FACEBOOK" | "LINKEDIN" | "BLOG" | "EMAIL" | "WHATSAPP";

export interface ContentBrief {
  objective: string;
  angle?: string;
  /**
   * @minItems 1
   */
  channels: [Channel, ...Channel[]];
  insurance_product?: string | null;
  persona?: string | null;
  cta?: string | null;
  brand_brain_version_id: string;
  input_kind?: "BRIEFING" | "FILE" | "PHOTO" | "INSIGHT";
  evidence_ids?: string[];
}
