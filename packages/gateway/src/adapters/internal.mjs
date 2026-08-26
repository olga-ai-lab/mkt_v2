/**
 * Adapter interno.
 *
 * As capabilities do registry se dividem em duas familias: as que saem para um
 * provider (meta_graph, web_fetch) e as que acontecem dentro de casa. O
 * gateway resolve as duas do mesmo jeito, na linha
 *
 *   const adapter = adapters[cap.provider_adapter ?? "internal"];
 *
 * Nove das doze capabilities do MVP tem `provider_adapter` nulo e caem no
 * "internal". Ate aqui esse nome nao existia no mapa: o gateway respondia
 * PROVIDER_UNAVAILABLE para todas elas. As tres capabilities do AGT-MKT-COPILOT
 * — o agente que acabou de ser promovido a ACTIVE — sao todas internas.
 *
 * ── O que "interno" quer dizer, e o que nao quer ───────────────────────────
 *
 * Quer dizer que o efeito e no nosso banco, nao que ele e menos governado. O
 * caminho ate aqui foi o mesmo: capability ACTIVE, RBAC, policy, autonomia,
 * aprovacao. Quando este arquivo e chamado, a decisao ja foi tomada por outro.
 * Nada aqui reavalia policy — se precisasse, a fronteira estaria no lugar
 * errado.
 *
 * ── Onde o modelo entra, e onde ele nao entra ──────────────────────────────
 *
 * Duas capabilities escrevem TEXTO — content.create_draft e
 * content.create_variant — e texto e trabalho de modelo. Elas recebem uma
 * porta `compose` e nada mais: o adapter nao conhece model gateway, rota, nem
 * provider.
 *
 * As outras sete nao chamam modelo nenhum. quality.precheck e
 * compliance.review em especial: verificar se um claim material tem evidence e
 * contagem, nao julgamento. Se um modelo decidisse isso, a mesma peca de
 * conteudo passaria hoje e reprovaria amanha — e "o codigo calcula" existe
 * exatamente para essa classe de pergunta.
 */
import { CapabilityError } from "../index.mjs";

/**
 * Codigos de erro do Postgres em que o servidor GARANTE rollback.
 *
 * Sao os unicos seguros para o gateway tentar de novo. Perda de conexao NAO
 * entra: um commit pode ter acontecido do outro lado sem a resposta chegar, e
 * capability interna nao tem chave de idempotencia para deduplicar a segunda
 * tentativa. Repetir ali criaria um segundo rascunho identico.
 */
const ROLLBACK_GARANTIDO = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

function comoFalha(e) {
  if (e instanceof CapabilityError) return e;
  if (ROLLBACK_GARANTIDO.has(e?.code)) {
    return new CapabilityError("PROVIDER_UNAVAILABLE", `banco: ${e.code}`,
      { error_class: "TRANSIENT", retryable: true, provider_message: String(e?.message ?? e) });
  }
  if (e?.reason_code) {
    return new CapabilityError(e.reason_code, e.message,
      { error_class: "PERMANENT", retryable: false });
  }
  return e; // desconhecido: o gateway normaliza, e nunca vira sucesso
}

