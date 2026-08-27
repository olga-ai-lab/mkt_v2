/**
 * As três pontas de LLM do loop: Resolver, Planner e Responder.
 *
 * O loop em agent-loop.mjs não sabe que existe modelo nenhum — ele recebe
 * estas portas por injeção. Este arquivo é a única implementação delas que
 * fala com um LLM, e é por isso que ele carrega as regras de como falar.
 *
 * ── Montagem de contexto: sete camadas, nesta ordem (Mestra §11) ───────────
 *
 *   1. system/constitutional   4. trusted session context
 *   2. persona/voice           5. retrieved governed context
 *   3. runtime schemas         6. user input
 *                              7. tool results/evidence
 *
 * A ordem não é estética. O input do usuário entra em SEXTO, depois das
 * regras, dos schemas e do contexto governado. Texto de usuário que chegasse
 * antes disso competiria com a instrução do sistema pela mesma posição de
 * autoridade — que é a forma mais barata de prompt injection que existe.
 *
 * E o input do usuário NUNCA entra na mensagem de sistema. Há teste para isso.
 *
 * ── Prompt fino (Mestra §11) ───────────────────────────────────────────────
 *
 * Conhecimento, regras e schemas moram fora do prompt: no registry, na policy
 * e nos contratos. O que sobra para o prompt é o que só ele sabe fazer —
 * interpretação, precedência, estilo e política de incerteza. Por isso os
 * textos abaixo são curtos. Um prompt que cresce é quase sempre um prompt
 * absorvendo regra que deveria estar em outro lugar.
 *
 * ── O vetor que este arquivo fecha ─────────────────────────────────────────
 *
 * Os schemas de IntentResolution e TaskPlan EXIGEM um campo `tenant`. Ou seja,
 * o modelo devolve um objeto que contém org_id e workspace_id — e, se
 * confiássemos neles, o modelo escolheria de qual organização são os dados.
 *
 * Nada aqui lê tenant, trace_id ou agent_id da saída do modelo. Os três são
 * sobrescritos pelo contexto confiável depois do parse, sempre. O schema
 * obriga o campo a existir; nós obrigamos ele a estar certo.
 */
import { assertValid } from "@olga/contracts";
import { deltaFor } from "./agent-deltas.mjs";

/** Ordem fixa das camadas. Exportada para o teste poder afirmar a ordem. */
export const CONTEXT_LAYERS = [
  "system", "persona", "schemas", "session", "governed", "user", "tools",
];

/**
 * Monta as mensagens na ordem das sete camadas.
 *
 * Camada ausente não vira mensagem vazia: some. Mensagem vazia gasta token e
 * ainda dá ao modelo um lugar para inventar significado.
 */
export function assembleContext(layers = {}) {
  const mensagens = [];
  for (const nome of CONTEXT_LAYERS) {
    const conteudo = layers[nome];
    if (conteudo == null || conteudo === "") continue;
    const texto = typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo);
    // Só as três primeiras camadas falam com autoridade de sistema. As demais
    // são material a ser interpretado, e entram como turno de usuário.
    const role = (nome === "system" || nome === "persona" || nome === "schemas")
      ? "system" : "user";
    mensagens.push({ role, content: texto, layer: nome });
  }
  return mensagens;
}

/**
 * Camada de persona: o delta do agente, montado a partir da linha do registry.
 *
 * Missão e capabilities NÃO são escritas aqui — vêm do banco, via deltaFor().
 * O que o delta acrescenta é a política de incerteza: para que lado este
 * agente erra quando não tem certeza.
 */
const personaDe = (agent) => deltaFor(agent);

const REGRAS_COMUNS =
  "Você interpreta pedidos; você não autoriza nada. " +
  "Quando o pedido for ambíguo em algo que muda o resultado, diga que é ambíguo " +
  "em vez de escolher por conta própria. " +
  "Nunca invente identificador: se não souber o id canônico de algo, deixe nulo. " +
  "Responda apenas com JSON válido no formato pedido, sem texto em volta.";

/*
 * Os prompts de sistema, como constantes nomeadas.
 *
 * Estavam embutidos dentro de cada função. Ficaram aqui porque a Mestra §32
 * manda versionar prompt, e §30 manda o trace registrar essa versão — e não se
 * versiona o que não tem nome. `packages/runtime/prompts.lock.json` guarda o
 * hash de cada um, e há teste que falha se o texto mudar sem a versão do
 * conjunto subir.
 *
 * Eles continuam AQUI, e não num diretório de prompts, porque o texto e o
 * código que o usa são revisados juntos: um prompt longe da função que o manda
 * é um prompt que muda sem ninguém ver o efeito.
 */
export const PROMPT_RESOLVER =
  `${REGRAS_COMUNS}\n` +
  "Sua tarefa: identificar a intenção, as entidades e as ambiguidades do pedido. " +
  "confidence_band é HIGH, MEDIUM ou LOW — nunca um percentual.";

export const PROMPT_PLANNER =
  `${REGRAS_COMUNS}\n` +
  "Sua tarefa: propor os passos para atender a intenção. " +
  "Em args_summary escreva um resumo em português para uma pessoa ler. " +
  "NÃO escreva argumentos técnicos, ids ou parâmetros: eles são montados " +
  "por código a partir das entidades já resolvidas, e o que você escrever " +
  "ali será ignorado.";

