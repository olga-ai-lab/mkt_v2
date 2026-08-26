/**
 * Adapter brand_extract — a capability que se chama "extract" passa a extrair.
 *
 * Ate aqui `brand.extract_from_url` apontava direto para o adapter web_fetch.
 * Aquele adapter faz uma coisa, e bem: busca a pagina sem cair num SSRF. Mas
 * ele devolve `{ texto, hash, url_final }` e nenhuma chave `output` — e o
 * gateway devolve ao chamador `out?.output ?? null`. Ou seja: a pagina era
 * buscada, com toda a defesa, e o texto era jogado fora. A primeira porta da
 * Fase 2 era um cano sem saida.
 *
 * Este arquivo compoe as duas metades. Ele nao busca (delega ao web_fetch, que
 * continua sendo o unico lugar que fala com a rede) e nao chama modelo (delega
 * a porta `extract`, que e quem conhece o Model Gateway). O que ele faz e o que
 * nenhum dos dois pode fazer sozinho: decidir o que do resultado do modelo tem
 * lastro na pagina, e assinar a procedencia.
 *
 * ── Procedencia e produzida aqui, nunca declarada pelo modelo ──────────────
 *
 * `source_refs` sai do resultado da BUSCA: a URL final depois dos
 * redirecionamentos, o hash do texto que foi realmente lido, e a hora. O
 * contrato olga://io/brand-extraction nao tem campo para o modelo escrever
 * procedencia, e o additionalProperties: false dele recusa a tentativa.
 *
 * A diferenca importa porque source_refs e o que responde, seis meses depois,
 * "de onde veio esta versao da marca". Uma procedencia que o modelo escreve
 * responde "de onde ele disse que veio".
 *
 * ── A conferencia de citacao ───────────────────────────────────────────────
 *
 * Todo item de claims_allowed e disclaimers chega com uma citacao. Se a citacao
 * nao estiver na pagina, o item nao entra — e vai para `discarded`, com codigo.
 *
 * Descartar em vez de reprovar a extracao inteira e escolha, e ela tem motivo:
 * quem opera nao tem como consertar uma alucinacao repetindo a chamada, e uma
 * home boa costuma render varios itens certos e um errado. Reprovar tudo
 * transformaria onboarding em roleta. O que nao se pode e descartar em
 * silencio: quem revisa o CANDIDATE precisa ver que houve item sem lastro,
 * porque isso diz algo sobre a extracao inteira, nao so sobre aquele item.
 *
 * ── Por que o adapter confere a URL contra o cadastro ──────────────────────
 *
 * O compilador ja monta `url` a partir do site cadastrado da marca, e nunca do
 * texto do modelo. Isto aqui e a segunda tranca, na porta certa: qualquer coisa
 * que consiga montar um CapabilityRequest — um bug de compilador, um teste, uma
 * integracao futura — escolheria para onde o nosso servidor faz uma requisicao.
 * Numa capability que sai para a rede, essa e a diferenca entre ler o site do
 * cliente e ser usado como proxy.
 *
 * A comparacao e por HOST, nao por URL inteira: ler /sobre de um site cadastrado
 * como raiz e legitimo, e exigir igualdade exata so ensinaria alguem a
 * afrouxar a regra depois.
 */
import { CapabilityError } from "../index.mjs";
import { normalizarTexto } from "./internal.mjs";

/**
 * Texto de menos e texto demais, e os dois sao recusa.
 *
 * Curto demais: uma home que so renderiza no navegador chega aqui como um punhado
 * de boilerplate. Extrair marca dali seria inventar — e a invencao teria a
 * mesma aparencia de um resultado bom.
 *
 * Longo demais: nao se trunca. Meia pagina vira meia verdade sobre a marca, e
 * quem le a proposta nao teria como saber que ela foi tirada de um pedaco. O
 * teto tambem protege o orcamento, mas esse e o motivo menor: o Model Gateway
 * so descobre estouro DEPOIS de a chamada acontecer, quando o dinheiro ja saiu.
 */
const MIN_TEXTO = 400;
const MAX_TEXTO = 40_000;

const naoRetentavel = (reason_code, message) =>
  new CapabilityError(reason_code, message, { error_class: "PERMANENT", retryable: false });

