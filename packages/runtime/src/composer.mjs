/**
 * Redator.
 *
 * Duas capabilities internas produzem texto: content.create_draft escreve o
 * master, content.create_variant o adapta para um canal. Escrever e trabalho
 * de modelo, e este arquivo e o unico lugar onde ele faz isso.
 *
 * ── Por que nao esta dentro do adapter interno ─────────────────────────────
 *
 * Porque o adapter nao pode conhecer o Model Gateway. Se conhecesse, teria
 * rota, orcamento e fallback dentro de si — e a proxima capability que
 * precisasse de texto teria de reimplementar tudo, ou pior, chamar provider
 * direto. O adapter recebe uma porta com dois metodos e nao sabe o que ha
 * atras dela.
 *
 * ── O que o modelo decide, e o que ele apenas declara ──────────────────────
 *
 * Ele decide o TEXTO. Ele nao decide se o texto pode existir.
 *
 * A diferenca aparece nos claims: pedimos que ele liste o que afirmou e
 * marque o que e material (cobertura, preco, prazo). Essa lista nao e
 * permissao, e confissao — quem decide o que acontece com um claim material
 * sem evidence e a constraint do banco, e a resposta e "nao entra".
 *
 * Se ele mentir na declaracao — afirmar cobertura e marcar como GENERAL —
 * quem pega e o compliance.review, que le o texto gravado e nao a etiqueta.
 * Nenhuma das duas defesas depende da honestidade da outra.
 *
 * ── Proibicoes chegam como material, nao como regra ────────────────────────
 *
 * As prohibitions do Brand Brain entram na camada `governed` do contexto, que
 * e turno de usuario. Nao entram no system prompt. Um Brand Brain com
 * autoridade de sistema seria um lugar por onde quem edita a marca reescreve
 * o comportamento do agente.
 */
import { assembleContext } from "./agent-stages.mjs";

/** Limite pratico por canal. Corta o que nao cabe ANTES de existir variante. */
export const LIMITE_POR_CANAL = {
  INSTAGRAM: 2200,
  FACEBOOK: 5000,
  LINKEDIN: 3000,
  WHATSAPP: 1000,
  EMAIL: 20000,
  BLOG: 40000,
};

function comoLista(v) {
  if (!Array.isArray(v)) return [];
  return v.map((i) => (typeof i === "string" ? i : i?.text ?? i?.termo ?? i?.value ?? null))
          .filter(Boolean).map(String);
}

/** Material da marca para a camada governed. Nunca vai para a de sistema. */
function marcaComoMaterial(brand) {
  if (!brand) return null;
  return {
    marca: brand.brand_name ?? null,
    brand_brain_version: brand.version ?? null,
    identidade: brand.identity ?? null,
    tom: brand.tone ?? null,
    claims_permitidos: comoLista(brand.claims_allowed),
    proibicoes: comoLista(brand.prohibitions),
    disclaimers: comoLista(brand.disclaimers),
  };
}

function exigirJson(out, oQueE) {
  let texto;
  try {
    texto = typeof out.parsed === "object" && out.parsed ? out.parsed : JSON.parse(out.content);
  } catch {
    const e = new Error(`${oQueE} nao devolveu JSON`);
    e.reason_code = "MODEL_OUTPUT_INVALID";
    throw e;
  }
  return texto;
}

/**
 * @param {{ modelGateway: any, task_class?: string, max_cost_cents?: number }} deps
 */
export function createComposer({ modelGateway, task_class = "copywriting", max_cost_cents } = {}) {
  if (!modelGateway) throw new Error("createComposer exige um modelGateway");

  return {
    /**
     * Master content.
     *
     * Devolve `{ title, master_body, claims }`. Os claims saem daqui SEM
     * evidence_ids: nesta fase o redator nao tem de onde citar, e um claim
     * material sem lastro e recusado pela capability com CLAIM_UNSUPPORTED.
     * Isso e o comportamento desejado, nao uma limitacao a contornar — o
     * agente nao promete cobertura que ninguem sustentou.
     */
    async draft({ tenant, trace_id, brand, objective, channel }) {
      const messages = assembleContext({
        system:
          "Voce escreve conteudo de marketing para uma corretora de seguros, em portugues do Brasil.\n" +
          "Escreva o texto mestre, ainda sem formatacao de canal.\n" +
          "Respeite o material da marca que vier no turno de contexto: tom, claims permitidos, " +
          "proibicoes e disclaimers.\n" +
          "Depois de escrever, liste o que voce AFIRMOU. Marque material: true em qualquer " +
          "afirmacao sobre cobertura, preco ou prazo, e use claim_type COVERAGE, PRICE ou DEADLINE. " +
          "Uma afirmacao material que voce nao consiga sustentar sera recusada — entao prefira " +
          "nao afirma-la a marca-la como generica.\n" +
          'Responda em JSON: {"title": "...", "master_body": "...", ' +
          '"claims": [{"text": "...", "claim_type": "COVERAGE|PRICE|DEADLINE|PERFORMANCE|GENERAL", "material": true|false}]}',
        schemas: "Responda no contrato olga://io/draft-composition.",
        session: { objetivo: objective ?? null, canal_de_destino: channel ?? null },
        governed: marcaComoMaterial(brand),
      });

      // `schema_ref` faz o Model Gateway validar antes de devolver. E ele que
      // fecha o claim_type num enum: sem isso, um claim_type desconhecido teria
      // de ser rebaixado para GENERAL aqui — e rebaixar em silencio uma
      // afirmacao sobre cobertura e exatamente o erro que nao se pode cometer.
      const out = await modelGateway.complete({
        trace_id, tenant, task_class,
        schema_ref: "olga://io/draft-composition",
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_cost_cents,
      });

      const t = exigirJson(out, "redator");
      return { title: t.title, master_body: t.master_body, claims: t.claims ?? [] };
    },

    /**
     * Variante de canal.
     *
     * Recebe o master JA GRAVADO e adapta. Nao recebe o objetivo nem liberdade
     * para acrescentar: o que foi afirmado ja passou pelos claims do master, e
     * uma variante que afirme algo novo afirmaria fora de qualquer verificacao.
     */
    async variant({ tenant, trace_id, channel, master_body, brand }) {
      const limite = LIMITE_POR_CANAL[channel] ?? 2000;
      const messages = assembleContext({
        system:
          `Adapte o texto mestre para o canal ${channel}, em portugues do Brasil.\n` +
          `O corpo deve caber em ${limite} caracteres.\n` +
          "Adapte forma, nao substancia: nao acrescente afirmacao que o texto mestre nao faz, " +
          "nao remova disclaimer, nao invente numero, prazo, preco ou cobertura.\n" +
          'Responda em JSON: {"headline": "...", "body": "...", "cta": "..."}',
        schemas: "Responda no contrato olga://io/variant-composition.",
        session: { canal: channel, limite_de_caracteres: limite },
        governed: { ...(marcaComoMaterial(brand) ?? {}), texto_mestre: master_body },
      });

      const out = await modelGateway.complete({
        trace_id, tenant, task_class,
        schema_ref: "olga://io/variant-composition",
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_cost_cents,
      });

      const t = exigirJson(out, "adaptador de canal");
      const body = t.body;
      if (body.length > limite) {
        // Truncar seria cortar a frase de alguem no meio, e possivelmente um
        // disclaimer. Recusar devolve o problema a quem pode resolve-lo.
        const e = new Error(`variante de ${channel} passou de ${limite} caracteres`);
        e.reason_code = "UNSUPPORTED_VALUE";
        throw e;
      }
      return { headline: t.headline ?? null, body, cta: t.cta ?? null };
    },
  };
}
