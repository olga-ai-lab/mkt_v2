/**
 * Loop de agente — as nove interfaces da Documentação Mestra §6.
 *
 * Até aqui o agent-runtime fazia uma chamada ao modelo e devolvia texto. Isso
 * é um cliente de LLM, não um agente. O que falta entre os dois é este
 * arquivo: a sequência que separa interpretar, decidir, executar e provar.
 *
 *   Resolver       texto            -> IntentResolution      (LLM)
 *   Retrieval      intent           -> slices + versões      (porta)
 *   Planner        intent + contexto-> TaskPlan              (LLM)
 *   Respondability plan + policy    -> decisão + reason codes (CÓDIGO)
 *   Compiler       plano aprovado   -> args reais            (CÓDIGO)
 *   Executor       request validado -> ExecutionResult       (gateway)
 *   Validator      resultado        -> ValidatedResult       (CÓDIGO)
 *   Evidence       resultado válido -> EvidencePackage       (CÓDIGO)
 *   Responder      evidence+persona -> FinalResponse         (LLM, aterrado)
 *
 * ── A linha que este arquivo existe para não deixar ninguém cruzar ─────────
 *
 * O schema do TaskPlan diz, no próprio campo: "args_summary — resumo humano.
 * Os args reais são construídos pelo compiler, nunca pelo LLM."
 *
 * É a fronteira inteira em uma frase. O modelo propõe *o que* fazer, em texto
 * que um humano lê. O *como* — o id do conteúdo, o canal, a conexão — é
 * montado por código determinístico a partir de entidades resolvidas e do
 * contexto confiável. Um LLM que escolhe argumentos de uma chamada externa é
 * um LLM que possui autorização, e o MKT-SPEC-STANDARD §8 proíbe isso.
 *
 * Por isso o compiler recusa capability sem builder registrado, em vez de
 * repassar o que o modelo escreveu. Recusar é o comportamento seguro; repassar
 * seria o inseguro disfarçado de flexível.
 *
 * ── Ordem dos checks ───────────────────────────────────────────────────────
 *
 * A Mestra §15.1 fixa a ordem: schema e IDs canônicos, status de governança,
 * permissão e tenant, compatibilidade semântica, saúde da fonte, quality
 * gates, ambiguidade material, policy e materialidade, aprovação. A ordem
 * importa: checar policy antes de tenant deixaria a policy decidir sobre um
 * escopo que ainda não foi provado.
 */
import { createHash } from "node:crypto";
import { assertValid, validate, autonomyRank } from "@olga/contracts";
import { buildIdempotencyKey } from "@olga/gateway";
import { evaluate } from "@olga/policy";
import { personaVersionOf } from "./agent-deltas.mjs";
import { PROMPTS_VERSION } from "./prompts.mjs";

export class LoopError extends Error {
  constructor(reason_code, state, message, extra = {}) {
    super(message ?? reason_code);
    this.reason_code = reason_code;
    this.respondability = state;
    Object.assign(this, extra);
  }
}

/** Ambiguidade que não é material não para o loop; a que é, para. */
const AMBIGUIDADE_MATERIAL = new Set([
  "AMBIGUOUS_GOAL", "AMBIGUOUS_ENTITY", "AMBIGUOUS_AUDIENCE",
]);

/**
 * Tipos que são valor, e não referência — `canonical_id` nulo neles é normal.
 *
 * Duplica de propósito a lista de `entity-resolver.mjs`: esta checagem existe
 * justamente para o caso em que aquele arquivo NÃO está montado, e importar
 * dele faria a rede de segurança depender do que ela protege.
 */
const TIPOS_SEM_ID = new Set(["objective", "audience", "tone", "format"]);

/**
 * Em que estado o loop para quando um compilador se recusa a montar args.
 *
 * O arquivo dos compiladores sempre disse que "entidade faltando é pergunta,
 * não improviso — o loop transforma isso em CLARIFICATION_REQUIRED e pergunta".
 * A transformação não existia: a recusa subia até o catch de `run`, o run era
 * marcado FAILED e a exceção saía do loop. Quem pedisse "monta a marca a partir
 * do nosso site" para uma marca sem site cadastrado recebia um erro, e não a
 * frase que o compilador escreveu justamente para ser lida por uma pessoa.
 *
 * O corte é entre recusa NOMEADA e defeito. Erro sem `reason_code` continua
 * subindo: um TypeError num builder é bug nosso, e bug tem de ser barulhento.
 */
