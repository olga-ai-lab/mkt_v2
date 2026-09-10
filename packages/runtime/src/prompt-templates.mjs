/**
 * Escolha e render dos templates de prompt.
 *
 * Duas operacoes, as duas deterministicas e as duas em CODIGO. Nenhum
 * modelo participa daqui: escolher qual template atende um perfil e
 * substituir variaveis sao contas, e o principio do projeto diz onde conta
 * mora — "o codigo calcula".
 *
 * ── Onde o texto renderizado entra no prompt, e por que importa ─────────
 *
 * Ele entra na camada `governed`, que e turno de USUARIO — nunca na de
 * sistema. O motivo nao e estetico: os valores das variaveis vem do
 * formulario que o cliente preencheu. Um {{o_que_comunica}} contendo
 * "IGNORE AS INSTRUCOES ANTERIORES" e um texto que alguem de fora
 * escreveu, e texto de fora com autoridade de sistema e a forma mais
 * barata de prompt injection que existe (agent-stages.mjs §Montagem).
 *
 * O template em si e da Olga e poderia falar como sistema; os valores
 * substituidos nele nao. Como os dois viram uma string so depois do
 * render, a string inteira desce para material. E a escolha conservadora
 * na direcao certa: um brief que o modelo le como pedido, e nao como
 * regra que sobrepoe as regras.
 *
 * ── Por que recusar em vez de completar ────────────────────────────────
 *
 * Variavel declarada e sem valor NAO vira string vazia. "Escreva para
 * {{publico_alvo}}" com publico_alvo ausente viraria "Escreva para " — uma
 * instrucao truncada que o modelo completa sozinho, escolhendo publico por
 * conta propria. E o mesmo erro que o AGT-MKT-BRAND evita ao declarar
 * lacuna em vez de preencher: lacuna declarada e corrigivel, lacuna
 * preenchida vira fato falso que ninguem rastreia.
 */

/**
 * A gramatica dos placeholders: {{ nome }}.
 *
 * Espelha `mkt.prompt_placeholders` (migration 0012), que e o que a
 * constraint do banco usa. Duas implementacoes da mesma regra so sao
 * seguras enquanto alguem as compara — e ha teste que compara.
 */
const PLACEHOLDER = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/g;

class TemplateError extends Error {
  constructor(reason_code, message) {
    super(message);
    this.reason_code = reason_code;
  }
}

