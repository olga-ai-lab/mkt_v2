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
 *
 * ── Freshness vem do contrato da fonte, não de uma constante daqui ─────────
 *
 * "Freshness é parte da verdade" (Mestra §3): dado correto e desatualizado
 * gera resposta falsa. Este arquivo carregava um `maxAgeDays = 90` único,
 * aplicado igual ao Brand Brain, a uma página de site e ao registro da marca
 * no nosso próprio banco.
 *
 * Fontes envelhecem de formas diferentes, e quem sabe disso é o dono da fonte.
 * Agora cada fatia é medida contra o contrato da SUA fonte
 * (`mkt.source_contracts`, Mestra §7.5), que declara também qual carimbo conta
 * como autoridade temporal e que qualidade vale quando a linha não declara uma.
 *
 * Um contrato com `max_age_days` nulo diz que aquela fonte não vence — e isso é
 * uma afirmação, não a ausência de uma.
 *
 * E o resultado deixou de ser um booleano: `stale` continua existindo para o
 * Validator, mas ao lado dele vai a lista de QUAIS fontes venceram. Um "algo
 * aqui está velho" sem dizer o quê manda quem lê procurar no escuro.
 */
import { createHash } from "node:crypto";

/** Que fatia cada intenção precisa. O resto não é trazido. */
const RELEVANCIA = {
  EXPLAIN:        ["brand"],
  CREATE_CONTENT: ["brand"],
  PLAN_EDITORIAL: ["brand"],
  // Onboarding é o caso em que o Brand Brain, por definição, ainda não existe:
  // a marca acabou de ser cadastrada e o que se tem dela é a linha de
  // mkt.brands. Trazer o Brand Brain aqui seria trazer nada — e, num
  // re-onboarding, seria pior que nada: mostrar ao modelo a marca que já está
  // escrita o convida a repeti-la em vez de ler a página. Quem compara
  // candidata e ativa é a pessoa que revisa, não ele.
  ONBOARD_BRAND:  ["brand_record"],
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
 * @param {{ knowledge: any, clock?: any }} deps
 *   `knowledge.sourceContracts()` traz os contratos ACTIVE por fonte. Sem eles
 *   o retrieval não sabe quando uma fatia venceu — e um default aqui seria
 *   exatamente a constante que a migration 0012 tirou daqui.
 */
export function createRetrieval({ knowledge, clock } = {}) {
  if (!knowledge) throw new Error("retrieval exige a porta knowledge");
  const agora = () => clock?.now?.() ?? Date.now();

  /**
   * O veredito de idade de UMA fatia, contra o contrato da fonte dela.
   *
   * Fonte sem contrato não vira "nunca vence": vira vencida, com o motivo. É a
   * escolha fail-closed que a Mestra §3 pede — e a alternativa deixaria uma
   * fonte nova entrar em produção sem ninguém decidir quando ela envelhece.
   */
  function idadeDe(contrato, source_kind, carimbo) {
    if (!contrato) {
      return { stale: true, motivo: `${source_kind} não tem contrato de fonte ACTIVE` };
    }
    if (contrato.max_age_days == null || carimbo == null) return { stale: false };
    const dias = (agora() - new Date(carimbo).getTime()) / DIAS;
    return dias > contrato.max_age_days
      ? { stale: true, motivo: `${source_kind} lida há ${Math.floor(dias)} dias, e o contrato aceita ${contrato.max_age_days}` }
      : { stale: false };
  }

  return {
    async fetch({ trace_id, tenant, intent }) {
      const querem = RELEVANCIA[intent?.intent] ?? [];
      if (querem.length === 0) {
        return { slices: [], versions: [], stale: false, vencidas: [], brand: null,
                 motivo: "intencao nao pede contexto" };
      }

      const brand_id = idDe(intent, "brand");
      const content_version_id = idDe(intent, "content_version");

      // Os contratos ACTIVE, uma consulta por run. Cada fatia abaixo é medida
      // contra o contrato da SUA fonte, e não contra um teto comum.
      const contratos = await knowledge.sourceContracts();
      const contratoDe = (k) => contratos?.[k] ?? null;

      const slices = [];
      const versions = [];
      const vencidas = [];
      let cadastro = null;

      /** Empurra a fatia e registra o veredito de idade dela. */
      const anotar = (source_kind, carimbo) => {
        const v = idadeDe(contratoDe(source_kind), source_kind, carimbo);
        if (v.stale) vencidas.push({ source_kind, motivo: v.motivo });
        return contratoDe(source_kind)?.default_quality ?? undefined;
      };

      // ── Cadastro da marca ────────────────────────────────────────────────
      //
      // Não é conhecimento sobre a marca: é o nosso registro dela. Vem separado
      // em `brand` porque o compilador de brand.extract_from_url precisa do
      // `website_url` daqui, e de lugar nenhum mais — uma URL escolhida a
      // partir de texto do usuário é exatamente o vetor que a defesa de SSRF do
      // adapter web_fetch existe para conter.
      if (querem.includes("brand_record") && brand_id) {
        const b = await knowledge.brand(tenant.org_id, brand_id);
        if (b) {
          cadastro = { brand_id: String(b.id), name: b.name, website_url: b.website_url ?? null };
          slices.push({
            id: `brand_record:${b.id}`,
            kind: "brand_record",
            version: null,
            retrieved_at: new Date(agora()).toISOString(),
            conteudo: { marca: b.name, site: b.website_url ?? null },
            evidence: {
              evidence_id: String(b.id),
              source_kind: "DOMAIN_RECORD",
              locator: `brand://${b.id}`,
              hash: hashDe(cadastro),
              retrieved_at: new Date(agora()).toISOString(),
              // A qualidade sai do contrato, não de um literal aqui. Estava
              // "HIGH" fixo para toda fatia, o que fazia uma página de site
              // valer tanto quanto um registro nosso.
              quality: anotar("DOMAIN_RECORD", b.created_at ?? null),
            },
          });
        }
      }

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
              quality: anotar("BRAND_BRAIN", carimbo),
            },
          });
          versions.push({ kind: "brand_brain", id: bb.brand_id, version: bb.version });
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
              retrieved_at: e.retrieved_at,
              // A linha vence sobre o contrato: `default_quality` é o que vale
              // quando a evidence não declarou a própria.
              quality: e.quality ?? anotar(e.source_kind, e.retrieved_at),
            },
          });
          if (e.quality) anotar(e.source_kind, e.retrieved_at);
        }
      }

      // Fonte vencida não some do contexto: ela vem marcada. O loop transforma
      // isso em SOURCE_STALE no Validator, e a decisão de bloquear é dele, não
      // daqui — quem recupera não decide se o dado serve.
      //
      // `stale` continua booleano porque é o que o Validator consome; `vencidas`
      // vai junto porque "algo aqui está velho" sem dizer o quê manda quem lê
      // procurar no escuro.
      return { slices, versions, stale: vencidas.length > 0, vencidas,
               brand: cadastro, trace_id };
    },
  };
}

/** Id canônico de uma entidade do tipo pedido, se o resolver tiver resolvido. */
function idDe(intent, tipo) {
  return (intent?.entities ?? []).find((e) => e.type === tipo && e.canonical_id != null)
    ?.canonical_id ?? null;
}

