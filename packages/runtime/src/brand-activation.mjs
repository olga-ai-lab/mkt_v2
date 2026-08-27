/**
 * Revisao e ativacao de Brand Brain — onde o onboarding para e uma pessoa entra.
 *
 * A cadeia da Fase 2 termina numa versao CANDIDATE: o agente leu a pagina,
 * conferiu o que tinha lastro e propos. Nada disso vale ainda. Enquanto ninguem
 * ativar, brand.read recusa com BRAND_BRAIN_NOT_ACTIVE e content.create_draft
 * tambem — de proposito.
 *
 * ── Por que isto nao e uma capability ──────────────────────────────────────
 *
 * Seria facil escrever brand.activate_version, dar a ela um risk_tier alto e
 * deixar a policy decidir. Seria errado por um motivo que nao e de risco, e sim
 * de circuito: quem propoe nao pode ser quem aceita. O AGT-MKT-BRAND leu uma
 * pagina e escreveu uma proposta; se ele pudesse ativa-la, a unica coisa entre
 * "um modelo leu um site" e "a marca autoriza estes claims" seria ele mesmo.
 *
 * Ativar e assumir. A partir daqui o redator pode repetir cada item de
 * claims_allowed, e o compliance passa a cobrar cada disclaimer. Isso e ato de
 * dono, e o papel exigido diz isso.
 *
 * ── O que o servico acrescenta a porta ─────────────────────────────────────
 *
 * A porta faz a transacao. O que mora aqui e o que a transacao nao tem como
 * ver: quem esta pedindo tem papel para isso, e o que aquela versao NAO tem.
 *
 * As lacunas nao bloqueiam — elas aparecem. Bloquear a ativacao por uma lista
 * vazia travaria o onboarding inteiro; deixar passar em silencio faria o
 * compliance.review conferir lista vazia para sempre, sem ninguem perceber.
 * Entao a ativacao acontece e diz o que ficou faltando.
 *
 * ── Os dois atos humanos, e por que sao dois ──────────────────────────────
 *
 * `derive` e `activate` sao separados de proposito, e nao por comodidade de
 * implementacao.
 *
 * Derivar e propor: escrever o que a marca permite e o que ela proibe. Exige
 * OWNER ou MARKETING, e o resultado e sempre CANDIDATE — ninguem sai daqui com
 * uma marca no ar.
 *
 * Ativar e assumir: fazer aquilo valer para o agente. Exige OWNER.
 *
 * Um so ato faria de quem escreve a proibicao a mesma pessoa que decide que ela
 * vale, e nesse caso a segunda leitura nunca aconteceria — a que existe
 * justamente para pegar o que a primeira deixou passar.
 *
 * ── prohibitions e o campo que so existe por aqui ─────────────────────────
 *
 * A extracao nunca preenche: uma pagina diz o que a marca fala, nao o que ela
 * se recusa a falar. Nao e limitacao da extracao — e a natureza da coisa. Toda
 * marca vinda de site chega com a lista vazia, e este e o unico caminho para
 * ela deixar de estar.
 */
import { assertValid } from "@olga/contracts";

/** Quem ativa. Propor e de MARKETING; assumir como marca e de dono. */
export const PAPEIS_QUE_ATIVAM = new Set(["OWNER"]);

/** Quem propoe. Mesmo conjunto que o registry declara em brand.propose_version. */
export const PAPEIS_QUE_PROPOEM = new Set(["OWNER", "MARKETING"]);

export class BrandActivationError extends Error {
  constructor(reason_code, message, status = 400) {
    super(message);
    this.reason_code = reason_code;
    this.status = status;
  }
}

const vazio = (v) => !Array.isArray(v) || v.length === 0;

/**
 * O que esta versao nao tem, em nomes de campo.
 *
 * Funcao pura, exportada porque a tela mostra a mesma lista ANTES de ativar —
 * e as duas precisam concordar. Duas implementacoes da mesma pergunta
 * divergiriam no dia em que uma delas mudasse.
 */
export function lacunasDe(version) {
  const faltando = [];
  if (vazio(version?.prohibitions)) faltando.push("prohibitions");
  if (vazio(version?.disclaimers)) faltando.push("disclaimers");
  if (vazio(version?.claims_allowed)) faltando.push("claims_allowed");
  if (vazio(version?.source_refs)) faltando.push("source_refs");
  return faltando;
}