const ESTADO_DE_COMPILACAO = {
  AMBIGUOUS_GOAL: "CLARIFICATION_REQUIRED",
  AMBIGUOUS_ENTITY: "CLARIFICATION_REQUIRED",
  AMBIGUOUS_AUDIENCE: "CLARIFICATION_REQUIRED",
  // "não achei" também é pergunta: quem recebe confere o nome e responde.
  NORMALIZATION_FAILED: "CLARIFICATION_REQUIRED",
  // Falta lastro, e perguntar não resolve — quem responderia não tem a fonte.
  EVIDENCE_INSUFFICIENT: "QUALITY_BLOCKED",
  CLAIM_UNSUPPORTED: "QUALITY_BLOCKED",
  // "isso é ação sua, no painel" e "falta destino": o agente não faz, e a
  // mensagem do compilador é que diz o que a pessoa precisa fazer.
  CONSENT_MISSING: "UNSUPPORTED",
  CHANNEL_NOT_CONNECTED: "UNSUPPORTED",
};

/**
 * Compiler: transforma um passo aprovado do plano em args reais.
 *
 * `builders` é um mapa capability_id -> função determinística. Nenhum builder
 * recebe texto do modelo: recebe as entidades já resolvidas para ID canônico e
 * o contexto confiável da sessão.
 */
export function createCompiler(builders = {}) {
  return {
    /** @returns {{ capability_id: string, mode: string, args: object }} */
    async compile(step, { entities, context, tenant, agent }) {
      const builder = builders[step.capability_id];
      if (!builder) {
        // Sem builder não há compilação possível. A alternativa seria aceitar
        // os args que o modelo escreveu — que é exatamente o que não pode.
        throw new LoopError("SCHEMA_VALIDATION_FAILED", "UNSUPPORTED",
          `sem compilador para ${step.capability_id}: os args teriam de vir do modelo`);
      }
      const args = await builder({ entities, context, tenant, agent, step });
      if (args == null || typeof args !== "object") {
        throw new LoopError("SCHEMA_VALIDATION_FAILED", "UNSUPPORTED",
          `compilador de ${step.capability_id} nao devolveu args`);
      }
      return { capability_id: step.capability_id, mode: step.mode, args };
    },
    has: (capability_id) => typeof builders[capability_id] === "function",
  };
}

/**
 * Validator: cinco checagens fixadas pelo contrato ValidatedResult.
 * Nunca converte erro em sucesso (MKT-09B §5).
 */
export function validateResult({ trace_id, execution, tenant, freshness_ok = true }) {
  const checks = [];
  const reason_codes = [];
  const add = (check, passed, detail) => checks.push(detail ? { check, passed, detail } : { check, passed });

  // 1. O resultado bate com o contrato de saída do executor?
  const { valid: schemaOk } = validate("olga://io/execution-result", execution);
  add("schema", schemaOk, schemaOk ? undefined : "execution-result fora do contrato");
  if (!schemaOk) reason_codes.push("SCHEMA_VALIDATION_FAILED");

  // 2. Falha continua sendo falha. Este é o check que impede o pior bug
  //    possível desta camada: um erro do provider virar resposta bonita.
  const falhou = execution.status === "FAILED" || execution.status === "BLOCKED";
  add("failure_normalized", !falhou,
    falhou ? `execucao terminou ${execution.status}` : undefined);
  if (falhou && execution.error?.reason_code) reason_codes.push(execution.error.reason_code);

  // 3. Efeito externo sem id do provider não é efeito comprovado.
  const precisaId = execution.status === "SUCCEEDED" && execution.provider != null;
  const temId = execution.external_id != null && execution.external_id !== "";
  add("cardinality", !precisaId || temId,
    precisaId && !temId ? "provider respondeu sem external_id" : undefined);
  if (precisaId && !temId) reason_codes.push("PROVIDER_UNAVAILABLE");

  // 4. O escopo que saiu é o mesmo que entrou.
  const escopoOk = tenant?.org_id != null && tenant?.workspace_id != null;
  add("tenant_scope", escopoOk, escopoOk ? undefined : "tenant ausente no resultado");
  if (!escopoOk) reason_codes.push("TENANT_SCOPE_VIOLATION");

  add("freshness", freshness_ok, freshness_ok ? undefined : "contexto usado esta vencido");
  if (!freshness_ok) reason_codes.push("SOURCE_STALE");

  const result = {
    trace_id,
    valid: checks.every((c) => c.passed),
    checks,
    reason_codes: [...new Set(reason_codes)],
  };
  assertValid("olga://io/validated-result", result);
  return result;
}

