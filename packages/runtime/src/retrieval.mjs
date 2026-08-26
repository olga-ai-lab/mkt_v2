/**
 * Retrieval — o que o agente lê para se situar.
 *
 * Era o último porto do loop ainda vazio. Ele passou a fazer falta de verdade
 * quando o COPILOT foi promovido: o trabalho dele é interpretar e explicar
 * usando o Brand Brain, e sem isto ele podia CHAMAR brand.read como
 * capability, mas nada alimentava o contexto em que ele pensa.
 *
 * ── "Somente slices relevantes, não todo o manual" (Mestra §13) ────────────
 *
 * A regra é fácil de ler e fácil de trair. Trazer tudo é sempre mais simples
 * e parece mais seguro — o agente "tem toda a informação". Na prática cobra
 * três preços:
 *
 *   custo      cada token de contexto é pago em toda chamada, para sempre;
 *   confusão   fatos de marcas ou campanhas vizinhas ficam ao alcance do
 *              modelo, e ele os mistura sem avisar;
 *   auditoria  se todo run cita tudo, o trace deixa de responder "em cima de
 *              que essa resposta foi dada".
 *
 * Por isso a seleção é por INTENÇÃO, e é explícita. Uma intenção que não
 * precisa de contexto não recebe nenhum — e isso não é uma otimização, é a
 * regra.
 *
 * ── "Dado não confiável até passar por contrato e policy" ──────────────────
 *
 * O que sai daqui é MATERIAL, não instrução. Ele entra na quinta camada de
 * contexto (`governed`), que é turno de usuário — nunca na de sistema. Um
 * Brand Brain que chegasse com autoridade de sistema seria um lugar por onde
 * qualquer um que edite a marca reescreve as regras do agente.
 *
 * As `prohibitions` do Brand Brain são o exemplo mais tentador: parecem
 * policy. Não são. Policy é dado tipado em mkt.rule_policies, avaliado
 * deterministicamente. Prohibition é conteúdo que o modelo deve respeitar ao
 * escrever, e se algo depende dela para BLOQUEAR, o lugar é a policy.
 */
import { createHash } from "node:crypto";

/** Que fatia cada intenção precisa. O resto não é trazido. */
const RELEVANCIA = {
  EXPLAIN:        ["brand"],
  CREATE_CONTENT: ["brand"],
  PLAN_EDITORIAL: ["brand"],
  ONBOARD_BRAND:  ["brand"],
  // Revisar exige ver o que foi afirmado e com o que se sustenta.
  REVIEW_CONTENT: ["brand", "claims", "evidence"],
  // Publicar precisa das proibições: é a última chance de o modelo lembrar.
  PUBLISH_CONTENT: ["brand"],
  // Conectar canal é ato de configuração. Brand Brain não ajuda em nada aqui.
  CONNECT_CHANNEL: [],
  UNKNOWN: [],
};

const DIAS = 24 * 60 * 60 * 1000;

/** Hash do que foi REALMENTE usado, não da linha inteira do banco. */
const hashDe = (obj) =>
  createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 32);

/**
 * @param {{ knowledge: any, maxAgeDays?: number, clock?: any }} deps
 *   `maxAgeDays` é o teto de idade de uma fonte antes de ela ser considerada
 *   vencida. Fica configurável porque a resposta certa depende do contrato de
 *   fonte, que o MKT-17 coloca na Fase 2 — até lá, um teto explícito é melhor
 *   que nenhum, e melhor que um espalhado por vários lugares.
 */