/** Os nomes que o corpo realmente usa, sem repetir. */
export function placeholdersDe(body) {
  return [...new Set([...String(body ?? "").matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/**
 * Quao especifico um template e para um pedido.
 *
 * Canal pesa mais que tipo de operacao porque e a escolha mais concreta:
 * um template de LinkedIn sabe o formato da peca, enquanto um de
 * "corretora" sabe so o tom. Nao ha empate real na pratica, mas o
 * desempate existe assim mesmo — escolha de prompt que varia entre duas
 * execucoes iguais e impossivel de investigar depois.
 */
function especificidade(t) {
  return (t.channel ? 2 : 0) + ((t.org_types?.length ?? 0) > 0 ? 1 : 0);
}

function serve(t, { org_type, objective, channel }) {
  if (t.status !== "ACTIVE") return false;
  if (t.objective !== objective) return false;

  // Template de canal so serve a pedido daquele canal. Um pedido sem canal
  // pega o base: aceitar o de LinkedIn ali seria formatar para um destino
  // que ninguem pediu.
  if (t.channel && t.channel !== channel) return false;

  const tipos = t.org_types ?? [];
  if (tipos.length > 0 && !tipos.includes(org_type)) return false;

  return true;
}

/**
 * O template que atende o perfil, ou recusa.
 *
 * @param {Array} templates  linhas de mkt.prompt_templates
 * @param {{ org_type: string, objective: string, channel?: string|null }} perfil
 */
export function escolherTemplate(templates, { org_type, objective, channel = null }) {
  const candidatos = (templates ?? []).filter((t) => serve(t, { org_type, objective, channel }));

  if (candidatos.length === 0) {
    // UNSUPPORTED_VALUE e o codigo certo, e nao "nao encontrei": a
    // combinacao pedida e legitima, so ainda nao tem template. Quem le a
    // microcopy precisa entender que falta biblioteca, nao que ele errou.
    throw new TemplateError("UNSUPPORTED_VALUE",
      `sem template ativo para objetivo ${objective}` +
      (channel ? ` no canal ${channel}` : "") + ` e operacao ${org_type}`);
  }

  candidatos.sort((a, b) =>
    especificidade(b) - especificidade(a) ||
    (b.version ?? 0) - (a.version ?? 0) ||
    String(a.template_id).localeCompare(String(b.template_id)));

  return candidatos[0];
}

/**
 * Substitui as variaveis declaradas pelos valores do perfil.
 *
 * Recusa em tres casos, e os tres sao defeito de alguem:
 *   - valor ausente ou em branco para variavel declarada  -> falta dado
 *   - variavel usada no corpo e nao declarada             -> template torto
 *   - variavel declarada e nao usada                      -> template torto
 *
 * Os dois ultimos ja sao barrados pela constraint do banco. A checagem
 * aqui existe para o template que NAO veio do banco — teste, seed novo,
 * fixture — nao encontrar o problema so na frente do modelo.
 */
export function renderTemplate(template, valores = {}) {
  const declaradas = template?.variables ?? [];
  const usadas = placeholdersDe(template?.body);

  const naoDeclaradas = usadas.filter((v) => !declaradas.includes(v));
  const naoUsadas = declaradas.filter((v) => !usadas.includes(v));
  if (naoDeclaradas.length || naoUsadas.length) {
    throw new TemplateError("SCHEMA_VALIDATION_FAILED",
      `template ${template?.template_id} incoerente: ` +
      (naoDeclaradas.length ? `usa sem declarar ${naoDeclaradas.join(", ")}. ` : "") +
      (naoUsadas.length ? `declara sem usar ${naoUsadas.join(", ")}.` : ""));
  }

  const faltando = declaradas.filter((v) => {
    const valor = valores[v];
    return valor == null || String(valor).trim() === "";
  });
  if (faltando.length) {
    throw new TemplateError("SCHEMA_VALIDATION_FAILED",
      `template ${template?.template_id} exige ${faltando.join(", ")}, ` +
      "e o perfil nao respondeu");
  }

  return template.body.replace(PLACEHOLDER, (_, nome) => String(valores[nome]).trim());
}

/** Rotulos de tela. Ficam aqui porque o template os consome como variavel. */
export const ROTULO_ORG_TYPE = {
  CORRETORA: "corretora de seguros",
  CORRETOR_AUTONOMO: "corretor de seguros autonomo",
  ASSESSORIA: "assessoria ou rede de corretores",
  SEGURADORA: "seguradora",
  MGA: "MGA (managing general agent)",
  BENEFICIOS: "operacao de beneficios",
};

export const ROTULO_OBJETIVO = {
  NOVOS_NEGOCIOS: "gerar novos negocios",
  AUTORIDADE: "construir autoridade",
  MARCA: "fortalecer a marca",
  RELACIONAMENTO: "ampliar relacionamento",
};

/**
 * Os valores que um template pode pedir, montados a partir do perfil.
 *
 * Uma fonte so para o que alimenta o render: se cada chamador montasse o
 * seu objeto, um deles esqueceria um campo e o template recusaria por
 * "perfil nao respondeu" quando o perfil respondeu.
 */
export function variaveisDoPerfil(perfil, { brand_name, briefing, channel = null } = {}) {
  return {
    brand_name,
    briefing,
    org_type_label: ROTULO_ORG_TYPE[perfil?.org_type] ?? perfil?.org_type,
    objetivo_label: ROTULO_OBJETIVO[perfil?.objective] ?? perfil?.objective,
    canal_label: channel,
    publico_alvo: perfil?.publico_alvo,
    o_que_comunica: perfil?.o_que_comunica,
    como_comunica: perfil?.como_comunica,
  };
}
