/**
 * Adapter web_fetch — busca a página que o cliente apontou.
 *
 * O registry declara `provider_adapter: web_fetch` em brand.extract_from_url,
 * e até agora esse adapter não existia. Ele é o que permite "monta o Brand
 * Brain a partir do nosso site".
 *
 * ═══ Este arquivo é sobre SSRF, não sobre HTTP ═════════════════════════════
 *
 * Buscar uma URL que o USUÁRIO escolhe é o vetor clássico de Server-Side
 * Request Forgery. O servidor tem acesso a coisas que o usuário não tem — a
 * rede interna, o banco, e em nuvem o endpoint de metadados, que entrega
 * credencial de máquina para quem pedir sem autenticação nenhuma:
 *
 *     http://169.254.169.254/latest/meta-data/iam/security-credentials/
 *
 * Um "extraia a marca desta URL" apontado para lá vira exfiltração de
 * credencial com aparência de funcionalidade. Por isso a defesa aqui não é
 * uma lista de bloqueio de domínios — é uma lista de PERMISSÃO de endereços:
 * resolvemos o host para IP e recusamos tudo que não seja público.
 *
 * Lista de permissão, não de bloqueio, porque a de bloqueio erra por omissão:
 * basta um formato de endereço que ninguém lembrou (IPv6 mapeado, decimal,
 * octal) para o filtro passar por fora.
 *
 * ── O que NÃO está fechado, e por quê ──────────────────────────────────────
 *
 * DNS rebinding. Resolvemos o nome, validamos o IP, e então o fetch resolve de
 * novo — e nesse intervalo o DNS pode responder outra coisa. Fechar isso exige
 * conectar no IP já validado e mandar o Host original, o que em Node pede um
 * agent customizado com `lookup` fixado.
 *
 * Fica registrado em vez de escondido: a janela é estreita, exige DNS
 * controlado pelo atacante, e a mitigação real é rede — egress restrito no
 * ambiente que roda isto. Se o dado a proteger crescer, o agent customizado é
 * o próximo passo, não um "talvez".
 */
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CapabilityError } from "../index.mjs";

const MAX_BYTES = 2 * 1024 * 1024;   // 2 MB de HTML é muito mais que qualquer home
const MAX_REDIRECTS = 3;

const naoRetentavel = (reason_code, message, extra = {}) =>
  new CapabilityError(reason_code, message, { error_class: "PERMANENT", retryable: false, ...extra });
const retentavel = (reason_code, message, extra = {}) =>
  new CapabilityError(reason_code, message, { error_class: "TRANSIENT", retryable: true, ...extra });

/**
 * Um IP é público?
 *
 * Escrito como "o que é permitido", e tudo fora disso é recusado.
 */
export function ehPublico(ip) {
  const versao = isIP(ip);
  if (versao === 4) return ipv4Publico(ip);
  if (versao === 6) return ipv6Publico(ip.toLowerCase());
  return false;
}

function ipv4Publico(ip) {
  const o = ip.split(".").map(Number);
  if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a, b] = o;
  if (a === 0) return false;                          // "este" host
  if (a === 10) return false;                         // privado
  if (a === 127) return false;                        // loopback
  if (a === 169 && b === 254) return false;           // link-local (metadados de nuvem)
  if (a === 172 && b >= 16 && b <= 31) return false;  // privado
  if (a === 192 && b === 168) return false;           // privado
  if (a === 192 && b === 0) return false;             // IETF / protocolo
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmark
  if (a >= 224) return false;                         // multicast e reservado
  return true;
}

function ipv6Publico(ip) {
  if (ip === "::" || ip === "::1") return false;      // indefinido e loopback
  // IPv4 mapeado: ::ffff:127.0.0.1 tem de cair na regra do IPv4, nao passar.
  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapeado) return ipv4Publico(mapeado[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) return false; // mapeado em hex
  const p = ip.split(":")[0];
  if (/^f[cd]/.test(p)) return false;                 // fc00::/7 unique local
  if (/^fe[89ab]/.test(p)) return false;              // fe80::/10 link-local
  if (/^ff/.test(p)) return false;                    // multicast
  return true;
}

/** Valida o alvo e devolve o IP resolvido. Lança se não for buscável. */
export async function validarAlvo(url, { resolver = lookup } = {}) {
  let u;
  try { u = new URL(url); }
  catch { throw naoRetentavel("UNSUPPORTED_VALUE", "endereço inválido"); }

  // Só https. http:// em rede interna é metade do caminho de um SSRF, e para
  // o site público de uma corretora não é pedir muito.
  if (u.protocol !== "https:") {
    throw naoRetentavel("UNSUPPORTED_VALUE", "só endereços https são aceitos");
  }
  if (u.username || u.password) {
    throw naoRetentavel("UNSUPPORTED_VALUE", "endereço com credencial embutida");
  }

  let enderecos;
  try {
    enderecos = await resolver(u.hostname, { all: true });
  } catch {
    throw naoRetentavel("UNSUPPORTED_VALUE", "não consegui resolver esse endereço");
  }

  const lista = Array.isArray(enderecos) ? enderecos : [enderecos];
  if (lista.length === 0) throw naoRetentavel("UNSUPPORTED_VALUE", "endereço sem IP");

  // TODOS têm de ser públicos. Um nome que resolve para um público e um
  // interno continua sendo um caminho para o interno.
  for (const { address } of lista) {
    if (!ehPublico(address)) {
      throw naoRetentavel("UNSUPPORTED_VALUE",
        "esse endereço aponta para a rede interna e não pode ser buscado");
    }
  }
  return { url: u, ips: lista.map((x) => x.address) };
}