/**
 * Evidence: monta o pacote de provenance.
 * Item sem origem não entra — evidence sem origem é proibida (MKT-09B §5).
 */
export function buildEvidence({ trace_id, items = [] }) {
  const completos = items.filter(
    (i) => i.evidence_id && i.source_kind && i.locator && i.hash);
  const pkg = { trace_id, items: completos };
  assertValid("olga://io/evidence-package", pkg);
  return {
    pkg,
    descartados: items.length - completos.length,
  };
}

/**
 * A pergunta que se faz quando uma referência não resolveu.
 *
 * Cada código pede uma coisa diferente de quem lê, e por isso não há uma frase
 * só: ambíguo é "achei várias, qual delas?", e quem recebe escolhe;
 * normalização falha é "não achei nenhuma", e quem recebe confere o nome.
 * Trocar uma pela outra manda a pessoa fazer a coisa errada.
 */
function perguntaSobre(unresolved) {
  const nomes = (rc) => unresolved.filter((u) => u.reason_code === rc)
    .map((u) => u.raw ?? u.entity_type).join(", ");
  const frases = {
    AMBIGUOUS_ENTITY: (n) => `Há mais de um registro com esse nome: ${n}. Qual deles?`,
    NORMALIZATION_FAILED: (n) => `Não encontrei: ${n}.`,
    UNSUPPORTED_VALUE: (n) => `Ainda não sei tratar: ${n}.`,
  };
  const codigos = [...new Set(unresolved.map((u) => u.reason_code))];
  return codigos.map((rc) => (frases[rc] ?? ((n) => `Não consegui usar: ${n}.`))(nomes(rc)))
    .join(" ");
}

/**
 * @param {{ resolver: any, planner: any, responder: any, retrieval?: any,
 *           entityResolver?: any, compiler: any, gateway: any, registry: any,
 *           policies: any, runs?: any, tracer?: any, ids: any, clock?: any }} deps
 *
 * `entityResolver` é opcional na assinatura e obrigatório na prática: sem ele
 * o loop volta a confiar no `canonical_id` que o modelo escreveu, e é isso que
 * o aviso no boot cobra. Opcional aqui só para os testes que não tocam
 * entidade não precisarem montar um banco.
 */
