/**
 * A linha *Safety* do trace (Mestra §30): sinais de injeção e redação de PII.
 *
 * ── O que este arquivo NÃO é ───────────────────────────────────────────────
 *
 * Não é a defesa. Isto precisa ficar dito alto, porque a leitura preguiçosa
 * deste arquivo — "ah, temos detecção de injeção" — é o caminho para alguém
 * afrouxar a defesa de verdade achando que há uma rede embaixo.
 *
 * A defesa contra injeção neste sistema é ESTRUTURAL, e mora em outros dois
 * lugares:
 *
 *   1. `assembleContext` — texto de usuário entra na SEXTA camada, nunca na de
 *      sistema. Texto que chegasse antes competiria com a instrução do sistema
 *      pela mesma posição de autoridade.
 *   2. O compiler — os argumentos de toda chamada nascem de código
 *      determinístico a partir de entidades verificadas. Uma injeção
 *      perfeitamente convincente não tem por onde virar `connection_id`.
 *
 * Nenhuma das duas depende de reconhecer o ataque. É por isso que elas
 * funcionam contra ataques que ninguém previu — e é por isso que continuam
 * sendo a defesa.
 *
 * ── O que este arquivo é ───────────────────────────────────────────────────
 *
 * O registro. A defesa estrutural é silenciosa: se um dia ela falhar, nada no
 * banco diz que alguém tentou. O eval `COPILOT-ADV-001` prova que uma injeção
 * conhecida não vira instrução — uma vez, em teste, contra um texto que nós
 * mesmos escrevemos. Produção não tem eval.
 *
 * ── Por que registra e não bloqueia ────────────────────────────────────────
 *
 * Um regex que bloqueia é um regex que autoriza. "O LLM interpreta; os
 * contratos decidem; o código calcula" vale também para heurística: quem
 * bloqueia neste sistema é a policy, que é dado tipado, escopado, priorizado e
 * revisável por migration.
 *
 * E o custo do contrário seria imediato. "Ignore o rascunho anterior e comece
 * de novo" é um pedido perfeitamente legítimo de quem escreve marketing, e
 * casa com qualquer padrão razoável de override. Bloquear nisso ensina a
 * pessoa a evitar o produto; registrar não custa nada a ela.
 *
 * ── PII: a 0012 declarou, e ninguém aplicava ───────────────────────────────
 *
 * `mkt.source_contracts.carries_pii` existe desde a 0012, e o caveat da fonte
 * `UPLOADED_FILE` diz, com todas as letras: "é a que recebe documento sem
 * passar por nenhum filtro nosso". A declaração estava certa e o filtro não
 * existia — o texto ia inteiro para o contexto do modelo.
 *
 * Aqui a redação é por padrão de formato, e por isso é conservadora de um jeito
 * específico: ela pega CPF, CNPJ, e-mail, telefone e CEP, que têm forma. Não
 * pega nome de pessoa, que não tem. Isso é limitação declarada, e não um bug a
 * consertar com uma lista de nomes comuns — a fonte marcada com PII deveria,
 * no limite, não virar contexto de modelo.
 */

/**
 * Padrões de tentativa de injeção, com nome.
 *
 * O nome é o que vai para o trace, e por isso ele descreve a TÉCNICA e não o
 * texto: `INSTRUCTION_OVERRIDE` responde "isso já tinha acontecido antes?" de
 * um jeito que `"ignore as instruções"` não responde.
 *
 * A lista é curta de propósito. Cada padrão aqui é uma frase que praticamente
 * não aparece em pedido honesto de marketing; um padrão largo encheria o trace
 * de ruído, e um trace ruidoso é um trace que ninguém lê.
 */