/**
 * @param {{ fetch?: typeof globalThis.fetch, resolver?: Function,
 *           maxBytes?: number, tracer?: any }} deps
 */
export function createWebFetchAdapter({
  fetch: doFetch = globalThis.fetch, resolver = lookup,
  maxBytes = MAX_BYTES, tracer,
} = {}) {
  return {
    name: "web_fetch",

    async call({ capability, request, trace_id }) {
      const timeout_ms = capability?.timeout_ms ?? 20000;
      const alvo = request.args?.url;
      if (!alvo) throw naoRetentavel("SCHEMA_VALIDATION_FAILED", "sem url para buscar");

      let atual = alvo;
      let resposta = null;
      let aindaRedirecionando = false;

      // Redirect seguido à mão: cada salto é um alvo novo e revalidado. Deixar
      // o fetch seguir sozinho entregaria o redirect como forma de burlar a
      // validação — valida o público, redireciona para o interno.
      for (let salto = 0; salto <= MAX_REDIRECTS; salto++) {
        const { url } = await validarAlvo(atual, { resolver });

        try {
          resposta = await doFetch(url.toString(), {
            method: "GET",
            redirect: "manual",
            headers: { accept: "text/html,application/xhtml+xml", "user-agent": "OlgaMarketingOS/1.0" },
            signal: AbortSignal.timeout(timeout_ms),
          });
        } catch (e) {
          const msg = e?.name === "TimeoutError" ? "o site não respondeu no tempo" : "falha de rede";
          throw retentavel("PROVIDER_UNAVAILABLE", msg);
        }

        if (resposta.status >= 300 && resposta.status < 400) {
          const destino = resposta.headers.get("location");
          if (!destino) throw naoRetentavel("PROVIDER_UNAVAILABLE", "redirecionamento sem destino");
          atual = new URL(destino, url).toString();
          aindaRedirecionando = true;
          tracer?.event?.({ trace_id, event: "web_fetch.redirect", para: atual });
          continue;
        }
        aindaRedirecionando = false;
        break;
      }

      // Sair do laço ainda redirecionando significa que o limite estourou.
      // Sem esta checagem, a última resposta 3xx cairia no `!resposta.ok` mais
      // abaixo e o erro sairia como "não consegui abrir a página (302)" — que
      // manda quem lê procurar problema na página em vez da cadeia.
      if (!resposta || aindaRedirecionando) {
        throw naoRetentavel("UNSUPPORTED_VALUE", "esse endereço tem redirecionamentos demais");
      }
      if (resposta.status === 429) throw retentavel("PROVIDER_RATE_LIMITED", "o site limitou o acesso");
      if (resposta.status >= 500) throw retentavel("PROVIDER_UNAVAILABLE", `site respondeu ${resposta.status}`);
      if (!resposta.ok) {
        throw naoRetentavel("UNSUPPORTED_VALUE", `não consegui abrir a página (${resposta.status})`);
      }

      const tipo = resposta.headers.get("content-type") ?? "";
      if (tipo && !/text\/html|text\/plain|application\/xhtml/.test(tipo)) {
        throw naoRetentavel("UNSUPPORTED_VALUE", "esse endereço não é uma página de texto");
      }

      // Teto de tamanho ANTES de materializar: content-length mente, então o
      // corte real é na leitura. Uma página que não cabe não é truncada em
      // silêncio — porque metade de uma página vira meia verdade sobre a marca.
      const texto = await lerAteOLimite(resposta, maxBytes);

      const conteudo = extrairTexto(texto);

      // O texto vai em `output`, e nao solto no topo do retorno.
      //
      // O gateway monta o ExecutionResult com forma fixa e so repassa
      // `output` a quem chamou. Enquanto isto devolvia `texto` no topo, a
      // pagina era buscada, validada, lida — e jogada fora antes de chegar ao
      // loop. brand.extract_from_url era uma capability que gastava rede para
      // nao entregar nada.
      return {
        external_id: null,
        request_hash: createHash("sha256").update(atual).digest("hex"),
        output: {
          url_final: atual,
          texto: conteudo,
          hash: createHash("sha256").update(conteudo).digest("hex"),
          bytes: texto.length,
        },
      };
    },
  };
}

async function lerAteOLimite(resposta, maxBytes) {
  const declarado = Number(resposta.headers.get("content-length") ?? 0);
  if (declarado > maxBytes) {
    throw naoRetentavel("UNSUPPORTED_VALUE", "essa página é grande demais para analisar");
  }
  const buf = await resposta.arrayBuffer();
  if (buf.byteLength > maxBytes) {
    throw naoRetentavel("UNSUPPORTED_VALUE", "essa página é grande demais para analisar");
  }
  return new TextDecoder("utf-8").decode(buf);
}

/**
 * HTML para texto.
 *
 * Deliberadamente burro: tira script, style e tags, e normaliza espaço. Não é
 * um parser — e não precisa ser, porque o que vem daqui é MATERIAL para o
 * modelo ler, não estrutura para o código decidir.
 */
export function extrairTexto(html) {
  return String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