export function createRetrieval({ knowledge, maxAgeDays = 90, clock } = {}) {
  if (!knowledge) throw new Error("retrieval exige a porta knowledge");
  const agora = () => clock?.now?.() ?? Date.now();

  return {
    async fetch({ trace_id, tenant, intent }) {
      const querem = RELEVANCIA[intent?.intent] ?? [];
      if (querem.length === 0) {
        return { slices: [], versions: [], stale: false, motivo: "intencao nao pede contexto" };
      }

      const brand_id = idDe(intent, "brand");
      const content_version_id = idDe(intent, "content_version");

      const slices = [];
      const versions = [];
      let maisAntigo = null;

      // ── Brand Brain ──────────────────────────────────────────────────────
      if (querem.includes("brand")) {
        const bb = brand_id
          ? await knowledge.brandBrain(tenant.org_id, brand_id)
          : content_version_id
            ? await knowledge.brandBrainForContent(tenant.org_id, content_version_id)
            : null;

        if (bb) {
          // Só os campos que servem para escrever ou revisar. `source_refs`
          // fica de fora: é procedência do Brand Brain, não insumo do texto.
          const conteudo = {
            marca: bb.brand_name,
            identidade: bb.identity, tom: bb.tone,
            claims_permitidos: bb.claims_allowed,
            proibicoes: bb.prohibitions,
            disclaimers: bb.disclaimers,
          };
          const carimbo = bb.activated_at ?? bb.created_at;
          slices.push({
            id: `brand:${bb.brand_id}@v${bb.version}`,
            kind: "brand_brain",
            version: bb.version,
            retrieved_at: new Date(agora()).toISOString(),
            source_at: carimbo,
            conteudo,
            evidence: {
              evidence_id: bb.id,
              source_kind: "BRAND_BRAIN",
              locator: `brand://${bb.brand_id}@v${bb.version}`,
              hash: hashDe(conteudo),
              retrieved_at: new Date(agora()).toISOString(),
              quality: "HIGH",
            },
          });
          versions.push({ kind: "brand_brain", id: bb.brand_id, version: bb.version });
          maisAntigo = menorData(maisAntigo, carimbo);
        }
      }

      // ── Claims e evidence do conteúdo em questão ─────────────────────────
      if (content_version_id && querem.includes("claims")) {
        const claims = await knowledge.claimsFor(tenant.org_id, content_version_id);
        if (claims.length) {
          slices.push({
            id: `claims:${content_version_id}`,
            kind: "claims",
            version: null,
            retrieved_at: new Date(agora()).toISOString(),
            conteudo: claims.map((c) => ({
              texto: c.text, material: c.material, tipo: c.claim_type,
              evidencias: Number(c.evidencias),
            })),
          });
        }
      }

      if (content_version_id && querem.includes("evidence")) {
        const evs = await knowledge.evidenceFor(tenant.org_id, content_version_id);
        for (const e of evs) {
          slices.push({
            id: `evidence:${e.id}`,
            kind: "evidence",
            version: null,
            retrieved_at: new Date(agora()).toISOString(),
            source_at: e.retrieved_at,
            conteudo: { fato: e.fact, qualidade: e.quality },
            evidence: {
              evidence_id: e.id, source_kind: e.source_kind,
              locator: e.locator, hash: e.hash,
              retrieved_at: e.retrieved_at, quality: e.quality ?? undefined,
            },
          });
          maisAntigo = menorData(maisAntigo, e.retrieved_at);
        }
      }

      // Fonte vencida não some do contexto: ela vem marcada. O loop transforma
      // isso em SOURCE_STALE no Validator, e a decisão de bloquear é dele, não
      // daqui — quem recupera não decide se o dado serve.
      const stale = maisAntigo != null &&
        (agora() - new Date(maisAntigo).getTime()) > maxAgeDays * DIAS;

      return { slices, versions, stale, trace_id };
    },
  };
}

/** Id canônico de uma entidade do tipo pedido, se o resolver tiver resolvido. */
function idDe(intent, tipo) {
  return (intent?.entities ?? []).find((e) => e.type === tipo && e.canonical_id != null)
    ?.canonical_id ?? null;
}

function menorData(atual, candidata) {
  if (!candidata) return atual;
  if (!atual) return candidata;
  return new Date(candidata) < new Date(atual) ? candidata : atual;
}