/**
 * @param {{ authoring: any, tracer?: any }} deps
 */
export function createBrandActivationService({ authoring, tracer } = {}) {
  if (!authoring?.activateBrandVersion) {
    throw new Error("createBrandActivationService exige a porta authoring.activateBrandVersion");
  }

  return {
    /** As versoes de uma marca, da mais nova para a mais velha. */
    async list({ tenant, brand_id }) {
      const versoes = await authoring.brandVersions(tenant.org_id, brand_id);
      return versoes.map((v) => ({ ...v, gaps: lacunasDe(v) }));
    },

    /**
     * Derivar uma nova candidata a partir de outra versao — a edicao.
     *
     * O patch e validado contra olga://io/brand-edit antes de tocar no banco.
     * O contrato e que recusa `source_refs` e `status` no corpo: os dois
     * existem na linha e nenhum dos dois se muda digitando.
     *
     * @param {{ tenant: object, brand_id: string, from_version_id: string,
     *           patch: object, actor: { id: string, role: string },
     *           trace_id?: string|null }} p
     */
    async derive({ tenant, brand_id, from_version_id, patch, actor, trace_id = null }) {
      if (!PAPEIS_QUE_PROPOEM.has(actor?.role)) {
        throw new BrandActivationError("ACTOR_ROLE_FORBIDDEN",
          "editar a marca exige perfil de marketing ou de dono", 403);
      }
      try {
        assertValid("olga://io/brand-edit", patch);
      } catch (e) {
        // O contrato ja disse o que esta errado; o que falta e o codigo que a
        // tela sabe traduzir.
        throw new BrandActivationError("SCHEMA_VALIDATION_FAILED", e.message, 400);
      }

      const r = await authoring.deriveBrandVersion({
        org_id: tenant.org_id, brand_id, from_version_id, patch, actor_id: actor.id,
      });

      if (!r.ok) {
        if (r.reason === "NOT_FOUND") {
          throw new BrandActivationError("NORMALIZATION_FAILED",
            "nao encontrei essa versao nesta marca", 404);
        }
        throw new BrandActivationError("UNSUPPORTED_VALUE",
          `versao ${r.version?.version} esta ${r.version?.status} e nao serve de base`, 409);
      }

      const gaps = lacunasDe(r.version);
      tracer?.event?.({
        trace_id, event: "brand.version_derived",
        brand_id, version: r.version.version, from_version: r.from.version,
        campos: Object.keys(patch ?? {}), gaps,
      });

      return { version: r.version, from: r.from, gaps };
    },

    /**
     * @param {{ tenant: object, brand_id: string, version_id: string,
     *           actor: { id: string, role: string }, trace_id?: string|null }} p
     */
    async activate({ tenant, brand_id, version_id, actor, trace_id = null }) {
      if (!PAPEIS_QUE_ATIVAM.has(actor?.role)) {
        throw new BrandActivationError("ACTOR_ROLE_FORBIDDEN",
          "ativar a marca e ato de dono do workspace", 403);
      }

      const r = await authoring.activateBrandVersion({
        org_id: tenant.org_id, brand_id, version_id, actor_id: actor.id,
      });

      if (!r.ok) {
        if (r.reason === "NOT_FOUND") {
          // Nao existe, ou e de outra marca, ou e de outro tenant. As tres
          // respostas sao a mesma de proposito: dizer qual delas foi contaria a
          // quem pergunta que aquele id existe em algum lugar.
          throw new BrandActivationError("NORMALIZATION_FAILED",
            "nao encontrei essa versao nesta marca", 404);
        }
        if (r.reason === "ALREADY_ACTIVE") {
          // Outra aba ativou enquanto esta estava aberta. Nao e erro: e estado
          // que a tela precisa refletir.
          return { already_active: true, version: r.version };
        }
        throw new BrandActivationError("UNSUPPORTED_VALUE",
          `versao ${r.version?.version} esta ${r.version?.status} e nao pode ser ativada`, 409);
      }

      const gaps = lacunasDe(r.version);
      tracer?.event?.({
        trace_id, event: "brand.activated",
        brand_id, version: r.version.version,
        replaced_version: r.replaced?.version ?? null,
        reverted: r.reverted, gaps,
      });

      return {
        already_active: false,
        version: r.version,
        replaced: r.replaced,
        reverted: r.reverted,
        gaps,
      };
    },
  };
}