/** Texto comparavel: minusculas, acentos fora, espaco colapsado. */
export function normalizarTexto(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** Tipos de claim que a policy global trata como materiais (POL_COMPLIANCE_ON_MATERIAL_CLAIM). */
export const CLAIM_TYPES_MATERIAIS = ["COVERAGE", "PRICE", "DEADLINE"];

/** Lista de strings a partir de jsonb que pode vir como array de string ou de objeto. */
function comoLista(v) {
  if (!Array.isArray(v)) return [];
  return v.map((i) => (typeof i === "string" ? i : i?.text ?? i?.termo ?? i?.value ?? null))
          .filter(Boolean).map(String);
}

/**
 * Metodos que cada porta precisa ter para as nove capabilities rodarem.
 *
 * Existe para ser conferido no boot. A porta de banco do worker ja existiu
 * APENAS nos testes, com um duble completo — e o erro so apareceria na
 * primeira publicacao real, num metodo faltando. Aqui vale o mesmo: um
 * `knowledge` sem `duplicateOf` sobe sem reclamar e quebra no primeiro
 * precheck de um cliente.
 */
export const SUPERFICIE_INTERNA = {
  authoring: ["createDraft", "createVariant", "proposeBrandVersion"],
  knowledge: ["brandBrain", "brandBrainForContent", "contentVersion", "claimsFor",
              "evidenceFor", "duplicateOf"],
  publishing: ["requestApproval", "schedule"],
};

/** Falha alto e cedo, com o nome do que falta. Nao considera `compose`. */
export function conferirPortasInternas(ports) {
  const faltando = [];
  for (const [porta, metodos] of Object.entries(SUPERFICIE_INTERNA)) {
    for (const m of metodos) {
      if (typeof ports?.[porta]?.[m] !== "function") faltando.push(`${porta}.${m}`);
    }
  }
  if (faltando.length) {
    throw new Error(
      `portas incompletas para o adapter interno: falta ${faltando.join(", ")}. ` +
      `Um metodo faltando aqui so apareceria no primeiro pedido real de um cliente.`);
  }
  return true;
}

/**
 * @param {object} deps
 * @param {any} deps.authoring   porta de escrita: createDraft, createVariant, proposeBrandVersion
 * @param {any} deps.knowledge   porta de leitura governada: brandBrain, claimsFor, evidenceFor...
 * @param {any} deps.publishing  porta de agendamento e pedido de aprovacao
 * @param {any} [deps.compose]   redator: draft() e variant(). Ausente = worker sem modelo.
 */
export function createInternalAdapter({ authoring, knowledge, publishing, compose } = {}) {
  const exigirPorta = (porta, nome, cap) => {
    if (!porta) {
      throw new CapabilityError("PROVIDER_UNAVAILABLE",
        `${cap} exige a porta ${nome}, que nao foi montada`);
    }
    return porta;
  };

  const exigirRedator = (cap) => {
    if (!compose) {
      throw new CapabilityError("PROVIDER_UNAVAILABLE",
        `${cap} precisa escrever texto e este worker subiu sem providers de modelo`);
    }
    return compose;
  };

  // ── Leitura ───────────────────────────────────────────────────────────────

  /**
   * O Brand Brain ACTIVE da marca. Nao existir e recusa nomeada, nao objeto
   * vazio: conteudo escrito sem marca ativa e conteudo sem dono.
   */
  async function brandRead({ args, tenant }) {
    const k = exigirPorta(knowledge, "knowledge", "brand.read");
    const bb = await k.brandBrain(tenant.org_id, args.brand_id);
    if (!bb) {
      throw new CapabilityError("BRAND_BRAIN_NOT_ACTIVE",
        "esta marca nao tem Brand Brain ativo");
    }
    return {
      external_id: String(bb.id),
      output: {
        brand_id: String(bb.brand_id), brand_name: bb.brand_name,
        version: bb.version, identity: bb.identity, tone: bb.tone,
        claims_allowed: bb.claims_allowed, prohibitions: bb.prohibitions,
        disclaimers: bb.disclaimers,
      },
    };
  }

  /** Evidence e claims de uma versao. Le o que sustenta, nao o que foi dito. */
  async function evidenceRead({ args, tenant }) {
    const k = exigirPorta(knowledge, "knowledge", "evidence.read");
    const [evidencias, claims] = await Promise.all([
      k.evidenceFor(tenant.org_id, args.content_version_id),
      k.claimsFor(tenant.org_id, args.content_version_id),
    ]);
    return {
      external_id: String(args.content_version_id),
      output: {
        content_version_id: String(args.content_version_id),
        evidence: evidencias.map((e) => ({
          evidence_id: String(e.id), source_kind: e.source_kind,
          locator: e.locator, hash: e.hash, quality: e.quality ?? null,
          retrieved_at: new Date(e.retrieved_at).toISOString(),
        })),
        claims: claims.map((c) => ({
          claim_id: String(c.id), text: c.text, material: c.material,
          claim_type: c.claim_type, evidencias: Number(c.evidencias ?? 0),
        })),
      },
    };
  }

  // ── Simulacao: contagem, nao julgamento ───────────────────────────────────

  /**
   * quality.precheck.
   *
   * Os tres codigos que o registry declara para esta capability sao
   * exatamente os tres checks daqui — CLAIM_UNSUPPORTED, EVIDENCE_INSUFFICIENT
   * e CONTENT_DUPLICATE_RISK. Nao e coincidencia: o registry e o contrato, e
   * um check a mais aqui seria um codigo que o registry nao declarou.
   */
  async function qualityPrecheck({ args, tenant, trace_id }) {
    const k = exigirPorta(knowledge, "knowledge", "quality.precheck");
    const cvid = args.content_version_id;

    const [claims, evidencias, duplicado] = await Promise.all([
      k.claimsFor(tenant.org_id, cvid),
      k.evidenceFor(tenant.org_id, cvid),
      k.duplicateOf(tenant.org_id, tenant.workspace_id, cvid),
    ]);

    const materiais = claims.filter((c) => c.material === true);
    const semLastro = materiais.filter((c) => Number(c.evidencias ?? 0) === 0);

    const checks = [
      // "sem evidence" aqui quer dizer "a evidence que ele cita nao existe
      // mais". Claim material nasce com evidence — a constraint exige — entao
      // este check so reprova o que perdeu o lastro depois de gravado.
      { check: "claims_supported", passed: semLastro.length === 0,
        detail: semLastro.length
          ? `${semLastro.length} claim material sem a evidence que cita`
          : undefined },
      // Sem claim material, nao ha o que sustentar: o check passa por vacuidade,
      // e dizer isso no detail evita que "passou" seja lido como "foi conferido".
      { check: "evidence_sufficient", passed: materiais.length === 0 || evidencias.length > 0,
        detail: materiais.length === 0 ? "sem claim material" : `${evidencias.length} evidence` },
      { check: "duplicate_risk", passed: !duplicado,
        detail: duplicado ? `texto igual ao da versao ${duplicado.content_version_id}` : undefined },
    ];

    const reason_codes = [];
    if (semLastro.length) reason_codes.push("CLAIM_UNSUPPORTED");
    if (materiais.length > 0 && evidencias.length === 0) reason_codes.push("EVIDENCE_INSUFFICIENT");
    if (duplicado) reason_codes.push("CONTENT_DUPLICATE_RISK");

    return {
      external_id: String(cvid),
      output: { trace_id, valid: reason_codes.length === 0, checks: limpar(checks), reason_codes },
    };
  }

  /**
   * compliance.review.
   *
   * Verifica e RELATA. Nao bloqueia: quem bloqueia e a policy, com os fatos.
   * As prohibitions do Brand Brain sao conteudo, nao regra tipada — usa-las
   * para recusar aqui seria deixar quem edita a marca escrever policy.
   */
  async function complianceReview({ args, tenant, trace_id }) {
    const k = exigirPorta(knowledge, "knowledge", "compliance.review");
    const cvid = args.content_version_id;

    const [versao, claims, bb] = await Promise.all([
      k.contentVersion(tenant.org_id, cvid),
      k.claimsFor(tenant.org_id, cvid),
      k.brandBrainForContent(tenant.org_id, cvid),
    ]);
    if (!versao) {
      throw new CapabilityError("SCHEMA_VALIDATION_FAILED", "versao de conteudo inexistente");
    }
    if (!bb) throw new CapabilityError("BRAND_BRAIN_NOT_ACTIVE", "marca sem Brand Brain ativo");

    const corpo = normalizarTexto(versao.master_body);
    const proibidos = comoLista(bb.prohibitions).filter((p) => corpo.includes(normalizarTexto(p)));

    const tiposMateriais = [...new Set(
      claims.filter((c) => CLAIM_TYPES_MATERIAIS.includes(c.claim_type)).map((c) => c.claim_type))];

    // Exige TODOS os disclaimers da marca quando ha claim material, porque a
    // lista e de strings soltas e nao diz qual disclaimer cobre qual tipo de
    // claim. E deliberadamente grosseiro: errar para o lado de mandar para
    // revisao humana e o erro barato. Mapear disclaimer por claim_type e
    // trabalho de quando o Brand Brain tiver essa estrutura.
    const disclaimers = comoLista(bb.disclaimers);
    const faltando = tiposMateriais.length > 0 && disclaimers.length > 0
      ? disclaimers.filter((d) => !corpo.includes(normalizarTexto(d)))
      : [];

    const semLastro = claims.filter((c) => c.material === true && Number(c.evidencias ?? 0) === 0);

    const checks = [
      { check: "prohibitions", passed: proibidos.length === 0,
        detail: proibidos.length ? `termo proibido: ${proibidos.join(", ")}` : undefined },
      { check: "material_claims", passed: tiposMateriais.length === 0,
        detail: tiposMateriais.length ? `claim de ${tiposMateriais.join(", ")}` : undefined },
      { check: "disclaimers", passed: faltando.length === 0,
        detail: faltando.length ? `disclaimer ausente: ${faltando.length}` : undefined },
      { check: "claims_supported", passed: semLastro.length === 0,
        detail: semLastro.length
          ? `${semLastro.length} claim material sem a evidence que cita`
          : undefined },
    ];

    const reason_codes = [];
    if (semLastro.length) reason_codes.push("CLAIM_UNSUPPORTED");
    if (proibidos.length || tiposMateriais.length || faltando.length) {
      reason_codes.push("COMPLIANCE_REVIEW_REQUIRED");
    }

    return {
      external_id: String(cvid),
      output: { trace_id, valid: reason_codes.length === 0, checks: limpar(checks), reason_codes },
    };
  }

  // ── Escrita ───────────────────────────────────────────────────────────────

  /**
   * content.create_draft.
   *
   * O modelo escreve o corpo e DECLARA o que afirmou. As duas coisas sao
   * diferentes: o texto e trabalho dele, a classificacao do que ele afirmou e
   * o que permite o banco recusar.
   *
   * mkt.claims tem a constraint `claim_material_requires_evidence`: claim
   * material sem evidence nao entra. Nos conferimos antes so para devolver
   * CLAIM_UNSUPPORTED — que o registry declara — em vez de um erro de
   * constraint. A constraint continua sendo a garantia; o if e a mensagem.
   */
  async function contentCreateDraft({ args, tenant, trace_id }) {
    const a = exigirPorta(authoring, "authoring", "content.create_draft");
    const k = exigirPorta(knowledge, "knowledge", "content.create_draft");
    const redator = exigirRedator("content.create_draft");

    const bb = await k.brandBrain(tenant.org_id, args.brand_id);
    if (!bb) {
      throw new CapabilityError("BRAND_BRAIN_NOT_ACTIVE",
        "nao escrevo para uma marca sem Brand Brain ativo");
    }

    const escrito = await redator.draft({
      tenant, trace_id, brand: bb,
      objective: args.objective ?? null,
      channel: args.channel ?? null,
    });

    // A forma ja veio validada contra olga://io/draft-composition pelo Model
    // Gateway — inclusive o claim_type, que e enum fechado. Nao se normaliza
    // nada aqui: rebaixar em silencio um claim_type desconhecido para GENERAL
    // seria transformar uma promessa de cobertura em texto qualquer.
    const claims = (escrito.claims ?? []).map((c) => ({
      text: c.text, claim_type: c.claim_type, material: c.material === true,
      evidence_ids: Array.isArray(c.evidence_ids) ? c.evidence_ids : [],
    }));

    const semLastro = claims.filter((c) => c.material && c.evidence_ids.length === 0);
    if (semLastro.length) {
      throw new CapabilityError("CLAIM_UNSUPPORTED",
        `o rascunho afirma ${semLastro.length} coisa material sem evidence que a sustente`);
    }

    const criado = await a.createDraft({
      org_id: tenant.org_id, workspace_id: tenant.workspace_id,
      brand_id: args.brand_id,
      title: escrito.title, objective: args.objective ?? null,
      master_body: escrito.master_body,
      brand_brain_version_id: bb.id,
      claims,
      actor_id: tenant.actor_id ?? null, trace_id,
      agent_id: args.agent_id ?? null, agent_version: args.agent_version ?? null,
    });

    return {
      external_id: String(criado.content_version_id),
      output: { ...criado, brand_brain_version_id: String(bb.id), claims: claims.length },
    };
  }

  /** content.create_variant. Adapta o master para o canal; nao reescreve o que foi afirmado. */
  async function contentCreateVariant({ args, tenant, trace_id }) {
    const a = exigirPorta(authoring, "authoring", "content.create_variant");
    const k = exigirPorta(knowledge, "knowledge", "content.create_variant");
    const redator = exigirRedator("content.create_variant");

    const versao = await k.contentVersion(tenant.org_id, args.content_version_id);
    if (!versao) {
      throw new CapabilityError("SCHEMA_VALIDATION_FAILED", "versao de conteudo inexistente");
    }
    const bb = await k.brandBrainForContent(tenant.org_id, args.content_version_id);

    const escrito = await redator.variant({
      tenant, trace_id, channel: args.channel,
      master_body: versao.master_body, brand: bb,
    });

    const v = await a.createVariant({
      org_id: tenant.org_id, content_version_id: args.content_version_id,
      channel: args.channel,
      headline: escrito.headline ?? null, body: escrito.body, cta: escrito.cta ?? null,
    });
    return { external_id: String(v.id), output: { channel_variant_id: String(v.id), channel: v.channel } };
  }

  /** brand.propose_version. Sempre CANDIDATE — a porta nao aceita outro status. */
  async function brandProposeVersion({ args, tenant }) {
    const a = exigirPorta(authoring, "authoring", "brand.propose_version");
    const nova = await a.proposeBrandVersion({
      org_id: tenant.org_id, brand_id: args.brand_id,
      identity: args.identity, tone: args.tone,
      claims_allowed: args.claims_allowed, prohibitions: args.prohibitions,
      disclaimers: args.disclaimers, source_refs: args.source_refs,
      actor_id: tenant.actor_id ?? null,
    });
    return {
      external_id: String(nova.id),
      output: { brand_brain_version_id: String(nova.id), version: nova.version, status: nova.status },
    };
  }

  /** approval.request. O estado de destino sai dos reason codes, na porta. */
  async function approvalRequest({ args, tenant, trace_id }) {
    const p = exigirPorta(publishing, "publishing", "approval.request");
    const r = await p.requestApproval({
      org_id: tenant.org_id, workspace_id: tenant.workspace_id,
      content_version_id: args.content_version_id,
      reason_codes: args.reason_codes ?? [], trace_id,
    });
    return { external_id: String(r.approval_id), output: { approval_id: String(r.approval_id), state: r.state } };
  }

  /**
   * publishing.schedule.
   *
   * Interna de proposito: agendar nao publica. O que sai daqui e uma linha em
   * mkt.publications e um evento no outbox — o efeito externo acontece depois,
   * em publishing.publish, que e external e tem receipt.
   */
  async function publishingSchedule({ args, tenant, trace_id, request, granted_autonomy }) {
    const p = exigirPorta(publishing, "publishing", "publishing.schedule");
    const r = await p.schedule({
      org_id: tenant.org_id, workspace_id: tenant.workspace_id,
      content_version_id: args.content_version_id,
      channel: args.channel,
      connection_id: args.connection_id,
      channel_variant_id: args.channel_variant_id,
      approval_id: request?.approval_id ?? null,
      // A concedida, nao a pedida: e ela que descreve sob que autoridade a
      // publicacao foi agendada.
      autonomy_used: granted_autonomy ?? request?.requested_autonomy ?? null,
      scheduled_at: args.scheduled_at ?? null,
      trace_id,
    });
    return {
      external_id: String(r.publication_id),
      output: { publication_id: String(r.publication_id), outbox_id: r.outbox_id },
    };
  }

  const handlers = {
    "brand.read": brandRead,
    "evidence.read": evidenceRead,
    "quality.precheck": qualityPrecheck,
    "compliance.review": complianceReview,
    "content.create_draft": contentCreateDraft,
    "content.create_variant": contentCreateVariant,
    "brand.propose_version": brandProposeVersion,
    "approval.request": approvalRequest,
    "publishing.schedule": publishingSchedule,
  };

  return {
    name: "internal",
    capabilities: Object.keys(handlers),

    async call({ capability, request, trace_id, granted_autonomy = null }) {
      const handler = handlers[capability.capability_id];
      if (!handler) {
        // O registry mandou para "internal" uma capability que este arquivo
        // nao implementa. Isso e divergencia entre registry e codigo, e vale
        // mais um erro nomeado do que um TypeError.
        throw new CapabilityError("CAPABILITY_NOT_ACTIVE",
          `capability interna sem executor: ${capability.capability_id}`);
      }
      try {
        return await handler({
          args: request.args ?? {}, tenant: request.tenant,
          trace_id: trace_id ?? request.trace_id, capability, request, granted_autonomy,
        });
      } catch (e) {
        throw comoFalha(e);
      }
    },
  };
}

/** Tira o `detail` indefinido: o schema de ValidatedResult nao aceita chave extra vazia. */
function limpar(checks) {
  return checks.map((c) => (c.detail === undefined ? { check: c.check, passed: c.passed } : c));
}