export function createAgentLoop({
  resolver, planner, responder, retrieval, entityResolver,
  compiler, gateway, registry, policies,
  runs, tracer, ids, clock,
}) {
  const now = () => clock?.now?.() ?? Date.now();
  const nowIso = () => new Date(now()).toISOString();

  async function run(req) {
    const trace_id = req.trace_id ?? ids.newTraceId();
    const started_at = now();
    const emitir = (event, extra = {}) => tracer?.event?.({ trace_id, event, ...extra });

    // ── 0. Tenant e ator: do contexto confiável, nunca do input ────────────
    const { tenant, actor } = req;
    if (!tenant?.org_id || !tenant?.workspace_id) {
      throw new LoopError("TENANT_SCOPE_VIOLATION", "UNSUPPORTED", "tenant ausente");
    }
    if (!actor?.role) throw new LoopError("ACTOR_ROLE_FORBIDDEN", "UNSUPPORTED", "ator sem papel");
    if (req.input?.org_id || req.input?.workspace_id) {
      // Tentativa de injetar tenant pelo corpo é violação, não correção.
      throw new LoopError("TENANT_SCOPE_VIOLATION", "UNSUPPORTED",
        "tenant no input do usuario");
    }
    if (!(await registry.workspaceBelongsToOrg(tenant.workspace_id, tenant.org_id))) {
      throw new LoopError("TENANT_SCOPE_VIOLATION", "UNSUPPORTED",
        "workspace nao pertence a organizacao");
    }

    // ── 0b. Agente e teto de autonomia ─────────────────────────────────────
    const agent = await registry.getAgent(req.agent_id);
    if (!agent) throw new LoopError("AGENT_NOT_ACTIVE", "UNSUPPORTED", `agente desconhecido: ${req.agent_id}`);
    if (agent.status !== "ACTIVE" && !(agent.status === "CANDIDATE" && req.internal === true)) {
      throw new LoopError("AGENT_NOT_ACTIVE", "UNSUPPORTED",
        `agente ${agent.agent_id} esta ${agent.status}; CANDIDATE so roda em modo interno`);
    }
    const teto = agent.status === "ACTIVE"
      ? (agent.max_autonomy ?? agent.baseline_autonomy)
      : agent.baseline_autonomy;
    const autonomy_ceiling =
      req.requested_autonomy && autonomyRank(req.requested_autonomy) < autonomyRank(teto)
        ? req.requested_autonomy : teto;

    const run_id = ids.newId();
    await runs?.start?.({
      id: run_id, org_id: tenant.org_id, workspace_id: tenant.workspace_id, trace_id,
      agent_id: agent.agent_id, agent_version: agent.version,
      task_class: agent.model_profile?.task_class ?? null,
      // As versoes que valeram NESTE run. A Mestra §30 pede as duas na linha
      // "Versions" do trace, e sem elas nao se reproduz um incidente: "o agente
      // respondeu isso em setembro" fica sem resposta se ninguem sabe com que
      // persona e que prompts ele respondia em setembro.
      persona_version: personaVersionOf(agent),
      prompt_version: String(PROMPTS_VERSION),
      status: "RUNNING", started_at: nowIso(),
    });

    const evidencias = [];
    const receipt_ids = [];

    try {
      // ── encerramento comum a toda parada antes do fim ───────────────────
      async function encerrar(state, reason_codes, message) {
        const { pkg: parcial } = buildEvidence({ trace_id, items: evidencias });
        const resp = {
          trace_id, respondability: state,
          message,
          next_step: proximoPasso(state),
          autonomy_mode: modeFor(autonomy_ceiling),
          reason_codes: [...new Set(reason_codes)].filter(Boolean),
          evidence_ids: parcial.items.map((i) => i.evidence_id),
          receipt_ids,
        };
        assertValid("olga://io/final-response", resp);
        await runs?.finish?.(run_id, {
          status: state === "POLICY_BLOCKED" || state === "APPROVAL_REQUIRED" ? "BLOCKED" : "FAILED",
          respondability: state, reason_codes: resp.reason_codes,
          autonomy_used: autonomy_ceiling, latency_ms: now() - started_at, finished_at: nowIso(),
        });
        emitir("loop.stopped", { state, reason_codes: resp.reason_codes });
        return { run_id, trace_id, response: resp, evidence: parcial };
      }

      // ── 1. RESOLVER ──────────────────────────────────────────────────────
      const intent = await resolver.resolve({ trace_id, tenant, input: req.input, agent, agent_run_id: run_id });
      assertValid("olga://io/intent-resolution", intent);
      emitir("loop.resolved", { intent: intent.intent, confidence: intent.confidence_band });

      if (intent.intent === "UNKNOWN") {
        return encerrar("CLARIFICATION_REQUIRED", ["AMBIGUOUS_GOAL"],
          "Não entendi o que você quer fazer.");
      }

      // Ambiguidade material para o loop antes de qualquer decisão. Adivinhar
      // aqui seria decidir sobre algo que ninguém afirmou.
      const materiais = (intent.ambiguities ?? [])
        .filter((a) => AMBIGUIDADE_MATERIAL.has(a.reason_code));
      if (materiais.length > 0) {
        return encerrar("CLARIFICATION_REQUIRED", materiais.map((a) => a.reason_code),
          "Preciso de uma informação a mais antes de seguir.");
      }

      // ── 1b. ENTITY RESOLUTION ────────────────────────────────────────────
      //
      // O passo que a Mestra §13 exige ("Entity Resolution usa
      // registry/aliases/IDs e não fuzzy matching irrestrito") e que não
      // existia. Até aqui `canonical_id` era o que o modelo tinha escrito, e o
      // loop conferia apenas se ele era não-nulo — o que aprova um uuid
      // inventado com a mesma facilidade que um correto.
      //
      // Daqui para baixo, `entidades` (verificadas contra o tenant) substitui
      // `intent.entities` (a palavra do modelo). Essa troca é o ponto do
      // passo: se o compilador continuasse lendo `intent.entities`, tudo isto
      // seria auditoria sem consequência.
      let entidadesVerificadas = intent.entities ?? [];
      if (entityResolver) {
        const er = await entityResolver.resolve({ trace_id, tenant, intent });
        assertValid("olga://io/entity-resolution", er.resolution);
        emitir("loop.entities", {
          resolved: er.resolution.resolved.map(
            (r) => ({ t: r.entity_type, m: r.method, c: r.confidence_band })),
          unresolved: er.resolution.unresolved ?? [],
          // O palpite do modelo apontava para outro id. Não muda a decisão —
          // o cadastro decide —, e é o sinal que diz que o resolver está se
          // perdendo antes de alguém perceber pelo suporte.
          ...(er.divergencias?.length ? { divergencias: er.divergencias } : {}),
        });
        if (!er.ok) {
          const codigos = [...new Set(er.resolution.unresolved.map((u) => u.reason_code))];
          // Perguntar só faz sentido quando a resposta da pessoa resolve. "Achei
          // duas marcas com esse nome" ela responde; "não sei tratar referência
          // do tipo `connection`" ela não — isso é limite do sistema, e vestir
          // de pergunta faria alguém tentar reescrever o pedido para sempre.
          const estado = codigos.includes("UNSUPPORTED_VALUE")
            ? "UNSUPPORTED" : "CLARIFICATION_REQUIRED";
          return encerrar(estado, codigos, perguntaSobre(er.resolution.unresolved));
        }
        entidadesVerificadas = er.entities;
      }

      // Sem o passo montado, a checagem antiga é o que resta: `canonical_id`
      // nulo não vira palpite. Ela é fraca de propósito — quem confia nela
      // está confiando no modelo, e o boot avisa isso.
      const semId = entidadesVerificadas.filter(
        (e) => e.canonical_id == null && !TIPOS_SEM_ID.has(e.type));
      if (semId.length > 0) {
        return encerrar("CLARIFICATION_REQUIRED", ["NORMALIZATION_FAILED"],
          `Não encontrei: ${semId.map((e) => e.raw ?? e.type).join(", ")}.`);
      }

      // ── 2. RETRIEVAL ─────────────────────────────────────────────────────
      // Contexto vindo de tool ou documento é dado NÃO confiável até passar
      // por contrato e policy (Mestra §13). Por isso ele entra em `context`,
      // separado de `tenant`, e nunca vira argumento sem passar pelo compiler.
      const recuperado = retrieval
        ? await retrieval.fetch({ trace_id, tenant, intent })
        : { slices: [], versions: [], stale: false };
      emitir("loop.retrieved", { slices: recuperado.slices?.length ?? 0, stale: !!recuperado.stale });

      for (const s of recuperado.slices ?? []) {
        if (s.evidence) evidencias.push(s.evidence);
      }

      // ── 3. PLANNER ───────────────────────────────────────────────────────
      const plan = await planner.plan({ trace_id, tenant, intent, agent, context: recuperado,
                                        agent_run_id: run_id });
      assertValid("olga://io/task-plan", plan);
      emitir("loop.planned", { steps: plan.steps.length });

      // O plano não pode inventar capability fora do charter do agente.
      const permitidas = new Set(agent.capabilities ?? []);
      const fora = plan.steps.filter((s) => !permitidas.has(s.capability_id));
      if (fora.length > 0) {
        return encerrar("UNSUPPORTED", ["UNSUPPORTED_VALUE"],
          `Este agente não faz: ${fora.map((s) => s.capability_id).join(", ")}.`);
      }

      // Nem capability que ninguém sabe compilar.
      const semCompilador = plan.steps.filter((s) => !compiler.has(s.capability_id));
      if (semCompilador.length > 0) {
        return encerrar("UNSUPPORTED", ["UNSUPPORTED_VALUE"],
          `Ainda não sei executar: ${semCompilador.map((s) => s.capability_id).join(", ")}.`);
      }

      // ── 4 a 8. Um passo por vez ──────────────────────────────────────────
      const politicas = await policies.listActive(tenant.org_id);
      let ultimaExecucao = null;
      let ultimaRespondability = null;

      // O que cada passo produziu, por capability_id.
      //
      // Existe porque o primeiro plano de verdade com dois passos — extrair a
      // marca do site e propor a versão — precisa que o segundo veja o que o
      // primeiro leu. Até aqui todo passo era compilado contra o mesmo
      // `recuperado`, e um plano encadeado era impossível de executar: o
      // compilador de brand.propose_version pedia uma proposta que nada
      // colocava no contexto.
      //
      // Isto NÃO afrouxa a fronteira do compilador. O que entra aqui já passou
      // pelo `output_schema_ref` que a capability declara — é dado sob
      // contrato, não texto do modelo — e mesmo assim entra em `context`, que é
      // a sacola do não confiável, e não em args. Quem decide o que aproveitar
      // continua sendo código determinístico, um builder por capability.
      const produzido = {};

      for (const step of plan.steps) {
        const cap = await registry.getCapability(step.capability_id, 1);
        if (!cap) return encerrar("UNSUPPORTED", ["CAPABILITY_NOT_ACTIVE"],
          `Capability desconhecida: ${step.capability_id}.`);

        // ── 4. RESPONDABILITY ──────────────────────────────────────────────
        const respondability = evaluate({
          trace_id,
          context: {
            capability_id: cap.capability_id, capability_mode: cap.mode,
            agent_id: agent.agent_id, risk_tier: cap.risk_tier,
            channel: req.facts?.channel ?? null,
          },
          facts: req.facts ?? {},
          requested_autonomy: autonomy_ceiling,
          policies: politicas,
        });
        ultimaRespondability = respondability;
        emitir("loop.respondability", { step: step.step_id, state: respondability.state });

        if (respondability.state === "POLICY_BLOCKED") {
          return encerrar("POLICY_BLOCKED", respondability.reason_codes,
            "Esta ação está bloqueada pela política do workspace.");
        }
        if (respondability.state === "APPROVAL_REQUIRED" && !req.approval_id) {
          return encerrar("APPROVAL_REQUIRED", respondability.reason_codes,
            "Esta ação precisa de aprovação humana antes de acontecer.");
        }

        // Modo somente-leitura do pedido não executa escrita, mesmo autorizado.
        if (req.dry_run === true) {
          emitir("loop.dry_run", { step: step.step_id });
          continue;
        }

        // ── 5. COMPILER — os args nascem aqui, não no modelo ───────────────
        // `await`: um builder real precisa consultar o banco. A conexão e a
        // variante de canal não vêm do modelo — são resolvidas a partir do
        // conteúdo e do canal, que é justamente o que os tira do alcance dele.
        // `agent` entra no contexto de compilacao porque o registry declara
        // agent_id na policy e mkt.content_versions guarda quem escreveu. Sem
        // isso, `request.args.agent_id` que o gateway le no passo 3 era sempre
        // nulo, e toda policy com escopo por agente nunca casava.
        let compilado;
        try {
          compilado = await compiler.compile(step, {
            entities: entidadesVerificadas,
            context: { ...recuperado, produced: produzido },
            tenant, agent,
          });
        } catch (e) {
          // LoopError já é decisão deste arquivo ("sem compilador"), e sobe.
          // Erro sem reason_code é defeito, e também sobe: ver ESTADO_DE_COMPILACAO.
          if (e instanceof LoopError || !e?.reason_code) throw e;
          const estado = ESTADO_DE_COMPILACAO[e.reason_code] ?? "UNSUPPORTED";
          emitir("loop.compilacao_recusou", { step: step.step_id, reason_code: e.reason_code });
          // A mensagem é a do compilador de propósito: ela foi escrita para uma
          // pessoa ler, e é mais útil que qualquer frase genérica daqui.
          return encerrar(estado, [e.reason_code], e.message);
        }

        // ── 6. EXECUTOR ────────────────────────────────────────────────────
        const request = {
          trace_id, tenant,
          capability_id: compilado.capability_id, capability_version: cap.version ?? 1,
          mode: compilado.mode, args: compilado.args,
          requested_autonomy: autonomy_ceiling,
          approval_id: req.approval_id ?? null,
          idempotency_key: req.idempotency_key
            ?? chaveDeIdempotencia(cap, tenant, compilado, step),
        };
        const saida = await gateway.execute(request, { facts: req.facts ?? {}, actor });
        ultimaExecucao = saida.execution;
        if (saida.receipt?.receipt_id) receipt_ids.push(saida.receipt.receipt_id);
        emitir("loop.executed", { step: step.step_id, status: saida.execution.status });

        // ── 7. VALIDATOR ───────────────────────────────────────────────────
        const validado = validateResult({
          trace_id, execution: saida.execution, tenant,
          freshness_ok: !recuperado.stale,
        });
        if (!validado.valid) {
          // Nunca converte erro em sucesso.
          const estado = saida.execution.status === "BLOCKED" ? "POLICY_BLOCKED"
                       : "TEMPORARILY_UNAVAILABLE";
          return encerrar(estado, validado.reason_codes,
            "Não consegui concluir esta ação agora.");
        }

        // ── 7b. O que uma conferencia achou ────────────────────────────────
        //
        // quality.precheck, quality.ai_review e compliance.review produzem
        // laudo. O gateway devolve esse laudo em `output`, ja validado contra
        // olga://io/validated-result — e o loop ja o descartou uma vez.
        //
        // Descartar era pior que ignorar: o agente rodava a conferencia, ela
        // dizia "claim material sem evidence", e a resposta saia como se
        // estivesse tudo certo. Conferir e nao contar e o unico resultado pior
        // que nao conferir.
        //
        // O gatilho e o LAUDO, e nao o `mode` da capability. Era `mode ===
        // "simulate"` enquanto so capability de simulacao produzia laudo;
        // quality.ai_review e write e produz um, e um laudo que reprova nao
        // vira menos verdadeiro por quem o emitiu ter permissao de escrever.
        // Ela nao transiciona quando reprova — mas se o loop nao parasse aqui,
        // o passo seguinte pediria aprovacao de um conteudo que a conferencia
        // acabou de recusar.
        //
        // Laudo negativo PARA o loop. Nao por policy — policy avalia fatos,
        // nao texto — mas porque seguir para uma escrita depois de a propria
        // conferencia reprovar seria decidir contra o que se acabou de apurar.
        if (saida.output?.valid === false) {
          const achados = saida.output.reason_codes ?? [];
          emitir("loop.simulacao_reprovou", { step: step.step_id, reason_codes: achados });
          return encerrar("QUALITY_BLOCKED", achados,
            "Conferi antes de seguir e encontrei um problema que precisa ser resolvido.");
        }

        // ── 7c. O que este passo produziu fica ao alcance do próximo ───────
        if (saida.output != null) produzido[cap.capability_id] = saida.output;

        // ── 8. EVIDENCE — o efeito externo é sua própria evidência ─────────
        if (saida.receipt) {
          evidencias.push({
            evidence_id: saida.receipt.receipt_id,
            source_kind: "PROVIDER_RESPONSE",
            locator: `${saida.receipt.provider ?? "provider"}://${saida.receipt.external_id ?? ""}`,
            hash: saida.receipt.request_hash ?? saida.receipt.idempotency_key,
            retrieved_at: saida.receipt.recorded_at,
          });
        }

        // Efeito externo é a própria evidência; leitura de fonte é a dela.
        //
        // Receipt só existe para side_effect external (é o gateway que decide
        // isso, no passo 8 dele). Uma capability interna que LÊ uma fonte — a
        // página do cliente, hoje — não emite receipt nenhum, e sem isto a
        // resposta de um onboarding não se apoiaria em nada: o pacote de
        // evidence sairia vazio de um run cujo trabalho inteiro foi ler algo.
        for (const ref of saida.output?.source_refs ?? []) {
          if (!ref?.locator || !ref?.hash) continue;
          evidencias.push({
            // O hash do que foi lido, e não um id novo a cada run: ler duas
            // vezes a mesma página inalterada é a mesma evidência.
            evidence_id: String(ref.hash),
            source_kind: "SOURCE_ARTIFACT",
            locator: String(ref.locator),
            hash: String(ref.hash),
            retrieved_at: ref.retrieved_at,
          });
        }
      }

      // ── 9. RESPONDER ─────────────────────────────────────────────────────
      const { pkg, descartados } = buildEvidence({ trace_id, items: evidencias });
      if (descartados > 0) emitir("loop.evidence_discarded", { descartados });

      const resposta = await responder.respond({
        trace_id, tenant, agent, intent, agent_run_id: run_id,
        evidence: pkg,
        execution: ultimaExecucao,
        respondability: ultimaRespondability,
      });

      const final = {
        trace_id,
        // Chegar aqui significa que nenhum gate parou o loop.
        respondability: "EXECUTABLE",
        message: resposta.message,
        next_step: resposta.next_step,
        autonomy_mode: modeFor(ultimaRespondability?.granted_autonomy ?? autonomy_ceiling),
        reason_codes: ultimaRespondability?.reason_codes ?? [],
        evidence_ids: pkg.items.map((i) => i.evidence_id),
        receipt_ids,
      };

      // Grounding: o responder não pode citar evidência que não existe no
      // pacote. Se citar, a resposta não está aterrada e não sai.
      const conhecidos = new Set(pkg.items.map((i) => i.evidence_id));
      const inventados = (resposta.evidence_ids ?? []).filter((id) => !conhecidos.has(id));
      if (inventados.length > 0) {
        return encerrar("QUALITY_BLOCKED", ["EVIDENCE_INSUFFICIENT"],
          "Não consigo sustentar esta resposta com evidência.");
      }

      assertValid("olga://io/final-response", final);
      await runs?.finish?.(run_id, {
        status: "SUCCEEDED", respondability: final.respondability,
        reason_codes: final.reason_codes, autonomy_used: autonomy_ceiling,
        latency_ms: now() - started_at, finished_at: nowIso(),
      });
      emitir("loop.completed", { state: final.respondability, steps: plan.steps.length });
      return { run_id, trace_id, response: final, plan, intent, evidence: pkg };

    } catch (e) {
      const reason = e.reason_code ?? "PROVIDER_UNAVAILABLE";
      await runs?.finish?.(run_id, {
        status: "FAILED", respondability: e.respondability ?? "TEMPORARILY_UNAVAILABLE",
        reason_codes: [reason], latency_ms: now() - started_at, finished_at: nowIso(),
      });
      emitir("loop.failed", { reason_code: reason });
      throw e;
    }
  }

  return { run };
}