export const PROMPT_RESPONDER =
  "Escreva a resposta ao usuário em português do Brasil. " +
  "Diga o que aconteceu e qual é o próximo passo. " +
  "Só afirme o que estiver sustentado pela evidência recebida. " +
  "Não prometa o que não aconteceu, não cite id que não esteja na evidência, " +
  "e não explique detalhe técnico de erro. " +
  'Responda em JSON: {"message": "...", "next_step": "..."}';

/**
 * Sobrescreve os campos que o modelo não tem autoridade para decidir.
 *
 * O schema exige que existam; o contexto confiável decide quais são.
 */
function fixarConfiaveis(obj, { trace_id, tenant, extra = {} }) {
  return { ...obj, ...extra, trace_id, tenant };
}

// ── Resolver ────────────────────────────────────────────────────────────────

/**
 * @param {{ modelGateway: any, task_class?: string, prompt?: string }} deps
 */
export function createLlmResolver({ modelGateway, task_class = "extraction", prompt } = {}) {
  return {
    async resolve({ trace_id, tenant, input, agent, agent_run_id = null }) {
      const messages = assembleContext({
        system: prompt ?? PROMPT_RESOLVER,
        persona: personaDe(agent),
        schemas: "Formato de saída: olga://io/intent-resolution",
        session: { org_scope: "definido pelo servidor", actor_role: input?.actor_role ?? null },
        user: input?.text ?? "",
      });

      const out = await modelGateway.complete({
        trace_id, tenant, task_class, agent_run_id,
        messages: messages.map(({ role, content }) => ({ role, content })),
        schema_ref: "olga://io/intent-resolution",
        max_cost_cents: agent?.model_profile?.max_cost_cents_per_run,
      });

      // O modelo devolveu um tenant. Ele não decide qual é.
      const intent = fixarConfiaveis(out.parsed, { trace_id, tenant });
      assertValid("olga://io/intent-resolution", intent);
      return intent;
    },
  };
}

// ── Planner ─────────────────────────────────────────────────────────────────

export function createLlmPlanner({ modelGateway, task_class = "reasoning", prompt } = {}) {
  return {
    async plan({ trace_id, tenant, intent, agent, context, agent_run_id = null }) {
      const messages = assembleContext({
        system: prompt ?? PROMPT_PLANNER,
        persona: personaDe(agent),
        schemas: "Formato de saída: olga://io/task-plan",
        governed: context?.slices?.length ? { slices: context.slices } : null,
        user: { intent: intent.intent, entities: intent.entities },
      });

      const out = await modelGateway.complete({
        trace_id, tenant, task_class, agent_run_id,
        messages: messages.map(({ role, content }) => ({ role, content })),
        schema_ref: "olga://io/task-plan",
        max_cost_cents: agent?.model_profile?.max_cost_cents_per_run,
      });

      const plan = fixarConfiaveis(out.parsed, {
        trace_id, tenant,
        extra: { agent_id: agent.agent_id, agent_version: String(agent.version) },
      });
      assertValid("olga://io/task-plan", plan);
      return plan;
    },
  };
}

// ── Responder ───────────────────────────────────────────────────────────────

/**
 * Diferente dos outros dois, a saída daqui NÃO é validada contra um schema
 * pelo model gateway: o FinalResponse é montado pelo loop, que junta a
 * mensagem com estado, reason codes e ids de evidência. O responder escreve
 * só o texto — e recebe apenas a evidência que existe, para não ter do que
 * inventar.
 */
export function createLlmResponder({ modelGateway, task_class = "copywriting", prompt } = {}) {
  return {
    async respond({ trace_id, tenant, agent, intent, evidence, execution, respondability,
                    agent_run_id = null }) {
      const messages = assembleContext({
        system: prompt ?? PROMPT_RESPONDER,
        persona: personaDe(agent),
        schemas: 'Formato: {"message": string, "next_step": string}',
        session: { intent: intent?.intent ?? null, estado: respondability?.state ?? null },
        tools: {
          evidencias: (evidence?.items ?? []).map((i) => ({
            evidence_id: i.evidence_id, source_kind: i.source_kind,
          })),
          execucao: execution ? { status: execution.status } : null,
        },
      });

      const out = await modelGateway.complete({
        trace_id, tenant, task_class, agent_run_id,
        messages: messages.map(({ role, content }) => ({ role, content })),
        max_cost_cents: agent?.model_profile?.max_cost_cents_per_run,
      });

      let texto;
      try {
        texto = typeof out.parsed === "object" && out.parsed
          ? out.parsed
          : JSON.parse(out.content);
      } catch {
        // Saída ilegível não vira resposta improvisada: o loop precisa saber.
        const e = new Error("responder nao devolveu JSON");
        e.reason_code = "MODEL_OUTPUT_INVALID";
        throw e;
      }

      if (!texto?.message || !texto?.next_step) {
        const e = new Error("resposta sem message ou next_step");
        e.reason_code = "MODEL_OUTPUT_INVALID";
        throw e;
      }

      // evidence_ids não vêm do modelo: quem cita evidência é o loop, a partir
      // do pacote real. Se o modelo mandar algum, ele é passado adiante para o
      // loop conferir o grounding e recusar se for inventado.
      return {
        message: String(texto.message),
        next_step: String(texto.next_step),
        evidence_ids: Array.isArray(texto.evidence_ids) ? texto.evidence_ids : [],
      };
    },
  };
}