/** Host comparavel: minusculas, sem o www. que nao distingue nada. */
export function hostDe(url) {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * @param {{ fetcher: object, extract: object, knowledge: object, clock?: object }} deps
 *   `fetcher` e o proprio adapter web_fetch — a mesma interface, usada como
 *   porta. Que ele sirva aqui sem uma linha de adaptacao e a prova de que a
 *   fronteira do adapter estava no lugar certo.
 */
export function createBrandExtractAdapter({ fetcher, extract, knowledge, clock } = {}) {
  const agora = () => new Date(clock?.now?.() ?? Date.now()).toISOString();

  /**
   * Porta ausente e metodo ausente sao a mesma falha para quem chama, e as
   * duas tem de ser recusa nomeada: um `knowledge` sem `brand` produziria um
   * TypeError no primeiro pedido real, e TypeError nao tem reason code.
   */
  const exigir = (porta, nome, metodo) => {
    if (!porta || (metodo && typeof porta[metodo] !== "function")) {
      throw new CapabilityError("PROVIDER_UNAVAILABLE",
        `brand.extract_from_url exige ${metodo ? `${nome}.${metodo}` : `a porta ${nome}`}, que nao foi montado`);
    }
    return porta;
  };

  async function extractFromUrl({ capability, request, trace_id }) {
    const k = exigir(knowledge, "knowledge", "brand");
    const busca = exigir(fetcher, "fetcher", "call");
    const leitor = exigir(extract, "extract", "fromPage");

    const { brand_id, url } = request.args ?? {};
    if (!brand_id) throw naoRetentavel("SCHEMA_VALIDATION_FAILED", "sem brand_id");
    if (!url) throw naoRetentavel("SCHEMA_VALIDATION_FAILED", "sem url para ler");

    const marca = await k.brand(request.tenant.org_id, brand_id);
    if (!marca) throw naoRetentavel("NORMALIZATION_FAILED", "essa marca nao existe neste tenant");
    if (!marca.website_url) {
      throw naoRetentavel("NORMALIZATION_FAILED", "essa marca nao tem site cadastrado para eu ler");
    }
    if (hostDe(url) == null || hostDe(url) !== hostDe(marca.website_url)) {
      throw naoRetentavel("UNSUPPORTED_VALUE",
        "so leio o site cadastrado desta marca, e este endereco e de outro dominio");
    }

    // ── 1. A pagina. Toda a defesa de rede mora do outro lado desta chamada.
    const pagina = await busca.call({ capability, request, trace_id });
    const texto = String(pagina?.texto ?? "");

    if (texto.length < MIN_TEXTO) {
      throw naoRetentavel("EVIDENCE_INSUFFICIENT",
        "essa pagina tem texto de menos para eu entender a marca — aponte uma pagina com o conteudo escrito");
    }
    if (texto.length > MAX_TEXTO) {
      throw naoRetentavel("UNSUPPORTED_VALUE",
        "essa pagina e longa demais para eu ler inteira — aponte uma pagina mais especifica, como a de 'sobre'");
    }

    // ── 2. A leitura. O que volta ja foi validado contra o contrato.
    const lido = await leitor.fromPage({
      tenant: request.tenant, trace_id,
      brand_name: marca.name ?? null,
      url: pagina.url_final ?? url,
      texto,
    });

    // ── 3. A conferencia. Codigo, nao modelo.
    const pagina_normalizada = normalizarTexto(texto);
    const discarded = [];
    const sustentados = (itens, field) => {
      const ok = [];
      for (const item of itens ?? []) {
        const citacao = normalizarTexto(item?.quote);
        if (citacao.length >= 8 && pagina_normalizada.includes(citacao)) {
          ok.push(String(item.text));
        } else {
          // CLAIM_UNSUPPORTED e literalmente o que aconteceu: a afirmacao veio
          // sem o que a sustentaria. Nao se cria codigo novo para um caso que
          // um codigo existente descreve com precisao.
          discarded.push({ field, text: String(item?.text ?? ""), reason_code: "CLAIM_UNSUPPORTED" });
        }
      }
      return ok;
    };

    const proposta = {
      brand_id: String(brand_id),
      identity: lido.identity ?? {},
      tone: lido.tone ?? {},
      claims_allowed: sustentados(lido.claims_allowed, "claims_allowed"),
      // Ver olga://io/brand-proposal: proibicao nao se le de um site.
      prohibitions: [],
      disclaimers: sustentados(lido.disclaimers, "disclaimers"),
      source_refs: [{
        kind: "WEB_PAGE",
        locator: String(pagina.url_final ?? url),
        hash: String(pagina.hash),
        retrieved_at: agora(),
      }],
      discarded,
    };

    // `external_id` e o hash do texto lido, e nao um id de provider: nao houve
    // efeito externo nenhum. Ele identifica O QUE FOI LIDO — duas extracoes da
    // mesma pagina inalterada carregam o mesmo, e isso e util no trace.
    return { external_id: proposta.source_refs[0].hash, request_hash: pagina.request_hash ?? null, output: proposta };
  }

  const handlers = { "brand.extract_from_url": extractFromUrl };

  return {
    name: "brand_extract",
    capabilities: Object.keys(handlers),

    async call({ capability, request, trace_id }) {
      const handler = handlers[capability.capability_id];
      if (!handler) {
        throw new CapabilityError("CAPABILITY_NOT_ACTIVE",
          `brand_extract nao executa ${capability.capability_id}`);
      }
      try {
        return await handler({ capability, request, trace_id: trace_id ?? request.trace_id });
      } catch (e) {
        if (e instanceof CapabilityError) throw e;
        if (e?.reason_code) {
          // Falha do extrator (orcamento, rota, saida invalida) ja vem nomeada.
          // Repetir nao conserta nenhuma delas, entao nenhuma e retentavel.
          throw new CapabilityError(e.reason_code, e.message,
            { error_class: "PERMANENT", retryable: false });
        }
        throw e;
      }
    },
  };
}