export const PADROES = [
  ["INSTRUCTION_OVERRIDE",
   /\b(ignore|ignora|esque[çc]a|desconsidere|disregard|forget)\b[^.\n]{0,40}\b(instru[çc][õo]es?|regras?|prompt|acima|anteriores?|previous|instructions?|rules?)\b/i],
  ["ROLE_IMPERSONATION",
   /(^|\n)\s*(system|assistant|sistema)\s*:|<\|[a-z_]+\|>|\[\/?(inst|sys)\]/i],
  ["PROMPT_EXFILTRATION",
   /\b(repita|mostre|revele|imprima|print|reveal|show|repeat)\b[^.\n]{0,40}\b(prompt|instru[çc][õo]es?|system|instructions?)\b/i],
  ["AUTHORITY_CLAIM",
   /\b(como|sou o|enquanto|as the|i am the)\b[^.\n]{0,20}\b(admin(istrador)?|owner|dono|desenvolvedor|developer|suporte)\b|\bautorizad[oa] pelo\b/i],
  ["AUTONOMY_ESCALATION",
   /\b(sem (pedir |precisar de )?(aprova[çc][ãa]o|confirma[çc][ãa]o|revis[ãa]o)|n[ãa]o pe[çc]a (aprova[çc][ãa]o|confirma[çc][ãa]o)|skip (the )?approval|without approval)\b/i],
];

/**
 * Os sinais encontrados num texto não confiável. Ordenados e sem repetição:
 * o trace responde "quais técnicas", não "quantas vezes cada uma".
 *
 * @param {...(string|null|undefined)} textos
 * @returns {string[]}
 */
export function sinaisDeInjecao(...textos) {
  const alvo = textos.filter((t) => typeof t === "string" && t !== "").join("\n");
  if (alvo === "") return [];
  return PADROES.filter(([, re]) => re.test(alvo)).map(([nome]) => nome).sort();
}

/**
 * PII com forma reconhecível. Nome de pessoa não está aqui porque não tem
 * forma — ver o cabeçalho.
 *
 * A ordem importa: CNPJ antes de CPF, porque o padrão de CPF casa dentro de um
 * CNPJ e apagaria metade dele, deixando o resto no texto. E-mail antes de
 * telefone, pelo mesmo motivo com números dentro de endereços.
 */
export const PII = [
  ["EMAIL",    /\b[\w.%+-]+@[\w-]+\.[a-z]{2,}\b/gi],
  ["CNPJ",     /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g],
  ["CPF",      /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g],
  ["TELEFONE", /(?:\+55\s?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g],
  ["CEP",      /\b\d{5}-\d{3}\b/g],
];

/**
 * Apaga PII de um texto, e diz o que apagou.
 *
 * O marcador fica visível (`[CPF]`) em vez de o trecho sumir: um texto com um
 * buraco silencioso faz o modelo inventar o que estava ali, e um `[CPF]` diz a
 * ele que havia um dado e que ele não deve ser usado.
 *
 * @param {string} texto
 * @returns {{ texto: string, redigidos: number, tipos: string[] }}
 */
export function redigir(texto) {
  if (typeof texto !== "string" || texto === "") {
    return { texto, redigidos: 0, tipos: [] };
  }
  let saida = texto;
  let redigidos = 0;
  const tipos = [];
  for (const [tipo, re] of PII) {
    let n = 0;
    saida = saida.replace(new RegExp(re.source, re.flags), () => { n += 1; return `[${tipo}]`; });
    if (n > 0) { redigidos += n; tipos.push(tipo); }
  }
  return { texto: saida, redigidos, tipos };
}

/**
 * Redige recursivamente os textos de uma estrutura, sem tocar na forma dela.
 *
 * Serve para uma fatia de retrieval, que é um objeto: redigir só o campo que
 * alguém lembrou de listar deixaria o resto passar, e "o resto" muda toda vez
 * que alguém acrescenta um campo.
 *
 * @param {any} valor
 * @returns {{ valor: any, redigidos: number, tipos: string[] }}
 */
export function redigirProfundo(valor) {
  const tipos = new Set();
  let redigidos = 0;

  const anda = (v) => {
    if (typeof v === "string") {
      const r = redigir(v);
      redigidos += r.redigidos;
      for (const t of r.tipos) tipos.add(t);
      return r.texto;
    }
    if (Array.isArray(v)) return v.map(anda);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, anda(x)]));
    }
    return v;
  };

  return { valor: anda(valor), redigidos, tipos: [...tipos].sort() };
}