const modeFor = (a) =>
  ({ A0: "SUGGEST", A1: "SUGGEST", A2: "DRAFT", A3: "GOVERNED_EXECUTE", A4: "AUTOPILOT" }[a] ?? "SUGGEST");

const proximoPasso = (state) => ({
  CLARIFICATION_REQUIRED: "Responda a pergunta acima para eu continuar.",
  UNSUPPORTED: "Escolha uma ação que este agente saiba executar.",
  POLICY_BLOCKED: "Fale com quem administra o workspace para revisar a política.",
  QUALITY_BLOCKED: "Revise o conteúdo e as fontes antes de tentar de novo.",
  APPROVAL_REQUIRED: "Peça a aprovação e tente de novo depois dela.",
  TEMPORARILY_UNAVAILABLE: "Tente de novo em alguns minutos.",
  HANDOFF_HUMAN: "Alguém do time vai assumir daqui.",
}[state] ?? "Revise o resultado.");

/**
 * Chave de idempotência de um passo.
 *
 * O contrato exige que ela exista sempre e diz, no próprio schema: "nunca
 * derivada apenas de texto livre do LLM". Duas formas, nesta ordem:
 *
 * 1. O template declarado no registry, quando a capability tem um. É a forma
 *    preferida porque a chave passa a ser a mesma que o workflow durável
 *    construiria para o mesmo efeito — e é isso que faz um post agendado pela
 *    tela e o mesmo post pedido ao agente deduplicarem entre si.
 *
 * 2. Um hash dos args compilados, quando não há template. Seguro justamente
 *    porque os args NÃO são texto do modelo: saíram do compiler, feitos de ids
 *    canônicos e do tenant confiável. Hashear o `args_summary` do plano, que é
 *    prosa do LLM, daria uma chave nova a cada frase reescrita — e duas frases
 *    diferentes para o mesmo efeito viram dois efeitos.
 */
function chaveDeIdempotencia(cap, tenant, compilado, step) {
  const template = cap?.idempotency?.key_template;
  if (template) {
    try {
      return buildIdempotencyKey(template, { ...tenant, ...compilado.args });
    } catch {
      // Template com campo que os args não têm: cai no hash, que sempre serve.
    }
  }
  const material = JSON.stringify({
    org: tenant.org_id, ws: tenant.workspace_id,
    cap: compilado.capability_id, step: step.step_id,
    args: ordenar(compilado.args),
  });
  return `k_${createHash("sha256").update(material).digest("hex").slice(0, 40)}`;
}

/** Chaves em ordem: a mesma intenção não pode gerar hashes diferentes. */
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === "object") {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = ordenar(v[k]); return acc; }, {});
  }
  return v;
}
