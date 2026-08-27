/**
 * Implementacao das portas contra Postgres. O runtime nao conhece SQL;
 * conhece estas interfaces. Trocar Supabase por outro banco mexe aqui
 * e em nenhum outro lugar.
 *
 * O schema e injetavel para o codigo servir tanto `mkt` quanto `mkt_v2`.
 */
import { canTransition } from "@olga/contracts";

const json = (v) => (v == null ? null : JSON.stringify(v));

/** Um id que nao e uuid nunca vira `where id = $1`: erro de tipo do Postgres
 *  sobe como 500, e a resposta certa para um uuid inventado e "nao achei". */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPostgresPorts(pool, { schema = process.env.MKT_SCHEMA || "mkt" } = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`schema invalido: ${schema}`);
  const S = schema;

  const routing = {
    async getRoute(task_class) {
      const { rows } = await pool.query(
        `select task_class, version, status::text, primary_target, fallback,
                max_cost_cents, timeout_ms
           from ${S}.model_routing
          where task_class = $1::${S}.task_class and status = 'ACTIVE'
          limit 1`, [task_class]);
      if (!rows[0]) return null;
      const r = rows[0];
      return {
        task_class: r.task_class, version: r.version, status: r.status,
        primary: r.primary_target, fallback: r.fallback ?? [],
        max_cost_cents: r.max_cost_cents == null ? null : Number(r.max_cost_cents),
        timeout_ms: r.timeout_ms,
      };
    },
  };

  const budget = {
    async remainingCents(workspace_id) {
      const { rows } = await pool.query(
        `select ${S}.remaining_budget_cents($1) as saldo`, [workspace_id]);
      const v = rows[0]?.saldo;
      return v == null ? null : Number(v);   // null = sem orcamento, != zero
    },
    async record({ workspace_id, org_id, cost_cents, trace_id, task_class, provider, model,
                   input_tokens, output_tokens, fallback_used, agent_run_id }) {
      if (cost_cents == null) return;
      await pool.query(
        `insert into ${S}.model_spend
           (org_id, workspace_id, task_class, provider, model, cost_cents,
            input_tokens, output_tokens, fallback_used, trace_id, agent_run_id)
         values ($1,$2,$3::${S}.task_class,$4,$5,$6,$7,$8,coalesce($9,false),$10,$11)`,
        [org_id, workspace_id, task_class, provider ?? null, model ?? null, cost_cents,
         input_tokens ?? null, output_tokens ?? null, fallback_used ?? false, trace_id, agent_run_id ?? null]);
    },
  };

  const registry = {
    /**
     * A linha do agente, com a persona ACTIVE dele anexada.
     *
     * Dois defeitos silenciosos moravam aqui:
     *
     * `reason_codes` e `deviates_from_base` NAO eram selecionados. O renderizador
     * de persona os projeta no prompt desde que existe — "use um destes motivos"
     * e "regras especificas suas" — e recebia sempre `undefined`, entao os dois
     * blocos simplesmente nao apareciam. As colunas estavam preenchidas no banco
     * e o agente nunca as viu.
     *
     * E a persona nao existia como dado. Hoje vem junto, num LEFT JOIN: agente
     * sem persona ACTIVE nao deixa de responder — cai na postura conservadora do
     * PERSONA_PADRAO — e `persona_version` volta nulo, que e o que faz o trace
     * dizer a verdade em vez de registrar uma versao inexistente.
     *
     * ── A ordenacao, que e a terceira correcao ──────────────────────────
     *
     * Era `order by version desc` puro: a MAIOR versao, qualquer que fosse o
     * status. Isso quebrava o rollback que o AGT-BASE §05 descreve — voltar
     * para a ultima ACTIVE — porque uma v2 DEPRECATED continuaria sendo servida
     * sobre a v1 ACTIVE, e marcar a v2 como DEPRECATED nao desfazia nada.
     *
     * A maior versao continua sendo o desempate, e e ela que faz um agente
     * CANDIDATE — que nao tem linha ACTIVE nenhuma — rodar em modo interno.
     */
    async getAgent(agent_id) {
      const { rows } = await pool.query(
        `select a.agent_id, a.version, a.status::text, a.mission,
                a.baseline_autonomy, a.max_autonomy, a.capabilities,
                a.reason_codes, a.deviates_from_base, a.model_profile,
                p.version as persona_version, p.identity, p.tone, p.depth,
                p.uncertainty, p.costliest_error, p.limits, p.compliance, p.examples
           from ${S}.agent_registry a
           left join ${S}.agent_personas p
             on p.agent_id = a.agent_id and p.status = 'ACTIVE'
          where a.agent_id = $1
          order by (a.status = 'ACTIVE') desc, a.version desc
          limit 1`, [agent_id]);

      const r = rows[0];
      if (!r) return null;

      const { persona_version, identity, tone, depth, uncertainty, costliest_error,
              limits, compliance, examples, ...agente } = r;
      return {
        ...agente,
        persona: persona_version == null ? null : {
          persona_version, identity, tone, depth, uncertainty, costliest_error,
          limits, compliance, examples,
        },
      };
    },
    async getCapability(capability_id, version) {
      const { rows } = await pool.query(
        `select capability_id, version, status::text, mode::text, side_effect::text,
                risk_tier::text, permissions, idempotency_required,
                idempotency_key_template, provider_adapter, timeout_ms, max_attempts,
                output_schema_ref
           from ${S}.capability_registry
          where capability_id = $1 and version = $2`, [capability_id, version]);
      const c = rows[0];
      if (!c) return null;
      return {
        ...c,
        idempotency: { required: c.idempotency_required, key_template: c.idempotency_key_template },
      };
    },
    async workspaceBelongsToOrg(workspace_id, org_id) {
      const { rows } = await pool.query(
        `select 1 from ${S}.workspaces where id = $1 and org_id = $2`, [workspace_id, org_id]);
      return rows.length === 1;
    },
    newId: () => crypto.randomUUID(),
  };

  const runs = {
    async start(r) {
      await pool.query(
        `insert into ${S}.agent_runs
           (id, org_id, workspace_id, trace_id, agent_id, agent_version, task_class,
            persona_version, prompt_version, status, started_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::${S}.run_status,$11)`,
        [r.id, r.org_id, r.workspace_id, r.trace_id, r.agent_id, r.agent_version,
         r.task_class, r.persona_version ?? null, r.prompt_version ?? null,
         r.status, r.started_at]);
    },
    /**
     * Fecha o run — e a linha "Performance" do trace sai do LEDGER, nao de uma
     * contagem paralela.
     *
     * A Mestra §30 pede modelo, tokens e custo no trace. As colunas existiam
     * desde a 0005 e ninguem as escrevia: o loop nao via as chamadas de modelo
     * (elas acontecem dentro das pontas) e teria de somar por fora, criando uma
     * segunda contabilidade que um dia discordaria da primeira.
     *
     * Entao o UPDATE agrega mkt.model_spend pelo proprio agent_run_id. Uma
     * transacao, uma fonte: o ledger continua sendo quem responde sobre
     * dinheiro, e a linha do run passa a carregar o total dele para o trace ser
     * auto-suficiente.
     *
     * `string_agg(distinct model)` porque um run pode usar rotas diferentes —
     * o resolver e extraction, o responder e copywriting. Esconder isso atras
     * de um modelo so faria o trace mentir sobre o que respondeu.
     */
    async finish(id, p) {
      await pool.query(
        `update ${S}.agent_runs a set
           status = coalesce($2::${S}.run_status, status),
           respondability = coalesce($3, respondability),
           reason_codes = coalesce($4, reason_codes),
           autonomy_used = coalesce($5, autonomy_used),
           latency_ms = coalesce($6, latency_ms),
           finished_at = coalesce($7::timestamptz, now()),
           model = coalesce(g.modelos, a.model),
           input_tokens = coalesce(g.entrada, a.input_tokens),
           output_tokens = coalesce(g.saida, a.output_tokens),
           cost_cents = coalesce(g.custo, a.cost_cents)
         from (select
                 string_agg(distinct s.model, '+' order by s.model) as modelos,
                 sum(s.input_tokens)::int  as entrada,
                 sum(s.output_tokens)::int as saida,
                 sum(s.cost_cents)         as custo
               from ${S}.model_spend s where s.agent_run_id = $1) g
         where a.id = $1`,
        [id, p.status ?? null, p.respondability ?? null, p.reason_codes ?? null,
         p.autonomy_used ?? null, p.latency_ms ?? null, p.finished_at ?? null]);
    },
  };

  const policies = {
    /**
     * As policies que valem para este tenant, lidas A CADA RUN.
     *
     * Sem cache, e isso e requisito e nao descuido: e o que faz uma contencao
     * valer no run seguinte. Um cache de cinco minutos aqui seria cinco minutos
     * de posts saindo depois de alguem apertar o botao de parar.
     */
    async listActive(org_id) {
      const { rows } = await pool.query(
        `select policy_id, version, status::text, priority, scope, conditions,
                effect::text, max_autonomy, reason_code, message_key
           from ${S}.rule_policies
          where status = 'ACTIVE' and (org_id is null or org_id = $1)
          order by priority asc`, [org_id]);
      return rows;
    },

    /**
     * Escreve (ou reativa) uma policy de contencao.
     *
     * Separada de `listActive` de proposito: quem le policy para DECIDIR nao
     * escreve policy. O gateway e o loop recebem so a leitura.
     *
     * Reaplicar a mesma contencao nao cria uma segunda linha — atualiza a que
     * existe e sobe a versao. Durante um incidente o botao e apertado duas
     * vezes, e a segunda nao pode virar uma policy duplicada que alguem depois
     * levanta pela metade.
     */
    async upsertContainment({ org_id, policy_id, priority, scope, effect, max_autonomy,
                              reason_code, message_key, reason, created_by, expires_at }) {
      const { rows } = await pool.query(
        `insert into ${S}.rule_policies
           (org_id, policy_id, version, status, priority, scope, conditions, effect,
            max_autonomy, reason_code, message_key, reason, created_by, expires_at)
         values ($1,$2,1,'ACTIVE',$3,$4::jsonb,'[]'::jsonb,$5::${S}.policy_effect,
                 $6,$7,$8,$9,$10,$11)
         on conflict (org_id, policy_id, version) do update set
           status = 'ACTIVE',
           priority = excluded.priority,
           scope = excluded.scope,
           effect = excluded.effect,
           max_autonomy = excluded.max_autonomy,
           reason = excluded.reason,
           created_by = excluded.created_by,
           expires_at = excluded.expires_at,
           created_at = now()
         returning policy_id, effect::text as effect, scope, max_autonomy,
                   reason, created_by, created_at, expires_at`,
        [org_id, policy_id, priority, json(scope), effect, max_autonomy ?? null,
         reason_code ?? null, message_key ?? null, reason, created_by, expires_at ?? null]);
      return rows[0];
    },

    /**
     * Levanta uma contencao — marcando BLOCKED, e nao apagando.
     *
     * Apagar tiraria do historico que houve contencao, e "houve contencao entre
     * terca e quinta" e exatamente o que se pergunta depois. O motivo de
     * levantar sobrescreve o de abaixar de proposito: quem consulta a linha
     * depois quer saber por que ela nao vale mais.
     */
    async liftContainment({ org_id, policy_id, lifted_by, reason }) {
      const { rows } = await pool.query(
        `update ${S}.rule_policies
            set status = 'BLOCKED',
                created_by = $3,
                reason = $4
          where org_id = $1 and policy_id = $2 and status = 'ACTIVE'
          returning policy_id`, [org_id, policy_id, lifted_by, reason]);
      return { ok: rows.length === 1 };
    },

    /** O que esta contido agora neste tenant, do mais recente para o mais antigo. */
    async listContainment(org_id) {
      const { rows } = await pool.query(
        `select policy_id, effect::text as effect, scope, max_autonomy, reason,
                created_by, created_at, expires_at
           from ${S}.rule_policies
          where org_id = $1 and status = 'ACTIVE' and created_by is not null
          order by created_at desc`, [org_id]);
      return rows;
    },
  };

  const receipts = {
    async find(org_id, capability_id, idempotency_key) {
      const { rows } = await pool.query(
        `select id as receipt_id, trace_id, capability_id, idempotency_key, request_hash,
                provider, external_id, status::text, autonomy_used, approval_id, recorded_at
           from ${S}.action_receipts
          where org_id = $1 and capability_id = $2 and idempotency_key = $3`,
        [org_id, capability_id, idempotency_key]);
      return rows[0] ?? null;
    },
    async save(r) {
      await pool.query(
        `insert into ${S}.action_receipts
           (id, org_id, workspace_id, capability_id, capability_version, idempotency_key,
            request_hash, provider, external_id, status, autonomy_used, approval_id, trace_id, recorded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::${S}.receipt_status,$11,$12,$13,$14)
         on conflict (org_id, capability_id, idempotency_key) do nothing`,
        [r.receipt_id, r.tenant.org_id, r.tenant.workspace_id, r.capability_id, 1,
         r.idempotency_key, r.request_hash, r.provider, r.external_id, r.status,
         r.autonomy_used, r.approval_id, r.trace_id, r.recorded_at]);
    },
  };

  /**
   * Outbox e ledger de deduplicacao de consumo (T5).
   *
   * O outbox recebe a intencao de evento no mesmo commit da mudanca de estado.
   * Estas portas sao o outro lado: quem drena e quem se lembra do que ja
   * consumiu. A politica (marcar depois do sucesso, nunca reservar antes)
   * mora em apps/worker/src/outbox-relay.mjs; aqui e so o SQL.
   */
  const outbox = {
    /**
     * Reserva um lote de linhas nao publicadas e ja conta a tentativa.
     *
     * `for update skip locked` e o que permite mais de um relay rodando: cada
     * um pega linhas diferentes em vez de disputar as mesmas. Sem isso, dois
     * workers entregariam o mesmo evento em paralelo — o consumidor aguenta,
     * mas e trabalho jogado fora de proposito.
     *
     * O incremento de attempts acontece no mesmo comando do claim: uma linha
     * que derrube o processo logo depois volta com a tentativa ja contada, e
     * por isso um evento envenenado eventualmente sai do caminho dos outros.
     */
    async claimOutboxBatch(limit = 100, maxAttempts = 5) {
      const { rows } = await pool.query(
        `with candidatas as (
           select id from ${S}.outbox
            where published_at is null and attempts < $2
            order by id
            limit $1
            for update skip locked
         )
         update ${S}.outbox o
            set attempts = o.attempts + 1
           from candidatas c
          where o.id = c.id
         returning o.id, o.org_id, o.workspace_id, o.event_type,
                   o.payload, o.trace_id, o.occurred_at, o.attempts`,
        [limit, maxAttempts]);
      return rows;
    },

    async markOutboxPublished(id) {
      await pool.query(
        `update ${S}.outbox set published_at = now()
          where id = $1 and published_at is null`, [id]);
    },

    /**
     * Linhas que estouraram maxAttempts e ninguem vai tentar de novo.
     * Nao ha coluna de dead-letter no outbox de proposito: "attempts alto e
     * published_at nulo" ja e a definicao, e uma coluna a mais seria um segundo
     * lugar para a mesma verdade.
     */
    async listStuckOutbox(maxAttempts = 5, limit = 100) {
      const { rows } = await pool.query(
        `select id, org_id, event_type, attempts, trace_id, occurred_at
           from ${S}.outbox
          where published_at is null and attempts >= $1
          order by id limit $2`, [maxAttempts, limit]);
      return rows;
    },

    async wasProcessed(consumer, event_key) {
      const { rows } = await pool.query(
        `select 1 from ${S}.processed_events where consumer = $1 and event_key = $2`,
        [consumer, event_key]);
      return rows.length > 0;
    },

    async markProcessed(consumer, event_key) {
      await pool.query(
        `insert into ${S}.processed_events (consumer, event_key) values ($1,$2)
         on conflict (consumer, event_key) do nothing`, [consumer, event_key]);
    },
  };

  /**
   * Transacao servindo tanto um Pool quanto um Client.
   * Os testes injetam um pg.Client unico; a aplicacao injeta um Pool.
   */
  async function emTransacao(fn) {
    const ehPool = typeof pool.connect === "function" && typeof pool.idleCount === "number";
    if (!ehPool) {
      await pool.query("begin");
      try { const r = await fn(pool); await pool.query("commit"); return r; }
      catch (e) { await pool.query("rollback"); throw e; }
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      const r = await fn(client);
      await client.query("commit");
      return r;
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  }

  /** Insere no outbox usando o client da transacao em curso. */
  async function enfileirarOutbox(c, { org_id, workspace_id, event_type, payload, trace_id }) {
    const { rows } = await c.query(
      `insert into ${S}.outbox (org_id, workspace_id, event_type, payload, trace_id)
       values ($1,$2,$3,$4::jsonb,$5) returning id`,
      [org_id, workspace_id ?? null, event_type, JSON.stringify(payload ?? {}), trace_id ?? null]);
    return rows[0].id;
  }

  /**
   * Aprovacoes (T4).
   *
   * A leitura sempre traz a linha de aprovacao JUNTO da versao de conteudo.
   * Sao as duas metades da mesma pergunta: nenhuma decisao sobre validade pode
   * ser tomada olhando so para a tabela de aprovacoes, porque e no conteudo
   * que o trigger de edicao deixa a marca.
   */
  const SELECT_PAR = `
    select
      a.id, a.org_id, a.workspace_id, a.subject_type, a.subject_id, a.subject_version,
      a.decision::text as decision, a.requested_reason_codes, a.decided_by, a.decided_at,
      a.comment, a.trace_id, a.created_at,
      cv.id as cv_id, cv.version as cv_version, cv.state::text as cv_state,
      cv.master_body as cv_master_body, cv.risk_tier::text as cv_risk_tier,
      cv.approved_at as cv_approved_at, cv.content_id as cv_content_id
    from ${S}.approvals a
    left join ${S}.content_versions cv on cv.id = a.subject_id`;

  const parear = (r) => r == null ? null : ({
    approval: {
      id: r.id, org_id: r.org_id, workspace_id: r.workspace_id,
      subject_type: r.subject_type, subject_id: r.subject_id, subject_version: r.subject_version,
      decision: r.decision, requested_reason_codes: r.requested_reason_codes,
      decided_by: r.decided_by, decided_at: r.decided_at, comment: r.comment,
      trace_id: r.trace_id, created_at: r.created_at,
    },
    content: r.cv_id == null ? null : {
      id: r.cv_id, version: r.cv_version, state: r.cv_state, master_body: r.cv_master_body,
      risk_tier: r.cv_risk_tier, approved_at: r.cv_approved_at, content_id: r.cv_content_id,
    },
  });

  const approvals = {
    async listPending(org_id, workspace_id) {
      const { rows } = await pool.query(
        `${SELECT_PAR}
          where a.org_id = $1 and a.workspace_id = $2 and a.decision = 'PENDING'
          order by a.created_at asc`, [org_id, workspace_id]);
      return rows.map(parear);
    },

    async getWithContent(org_id, approval_id) {
      const { rows } = await pool.query(
        `${SELECT_PAR} where a.id = $1 and a.org_id = $2`, [approval_id, org_id]);
      return parear(rows[0]);
    },

    /**
     * Sem org_id: e a porta que o Capability Gateway usa, e o escopo de tenant
     * ja foi verificado por ele no passo 2. A RLS continua valendo por baixo.
     */
    async getWithContentById(approval_id) {
      const { rows } = await pool.query(`${SELECT_PAR} where a.id = $1`, [approval_id]);
      return parear(rows[0]) ?? { approval: null, content: null };
    },

    /**
     * Decisao e transicao de estado no mesmo commit.
     *
     * A transicao NAO e validada aqui: quem recusa DRAFT -> APPROVED e o
     * trigger mkt.assert_content_transition(). Se ele levantar, a transacao
     * inteira volta e nao sobra aprovacao registrada sobre conteudo que nao
     * mudou de estado. Um `if` aqui seria a mesma regra em dois lugares.
     *
     * E porque os dois updates dividem a transacao, `now()` e o mesmo instante
     * em approvals.decided_at e em content_versions.approved_at — que e o que
     * torna exata a comparacao feita em evaluateApproval().
     */
    /**
     * @param {{ org_id: string, approval_id: string, decision: string, decided_by: string,
     *           comment?: string|null, trace_id?: string|null }} args
     */
    async decide({ org_id, approval_id, decision, decided_by, comment = null, trace_id = null }) {
      return emTransacao(async (c) => {
        const { rows } = await c.query(
          `update ${S}.approvals
              set decision = $3::${S}.approval_decision, decided_by = $4,
                  decided_at = now(), comment = coalesce($5, comment),
                  trace_id = coalesce($6, trace_id)
            where id = $1 and org_id = $2 and decision = 'PENDING'
            returning subject_id`,
          [approval_id, org_id, decision, decided_by, comment, trace_id]);

        if (!rows[0]) {
          const e = new Error("aprovacao ja decidida ou inexistente");
          e.reason_code = "CONTENT_NOT_APPROVED";
          throw e;
        }

        await c.query(
          `update ${S}.content_versions set state = $2::${S}.content_state where id = $1`,
          [rows[0].subject_id, decision === "APPROVED" ? "APPROVED" : "REJECTED"]);

        const { rows: par } = await c.query(
          `${SELECT_PAR} where a.id = $1 and a.org_id = $2`, [approval_id, org_id]);
        return parear(par[0]);
      });
    },
  };

  /**
   * Conexoes de canal e variantes — o que o adapter de provider precisa ler.
   *
   * `secret_ref` sai daqui; o TOKEN nao. Resolver a referencia e trabalho do
   * vault (ADR-005), e por isso o adapter recebe uma porta `secrets` separada:
   * assim nenhuma query deste arquivo tem como devolver credencial.
   */
  const connections = {
    async get(connection_id) {
      const { rows } = await pool.query(
        `select id, org_id, workspace_id, channel::text as channel, provider,
                external_account_id, display_name, status::text as status,
                secret_ref, scopes, expires_at
           from ${S}.connections where id = $1`, [connection_id]);
      return rows[0] ?? null;
    },
  };

  const variants = {
    async get(channel_variant_id) {
      const { rows } = await pool.query(
        `select id, content_version_id, channel::text as channel,
                headline, body, cta, asset_refs, char_count
           from ${S}.channel_variants where id = $1`, [channel_variant_id]);
      return rows[0] ?? null;
    },
  };

  /**
   * Producao de trabalho: quem coloca coisa nas filas (T-seguinte).
   *
   * Ate aqui o relay drenava um outbox que nada alimentava, e a tela de
   * aprovacao lia uma fila que nada criava. As duas pontas existiam; faltava
   * a origem. E aqui.
   *
   * A regra que este bloco existe para respeitar: a mudanca de estado do
   * dominio e a intencao de avisar entram no MESMO commit. Se a publicacao
   * fosse agendada num lugar e o evento emitido em outro, as duas poderiam
   * divergir — e um outbox que diverge do dominio e pior que nao ter outbox,
   * porque parece confiavel.
   */
  const publishing = {
    /**
     * Agenda uma publicacao e emite o pedido, numa transacao so.
     *
     * NAO valida aqui se o conteudo esta aprovado. Quem decide isso e a state
     * machine em trigger: a transicao APPROVED -> SCHEDULED e a unica legal, e
     * o `where state = 'APPROVED'` faz a linha nao ser tocada em qualquer outro
     * estado. Zero linhas atualizadas e a resposta do banco, nao um palpite
     * nosso — e por isso viramos isso em CONTENT_NOT_APPROVED em vez de
     * reimplementar a tabela de transicoes num if.
     */
    /**
     * @param {{ org_id: string, workspace_id: string, content_version_id: string,
     *           channel: string, connection_id: string, channel_variant_id: string,
     *           approval_id?: string|null, autonomy_used?: string|null,
     *           trace_id?: string|null, scheduled_at?: string|null }} args
     */
    async schedule({ org_id, workspace_id, content_version_id, channel, connection_id,
                     channel_variant_id, approval_id = null, autonomy_used = null,
                     trace_id = null, scheduled_at = null }) {
      return emTransacao(async (c) => {
        const mov = await c.query(
          `update ${S}.content_versions set state = 'SCHEDULED'
            where id = $1 and org_id = $2 and state = 'APPROVED'
            returning id, version`,
          [content_version_id, org_id]);

        if (!mov.rows[0]) {
          const e = new Error("conteudo nao esta aprovado para agendamento");
          e.reason_code = "CONTENT_NOT_APPROVED";
          throw e;
        }

        const pub = await c.query(
          `insert into ${S}.publications
             (org_id, workspace_id, content_version_id, channel_variant_id, connection_id,
              channel, status, scheduled_at, approval_id, autonomy_used)
           values ($1,$2,$3,$4,$5,$6::${S}.channel,'SCHEDULED',coalesce($7, now()),$8,$9)
           returning id`,
          [org_id, workspace_id, content_version_id, channel_variant_id, connection_id,
           channel, scheduled_at, approval_id, autonomy_used]);

        // O payload e exatamente o que o publish-workflow espera receber.
        // Nada de tenant vindo daqui para o input do usuario: org e workspace
        // sao os da linha, ja verificados acima.
        const outbox_id = await enfileirarOutbox(c, {
          org_id, workspace_id,
          event_type: "olga/content.publish.requested",
          trace_id,
          payload: {
            content_version_id, channel, connection_id, channel_variant_id,
            publication_id: pub.rows[0].id, approval_id,
          },
        });

        return { publication_id: pub.rows[0].id, outbox_id: String(outbox_id) };
      });
    },

    /**
     * Cria o pedido de aprovacao e leva o conteudo para revisao.
     *
     * O estado de destino sai dos reason codes, nao de um parametro: se a
     * policy pediu revisao de compliance, o conteudo vai para
     * COMPLIANCE_REVIEW e nao para a fila humana comum. Deixar quem chama
     * escolher abriria caminho para um claim material ser revisado como se
     * fosse texto qualquer.
     */
    /**
     * Onde uma versão de conteúdo pode ser publicada num canal.
     *
     * O compilador de publishing.publish chama isto em vez de aceitar
     * connection_id e channel_variant_id do modelo. As duas coisas são
     * consequência do conteúdo e do canal, não escolha de quem pediu — e
     * deixá-las virem de fora seria deixar o modelo escolher em qual conta
     * publicar.
     */
    async findDestination(org_id, workspace_id, content_version_id, channel) {
      const { rows } = await pool.query(
        `select v.id as channel_variant_id, c.id as connection_id,
                c.status::text as connection_status, c.external_account_id
           from ${S}.channel_variants v
           join ${S}.connections c
             on c.workspace_id = $2 and c.org_id = $1
            and c.channel = v.channel and c.status = 'ACTIVE'
          where v.content_version_id = $3
            and v.channel = $4::${S}.channel
            and v.org_id = $1
          limit 1`,
        [org_id, workspace_id, content_version_id, channel]);
      return rows[0] ?? null;
    },

    /**
     * @param {{ org_id: string, workspace_id: string, content_version_id: string,
     *           reason_codes?: string[], trace_id?: string|null }} args
     */
    /**
     * DRAFT -> AI_REVIEW, com o laudo que justificou a transicao.
     *
     * ── Por que o laudo e gravado, e nao so o estado ──────────────────────
     *
     * Sem ele, AI_REVIEW e um estado sem lastro: alguem olha o conteudo em
     * revisao daqui a tres meses e nao tem como responder "o que a IA conferiu,
     * e o que ela achou". Estado sem evidencia e confianca sem lastro, que e
     * exatamente o que este produto existe para nao produzir.
     *
     * Os dois saem na MESMA transacao. Gravar o evento depois do commit do
     * estado abriria a janela em que o conteudo esta em revisao e o motivo
     * sumiu — e essa e a janela em que a auditoria pergunta.
     *
     * Este e o primeiro escritor de mkt.marketing_events. A tabela existe desde
     * a 0005 para fatos de dominio, e o outbox NAO servia aqui: outbox e para
     * evento que precisa ser ENTREGUE, e o relay drenaria este para um
     * barramento onde ninguem escuta.
     *
     * ── Idempotencia ─────────────────────────────────────────────────────
     *
     * Conteudo ja em AI_REVIEW devolve ok sem gravar de novo. Rodar a revisao
     * duas vezes e normal — o loop pode ser reexecutado — e a segunda nao pode
     * virar um segundo evento dizendo que passou outra vez.
     */
    async markAiReviewed({ org_id, workspace_id, content_version_id, checks = [], trace_id = null }) {
      return emTransacao(async (c) => {
        const cv = await c.query(
          `select state::text as state from ${S}.content_versions
            where id = $1 and org_id = $2
            for update`, [content_version_id, org_id]);
        if (!cv.rows[0]) {
          const e = new Error("versao de conteudo inexistente");
          e.reason_code = "SCHEMA_VALIDATION_FAILED";
          throw e;
        }

        const estado = cv.rows[0].state;
        if (estado === "AI_REVIEW") return { ok: true, state: estado, repetido: true };
        if (!canTransition(estado, "AI_REVIEW")) return { ok: false, state: estado };

        await c.query(
          `update ${S}.content_versions set state = 'AI_REVIEW' where id = $1`,
          [content_version_id]);

        await c.query(
          `insert into ${S}.marketing_events
             (org_id, workspace_id, event_type, actor_type, object_type, object_id,
              properties, trace_id, occurred_at)
           values ($1,$2,'olga/content.ai_review.passed','agent','content_version',$3,
                   $4::jsonb,$5, now())`,
          [org_id, workspace_id ?? null, content_version_id,
           JSON.stringify({ checks }), trace_id]);

        return { ok: true, state: "AI_REVIEW", repetido: false };
      });
    },

    async requestApproval({ org_id, workspace_id, content_version_id, reason_codes = [],
                            trace_id = null }) {
      const compliance = reason_codes.includes("COMPLIANCE_REVIEW_REQUIRED");
      const destino = compliance ? "COMPLIANCE_REVIEW" : "HUMAN_REVIEW";

      return emTransacao(async (c) => {
        const cv = await c.query(
          `select version, state::text as state from ${S}.content_versions
            where id = $1 and org_id = $2`, [content_version_id, org_id]);
        if (!cv.rows[0]) {
          const e = new Error("versao de conteudo inexistente");
          e.reason_code = "SCHEMA_VALIDATION_FAILED";
          throw e;
        }

        // Se ja esta no estado de revisao certo, nao force a transicao: a state
        // machine recusaria COMPLIANCE_REVIEW -> COMPLIANCE_REVIEW... na verdade
        // ela deixa passar por `new.state = old.state`, mas evitar o update
        // deixa claro que reabrir revisao nao e mover conteudo.
        //
        // Fora esse caso, a transicao e conferida ANTES do update, contra a
        // mesma tabela que o trigger usa. Nao e redundancia: sem isso, pedir
        // aprovacao de um DRAFT estourava com INVALID_STATE_TRANSITION cru —
        // excecao de banco vazando como se fosse defeito nosso — em vez de uma
        // recusa que diz o que falta fazer.
        //
        // E o que falta e real: DRAFT so alcanca revisao passando por
        // AI_REVIEW. Quem escreve conteudo passa pelo quality.precheck antes
        // de pedir olho humano, e a state machine da J11 nao deixa pular.
        if (cv.rows[0].state !== destino) {
          if (!canTransition(cv.rows[0].state, destino)) {
            const e = new Error(
              `conteudo em ${cv.rows[0].state} nao pode ir para ${destino}` +
              (cv.rows[0].state === "DRAFT" ? ": falta passar por AI_REVIEW" : ""));
            // O registry declara CONTENT_NOT_APPROVED como o codigo desta
            // capability. Inventar um codigo novo aqui deixaria o codigo e o
            // registry dizendo coisas diferentes sobre a mesma falha.
            e.reason_code = "CONTENT_NOT_APPROVED";
            throw e;
          }
          await c.query(
            `update ${S}.content_versions set state = $2::${S}.content_state where id = $1`,
            [content_version_id, destino]);
        }

        const ap = await c.query(
          `insert into ${S}.approvals
             (org_id, workspace_id, subject_type, subject_id, subject_version,
              requested_reason_codes, trace_id)
           values ($1,$2,'content_version',$3,$4,$5,$6)
           returning id`,
          [org_id, workspace_id, content_version_id, cv.rows[0].version, reason_codes, trace_id]);

        return { approval_id: ap.rows[0].id, state: destino };
      });
    },
  };

  /**
   * Leitura para as telas.
   *
   * Consultas de listagem, separadas das de decisao de proposito: o que a tela
   * mostra e o que o gateway avalia nao sao a mesma pergunta, e misturar as
   * duas faria uma mudanca de layout mexer no caminho que autoriza efeito.
   */
  const content = {
    /**
     * As marcas do workspace, com o estado do Brand Brain de cada uma.
     *
     * `brand_brain_version` nulo e a informacao que importa nesta lista: e uma
     * marca para a qual o agente recusa criar conteudo, e a home tem de dizer
     * isso antes de alguem descobrir na primeira tentativa.
     */
    async listBrands(org_id, workspace_id) {
      const { rows } = await pool.query(
        `select b.id, b.name, b.website_url,
                bb.version as brand_brain_version,
                bb.activated_at,
                (select count(*)::int from ${S}.brand_brain_versions c
                  where c.brand_id = b.id and c.status = 'CANDIDATE') as candidatas
           from ${S}.brands b
           left join ${S}.brand_brain_versions bb
             on bb.brand_id = b.id and bb.status = 'ACTIVE'
          where b.org_id = $1 and b.workspace_id = $2
          order by b.name`, [org_id, workspace_id]);
      return rows;
    },

    /**
     * Versao corrente de cada conteudo do workspace, com o que a tela precisa
     * para decidir o que oferecer: estado, canal ja publicado, e se ha
     * variante para publicar.
     */
    async listByWorkspace(org_id, workspace_id, { limit = 50 } = {}) {
      const { rows } = await pool.query(
        `select
           ct.id            as content_id,
           ct.title,
           cv.id            as content_version_id,
           cv.version,
           cv.state::text   as state,
           cv.risk_tier::text as risk_tier,
           cv.master_body,
           cv.approved_at,
           cv.created_at,
           coalesce((
             select json_agg(json_build_object(
                      'id', v.id, 'channel', v.channel::text, 'body', v.body))
               from ${S}.channel_variants v where v.content_version_id = cv.id
           ), '[]'::json) as variants,
           coalesce((
             select json_agg(json_build_object(
                      'channel', p.channel::text, 'status', p.status::text,
                      'external_id', p.external_id))
               from ${S}.publications p where p.content_version_id = cv.id
           ), '[]'::json) as publications
         from ${S}.contents ct
         join lateral (
           -- A versao corrente e a maior. Join lateral porque precisamos de
           -- uma linha por conteudo, nao do produto com todas as versoes.
           select * from ${S}.content_versions x
            where x.content_id = ct.id
            order by x.version desc limit 1
         ) cv on true
         where ct.org_id = $1 and ct.workspace_id = $2
         order by ct.created_at desc
         limit $3`,
        [org_id, workspace_id, limit]);
      return rows;
    },

    /** Conexoes do workspace, para a tela saber o que da para publicar. */
    async listConnections(org_id, workspace_id) {
      const { rows } = await pool.query(
        `select id, channel::text as channel, status::text as status,
                display_name, external_account_id, expires_at
           from ${S}.connections
          where org_id = $1 and workspace_id = $2
          order by channel`, [org_id, workspace_id]);
      return rows;
    },
  };

  /**
   * Camada de conhecimento: o que o agente pode LER para se situar.
   *
   * Separada de `content` (que serve as telas) e de `registry` (que decide
   * autorizacao) de proposito. O que a tela mostra, o que o gateway avalia e o
   * que o agente le sao tres perguntas diferentes; um SELECT que servisse as
   * tres viraria o lugar onde mudar layout mexe em autorizacao.
   *
   * Nada aqui devolve "tudo": cada consulta traz uma fatia com a sua versao.
   */
  const knowledge = {
    /**
     * Os contratos de fonte ACTIVE, por source_kind (Mestra §7.5).
     *
     * Uma consulta por run, e nao uma por fatia: sao cinco linhas de catalogo
     * que nao mudam durante um run, e cinco idas ao banco para a mesma resposta
     * seriam custo sem informacao.
     *
     * Fonte sem contrato NAO vira default silencioso aqui. Quem decide o que
     * fazer com a ausencia e o retrieval, e a decisao dele e fail-closed —
     * porque a alternativa deixa uma fonte nova entrar em producao sem ninguem
     * ter dito quando ela envelhece.
     */
    async sourceContracts() {
      const { rows } = await pool.query(
        `select source_kind, temporal_authority, max_age_days, default_quality,
                carries_pii, permission_scope, grain, caveats, owner, version
           from ${S}.source_contracts
          where status = 'ACTIVE'`);
      return Object.fromEntries(rows.map((r) => [r.source_kind, r]));
    },

    /**
     * O CADASTRO da marca — nome e site — sem passar por Brand Brain nenhum.
     *
     * Existe porque o onboarding acontece justamente quando nao ha Brand Brain:
     * a marca acabou de ser criada e o que se tem dela e a linha de mkt.brands.
     * `website_url` daqui e a unica origem aceita para a URL que
     * brand.extract_from_url busca — ver o adapter brand_extract.
     */
    async brand(org_id, brand_id) {
      const { rows } = await pool.query(
        `select id, org_id, workspace_id, name, website_url, created_at
           from ${S}.brands
          where org_id = $1 and id = $2`, [org_id, brand_id]);
      return rows[0] ?? null;
    },

    /** A versao ACTIVE do Brand Brain de uma marca. Nao ha duas. */
    async brandBrain(org_id, brand_id) {
      const { rows } = await pool.query(
        `select bb.id, bb.brand_id, bb.version, bb.status::text as status,
                bb.identity, bb.tone, bb.claims_allowed, bb.prohibitions,
                bb.disclaimers, bb.activated_at, bb.created_at,
                b.name as brand_name
           from ${S}.brand_brain_versions bb
           join ${S}.brands b on b.id = bb.brand_id
          where bb.org_id = $1 and bb.brand_id = $2 and bb.status = 'ACTIVE'
          order by bb.version desc
          limit 1`, [org_id, brand_id]);
      return rows[0] ?? null;
    },

    /** O Brand Brain da marca de um conteudo, quando so se tem o conteudo. */
    async brandBrainForContent(org_id, content_version_id) {
      const { rows } = await pool.query(
        `select bb.id, bb.brand_id, bb.version, bb.status::text as status,
                bb.identity, bb.tone, bb.claims_allowed, bb.prohibitions,
                bb.disclaimers, bb.activated_at, bb.created_at,
                b.name as brand_name
           from ${S}.content_versions cv
           join ${S}.contents ct on ct.id = cv.content_id
           join ${S}.brands b on b.id = ct.brand_id
           join ${S}.brand_brain_versions bb
             on bb.brand_id = b.id and bb.status = 'ACTIVE'
          where cv.id = $2 and cv.org_id = $1
          order by bb.version desc
          limit 1`, [org_id, content_version_id]);
      return rows[0] ?? null;
    },

    /** Evidence citada pelos claims de uma versao de conteudo. */
    async evidenceFor(org_id, content_version_id) {
      const { rows } = await pool.query(
        `select distinct e.id, e.source_kind, e.locator, e.hash, e.fact,
                e.quality, e.retrieved_at
           from ${S}.claims cl
           join ${S}.evidence e on e.id = any(cl.evidence_ids)
          where cl.content_version_id = $2 and cl.org_id = $1
          order by e.retrieved_at desc
          limit 50`, [org_id, content_version_id]);
      return rows;
    },

    /**
     * A versao de conteudo em si, com o que decide sobre ela.
     *
     * Separada de `content.listByWorkspace` de proposito: aquela monta tela,
     * esta alimenta check. Uma mudanca de layout nao pode mexer no que o
     * compliance le.
     */
    async contentVersion(org_id, content_version_id) {
      const { rows } = await pool.query(
        `select cv.id, cv.content_id, cv.version, cv.state::text as state,
                cv.master_body, cv.risk_tier::text as risk_tier,
                cv.brand_brain_version_id, cv.trace_id,
                ct.workspace_id, ct.brand_id, ct.title, ct.objective
           from ${S}.content_versions cv
           join ${S}.contents ct on ct.id = cv.content_id
          where cv.id = $2 and cv.org_id = $1`, [org_id, content_version_id]);
      return rows[0] ?? null;
    },

    /**
     * Outra versao do mesmo workspace com o MESMO texto.
     *
     * Igualdade normalizada, nao semelhanca: minusculas e espaco colapsado, e
     * so. "Parecido" seria um limiar arbitrario que ninguem consegue defender
     * numa auditoria — e CONTENT_DUPLICATE_RISK precisa ser reproduzivel.
     * Deteccao por similaridade e trabalho de outra fase, com dado de embedding
     * e limiar declarado.
     */
    async duplicateOf(org_id, workspace_id, content_version_id) {
      const norm = `lower(regexp_replace(btrim(%s), '\\s+', ' ', 'g'))`;
      const { rows } = await pool.query(
        `with alvo as (
           select cv.id, cv.master_body
             from ${S}.content_versions cv
             join ${S}.contents ct on ct.id = cv.content_id
            where cv.id = $3 and cv.org_id = $1 and ct.workspace_id = $2
         )
         select cv.id as content_version_id, cv.state::text as state, ct.title
           from ${S}.content_versions cv
           join ${S}.contents ct on ct.id = cv.content_id
           join alvo a on a.id <> cv.id
          where cv.org_id = $1 and ct.workspace_id = $2
            and ${norm.replace("%s", "cv.master_body")} = ${norm.replace("%s", "a.master_body")}
          order by cv.created_at
          limit 1`, [org_id, workspace_id, content_version_id]);
      return rows[0] ?? null;
    },

    /**
     * Claims de uma versao, com o que a materialidade exige.
     *
     * `evidencias` conta evidence que EXISTE, nao id citado.
     *
     * A diferenca decide se o check de claim sem lastro serve para alguma
     * coisa. A constraint claim_material_requires_evidence ja garante que
     * nenhum claim material entra com o array vazio — contra o tamanho do
     * array, o check nunca reprovaria nada e seria decoracao.
     *
     * Mas `evidence_ids` e uuid[] e nao tem foreign key: Postgres nao tem como
     * ter, e por isso apagar uma evidence deixa o id pendurado no claim. O
     * conteudo continua afirmando cobertura, e o que sustentava a afirmacao
     * sumiu sem que nada reclamasse. E esse o caso que o precheck pega.
     */
    async claimsFor(org_id, content_version_id) {
      const { rows } = await pool.query(
        `select c.id, c.text, c.material, c.claim_type,
                cardinality(c.evidence_ids) as citadas,
                (select count(*) from ${S}.evidence e
                  where e.id = any(c.evidence_ids) and e.org_id = c.org_id) as evidencias
           from ${S}.claims c
          where c.content_version_id = $2 and c.org_id = $1
          order by c.material desc, c.created_at`, [org_id, content_version_id]);
      return rows;
    },
  };

  /**
   * Autoria: as escritas internas que as capabilities executam.
   *
   * Separadas de `publishing` porque criam CONTEUDO, e de `knowledge` porque
   * nao leem. O que elas tem em comum e o que importa: nenhuma decide
   * autorizacao. Quem autorizou foi o Capability Gateway, antes de chamar.
   */
  const authoring = {
    /**
     * Conteudo novo nasce DRAFT. A state machine cuida do resto.
     *
     * Os claims entram na MESMA transacao que o corpo, e nao logo depois. Se
     * fossem dois commits, existiria um instante em que a versao ja esta
     * gravada e o que ela afirma ainda nao — e um precheck que rodasse nesse
     * instante aprovaria conteudo material como se fosse texto qualquer.
     *
     * `claim_material_requires_evidence` derruba a transacao inteira se um
     * claim material chegar sem evidence. Nao ha caminho por onde metade disso
     * fique gravada.
     */
    async createDraft({ org_id, workspace_id, brand_id, title, objective,
                        master_body, actor_id, trace_id, agent_id, agent_version,
                        brand_brain_version_id = null, claims = [] }) {
      return emTransacao(async (c) => {
        const ct = await c.query(
          `insert into ${S}.contents (org_id, workspace_id, brand_id, title, objective,
                                      created_by_actor_type, created_by_actor_id)
           values ($1,$2,$3,$4,$5,'agent',$6) returning id`,
          [org_id, workspace_id, brand_id, title, objective ?? null, actor_id ?? null]);

        const cv = await c.query(
          `insert into ${S}.content_versions
             (org_id, content_id, version, master_body, state, trace_id,
              agent_id, agent_version, brand_brain_version_id,
              created_by_actor_type, created_by_actor_id)
           values ($1,$2,1,$3,'DRAFT',$4,$5,$6,$7,'agent',$8)
           returning id, version`,
          [org_id, ct.rows[0].id, master_body, trace_id ?? null,
           agent_id ?? null, agent_version ?? null, brand_brain_version_id, actor_id ?? null]);

        for (const cl of claims) {
          await c.query(
            `insert into ${S}.claims (org_id, content_version_id, text, material, claim_type, evidence_ids)
             values ($1,$2,$3,$4,$5,coalesce($6::uuid[], '{}'::uuid[]))`,
            [org_id, cv.rows[0].id, cl.text, cl.material === true,
             cl.claim_type ?? 'GENERAL', cl.evidence_ids?.length ? cl.evidence_ids : null]);
        }

        return { content_id: ct.rows[0].id, content_version_id: cv.rows[0].id,
                 version: cv.rows[0].version, claims: claims.length };
      });
    },

    /**
     * Variante de canal. Uma por (versao, canal) — a constraint garante.
     * Reexecutar devolve a que ja existe em vez de estourar: a capability e
     * interna, mas o loop pode reexecutar, e um erro aqui viraria falha de
     * agente quando na verdade o trabalho ja estava feito.
     */
    async createVariant({ org_id, content_version_id, channel, headline, body, cta, asset_refs }) {
      const { rows } = await pool.query(
        `insert into ${S}.channel_variants
           (org_id, content_version_id, channel, headline, body, cta, asset_refs, char_count)
         values ($1,$2,$3::${S}.channel,$4,$5,$6,coalesce($7::jsonb,'[]'::jsonb),$8)
         on conflict (content_version_id, channel) do update
           set body = excluded.body, headline = excluded.headline, cta = excluded.cta
         returning id, channel::text as channel`,
        [org_id, content_version_id, channel, headline ?? null, body, cta ?? null,
         asset_refs ? JSON.stringify(asset_refs) : null, body ? body.length : null]);
      return rows[0];
    },

    /**
     * Nova versao do Brand Brain — SEMPRE CANDIDATE.
     *
     * O agente AGT-MKT-BRAND declara isso no proprio registry, em
     * deviates_from_base: "Promove versao apenas para CANDIDATE; a promocao
     * para ACTIVE e sempre humana." Aqui o status e literal, nao parametro:
     * nao ha argumento que faca esta funcao escrever ACTIVE.
     *
     * O motivo e o erro mais caro do papel: um Brand Brain errado promovido
     * contamina todo conteudo gerado depois, e ninguem percebe a origem.
     */
    async proposeBrandVersion({ org_id, brand_id, identity, tone, claims_allowed,
                               prohibitions, disclaimers, source_refs, actor_id }) {
      return emTransacao(async (c) => {
        const prox = await c.query(
          `select coalesce(max(version), 0) + 1 as v from ${S}.brand_brain_versions
            where org_id = $1 and brand_id = $2`, [org_id, brand_id]);

        const { rows } = await c.query(
          `insert into ${S}.brand_brain_versions
             (org_id, brand_id, version, status, identity, tone, claims_allowed,
              prohibitions, disclaimers, source_refs,
              created_by_actor_type, created_by_actor_id)
           values ($1,$2,$3,'CANDIDATE',
                   coalesce($4::jsonb,'{}'::jsonb), coalesce($5::jsonb,'{}'::jsonb),
                   coalesce($6::jsonb,'[]'::jsonb), coalesce($7::jsonb,'[]'::jsonb),
                   coalesce($8::jsonb,'[]'::jsonb), coalesce($9::jsonb,'[]'::jsonb),
                   'agent',$10)
           returning id, version, status::text as status`,
          [org_id, brand_id, prox.rows[0].v,
           json(identity), json(tone), json(claims_allowed), json(prohibitions),
           json(disclaimers), json(source_refs), actor_id ?? null]);
        return rows[0];
      });
    },

    /**
     * Ativar uma versao de Brand Brain — o ato humano em que o onboarding
     * termina.
     *
     * Nao e capability, e nao vai virar uma. Ativar e assumir como marca o que
     * um modelo leu de uma pagina: e a partir daqui que o redator pode repetir
     * cada claim da lista, e que o compliance passa a cobrar cada disclaimer.
     * Um agente que ativasse a propria proposta fecharia o circuito sobre si
     * mesmo — o AGT-MKT-BRAND declara isso no proprio charter.
     *
     * ── Por que rebaixar e promover moram na mesma transacao ─────────────
     *
     * `brand_brain_one_active` e um unique index parcial: existe no maximo uma
     * ACTIVE por marca. Promover antes de rebaixar viola o indice; rebaixar
     * fora da transacao deixaria uma janela em que a marca nao tem Brand Brain
     * nenhum — e nessa janela content.create_draft recusa com
     * BRAND_BRAIN_NOT_ACTIVE, para um cliente que nao pediu nada.
     *
     * `for update` nas duas linhas porque duas abas ativando versoes
     * diferentes ao mesmo tempo e um caso banal, e sem o lock as duas leem
     * "nenhuma ativa" e uma delas quebra no indice, com erro de constraint em
     * vez de resposta.
     *
     * DEPRECATED tambem pode voltar a ACTIVE, de proposito: reverter para a
     * versao anterior quando a nova se revela ruim e a operacao mais provavel
     * deste produto, e o SQL e o mesmo. O que nao volta e BLOCKED — bloqueio e
     * decisao que precisa ser desfeita por quem a tomou, nao por um clique de
     * ativar.
     */
    async activateBrandVersion({ org_id, brand_id, version_id, actor_id }) {
      return emTransacao(async (c) => {
        const alvo = await c.query(
          `select id, version, status::text as status
             from ${S}.brand_brain_versions
            where id = $1 and org_id = $2 and brand_id = $3
            for update`, [version_id, org_id, brand_id]);
        if (alvo.rows.length === 0) return { ok: false, reason: "NOT_FOUND" };

        const atual = alvo.rows[0];
        if (atual.status === "ACTIVE") return { ok: false, reason: "ALREADY_ACTIVE", version: atual };
        if (atual.status !== "CANDIDATE" && atual.status !== "DEPRECATED") {
          return { ok: false, reason: "NOT_ACTIVATABLE", version: atual };
        }

        const anterior = await c.query(
          `select id, version from ${S}.brand_brain_versions
            where org_id = $1 and brand_id = $2 and status = 'ACTIVE'
            for update`, [org_id, brand_id]);

        if (anterior.rows.length > 0) {
          await c.query(
            `update ${S}.brand_brain_versions set status = 'DEPRECATED'
              where id = $1`, [anterior.rows[0].id]);
        }

        const { rows } = await c.query(
          `update ${S}.brand_brain_versions
              set status = 'ACTIVE', activated_at = now(),
                  created_by_actor_id = coalesce(created_by_actor_id, $2)
            where id = $1
            returning id, version, status::text as status, activated_at,
                      claims_allowed, prohibitions, disclaimers, source_refs`,
          [version_id, actor_id ?? null]);

        return {
          ok: true,
          version: rows[0],
          replaced: anterior.rows[0] ?? null,
          reverted: atual.status === "DEPRECATED",
        };
      });
    },

    /**
     * Derivar uma nova versao candidata a partir de outra.
     *
     * ── Por que editar CRIA uma versao, em vez de mudar a que existe ──────
     *
     * Porque uma versao de Brand Brain e o que autoriza o redator a afirmar
     * cada coisa. Mudar uma linha existente trocaria, em silencio, o que o
     * agente pode dizer — sem deixar rastro de que era outra coisa antes, e
     * sem que a aprovacao de quem ativou aquilo continuasse valendo sobre o
     * texto que ele leu. E a mesma regra do conteudo, onde a decisao e
     * vinculada a VERSAO e nao ao objeto.
     *
     * Entao aqui nada e mutado. Sai uma versao nova, CANDIDATE, com
     * created_by_actor_type = 'user' — que e o que distingue "o agente leu o
     * site" de "alguem escreveu a mao" sem precisar de coluna nova.
     *
     * ── source_refs sao herdadas, e nao regravadas ────────────────────────
     *
     * A pessoa editou o texto; ela nao leu a pagina de novo. Herdar mantem a
     * resposta certa para "de onde veio esta versao": veio daquela pagina,
     * com aquele hash, e depois passou por revisao humana. Deixar a edicao
     * reescrever procedencia seria deixar procedencia virar digitacao.
     *
     * ── A de origem, se era candidata, passa a substituida ────────────────
     *
     * Duas candidatas igualmente validas na lista sao um convite a ativar a
     * errada. Se a origem for ACTIVE ela continua ACTIVE: quem deriva de uma
     * marca no ar esta rascunhando a substituta, e a que esta no ar tem de
     * seguir funcionando ate alguem decidir trocar.
     */
    async deriveBrandVersion({ org_id, brand_id, from_version_id, patch, actor_id }) {
      return emTransacao(async (c) => {
        const origem = await c.query(
          `select id, version, status::text as status, identity, tone,
                  claims_allowed, prohibitions, disclaimers, source_refs
             from ${S}.brand_brain_versions
            where id = $1 and org_id = $2 and brand_id = $3
            for update`, [from_version_id, org_id, brand_id]);
        if (origem.rows.length === 0) return { ok: false, reason: "NOT_FOUND" };

        const de = origem.rows[0];
        if (de.status === "BLOCKED") return { ok: false, reason: "NOT_EDITABLE", version: de };

        const campo = (nome, padrao) =>
          Object.prototype.hasOwnProperty.call(patch ?? {}, nome) ? patch[nome] : (de[nome] ?? padrao);

        const prox = await c.query(
          `select coalesce(max(version), 0) + 1 as v from ${S}.brand_brain_versions
            where org_id = $1 and brand_id = $2`, [org_id, brand_id]);

        const { rows } = await c.query(
          `insert into ${S}.brand_brain_versions
             (org_id, brand_id, version, status, identity, tone, claims_allowed,
              prohibitions, disclaimers, source_refs,
              created_by_actor_type, created_by_actor_id)
           values ($1,$2,$3,'CANDIDATE',$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,
                   'user',$10)
           returning id, version, status::text as status, identity, tone,
                     claims_allowed, prohibitions, disclaimers, source_refs`,
          [org_id, brand_id, prox.rows[0].v,
           json(campo("identity", {})), json(campo("tone", {})),
           json(campo("claims_allowed", [])), json(campo("prohibitions", [])),
           json(campo("disclaimers", [])), json(de.source_refs ?? []),
           actor_id ?? null]);

        if (de.status === "CANDIDATE") {
          await c.query(
            `update ${S}.brand_brain_versions set status = 'DEPRECATED' where id = $1`, [de.id]);
        }

        return { ok: true, version: rows[0], from: { id: de.id, version: de.version, status: de.status } };
      });
    },

    /** As versoes de Brand Brain de uma marca, para a tela de revisao. */
    async brandVersions(org_id, brand_id) {
      const { rows } = await pool.query(
        `select id, version, status::text as status, identity, tone,
                claims_allowed, prohibitions, disclaimers, source_refs,
                created_by_actor_type::text as created_by_actor_type,
                created_at, activated_at
           from ${S}.brand_brain_versions
          where org_id = $1 and brand_id = $2
          order by version desc`, [org_id, brand_id]);
      return rows;
    },
  };

  /**
   * Resolucao de entidade: nome que uma pessoa digitou -> id canonico do tenant.
   *
   * Separada de `knowledge` de proposito. Conhecimento e o que o agente le
   * DEPOIS de saber sobre o que esta falando; isto e o passo anterior, e o
   * unico que decide identidade. Misturar os dois faria toda consulta de
   * leitura virar um lugar capaz de trocar de marca.
   *
   * ── Tres regras que valem para todo metodo daqui ─────────────────────────
   *
   * 1. Toda consulta e escopada por org_id. Uma resolucao que atravessa tenant
   *    nao e um bug de listagem: e o agente escrevendo no perfil de outro
   *    cliente, que a Mestra §B classifica como S3.
   *
   * 2. Nenhum metodo escolhe entre candidatos. `porNome` devolve a LISTA e
   *    quem chama decide o que fazer com duas linhas — porque escolher e
   *    exatamente o que o §13 proibe ("registry/aliases/IDs, nao fuzzy
   *    matching irrestrito").
   *
   * 3. A comparacao de texto passa por `mkt.norm` nos DOIS lados. Normalizar
   *    so de um e o jeito de nunca encontrar nada; normalizar so na aplicacao
   *    e o jeito de divergir do indice unico que garante que um apelido nao
   *    resolve para duas coisas.
   */
  const entities = {
    /**
     * O id existe NESTE tenant? E a unica pergunta que verifica um id que o
     * modelo escreveu.
     *
     * Devolve o rotulo junto porque quem pergunta quase sempre precisa dizer
     * de volta o nome do que encontrou — e uma segunda ida ao banco para
     * buscar o nome do que acabou de ser confirmado seria custo sem resposta
     * nova.
     */
    async byId(org_id, entity_type, id) {
      if (entity_type === "channel") {
        const { rows } = await pool.query(
          `select $1::text as id, $1::text as label
             where $1::text = any (
               select unnest(enum_range(null::${S}.channel))::text)`, [id]);
        return rows[0] ?? null;
      }
      // Um id que nao e uuid nao chega a virar consulta: `where id = 'a marca'`
      // seria erro de tipo do Postgres, e erro de tipo vira 500 em vez de
      // "nao encontrei".
      if (!UUID.test(String(id ?? ""))) return null;

      if (entity_type === "brand") {
        const { rows } = await pool.query(
          `select id, name as label from ${S}.brands where org_id = $1 and id = $2`,
          [org_id, id]);
        return rows[0] ?? null;
      }
      if (entity_type === "content_version") {
        const { rows } = await pool.query(
          `select cv.id, ct.title as label
             from ${S}.content_versions cv
             join ${S}.contents ct on ct.id = cv.content_id
            where cv.org_id = $1 and cv.id = $2`, [org_id, id]);
        return rows[0] ?? null;
      }
      return null;
    },

    /**
     * Quem se chama assim, nesta organizacao. Igualdade normalizada, e a lista
     * inteira: duas linhas aqui e uma pergunta a fazer, nao um desempate.
     */
    async byNaturalKey(org_id, entity_type, raw) {
      const texto = String(raw ?? "");
      if (texto.trim() === "") return [];

      if (entity_type === "brand") {
        const { rows } = await pool.query(
          `select id, name as label from ${S}.brands
            where org_id = $1 and ${S}.norm(name) = ${S}.norm($2)
            limit 10`, [org_id, texto]);
        return rows;
      }
      if (entity_type === "content_version") {
        // O titulo e do conteudo, e um conteudo tem varias versoes. Quem pede
        // "o post do IPCA" quer a ULTIMA versao dele, entao a resolucao e por
        // conteudo e a versao vem da linha mais recente — uma por conteudo,
        // senao todo titulo com historico seria ambiguo por construcao.
        const { rows } = await pool.query(
          `select distinct on (ct.id) cv.id, ct.title as label
             from ${S}.contents ct
             join ${S}.content_versions cv on cv.content_id = ct.id
            where ct.org_id = $1 and ${S}.norm(ct.title) = ${S}.norm($2)
            order by ct.id, cv.version desc
            limit 10`, [org_id, texto]);
        return rows;
      }
      if (entity_type === "channel") {
        const { rows } = await pool.query(
          `select c::text as id, c::text as label
             from unnest(enum_range(null::${S}.channel)) c
            where ${S}.norm(c::text) = ${S}.norm($1)`, [texto]);
        return rows;
      }
      return [];
    },

    /**
     * O apelido registrado, se houver. Zero ou uma linha — nunca duas, e isso
     * e o indice unico que garante, nao esta consulta.
     */
    async byAlias(org_id, entity_type, raw) {
      const texto = String(raw ?? "");
      if (texto.trim() === "") return null;
      const { rows } = await pool.query(
        `select canonical_id as id, alias as label
           from ${S}.entity_aliases
          where org_id = $1 and entity_type = $2 and ${S}.norm(alias) = ${S}.norm($3)`,
        [org_id, entity_type, texto]);
      return rows[0] ?? null;
    },

    /**
     * Registra um apelido. Quem chama JA verificou que `canonical_id` existe
     * no tenant — esta porta nao confere, e por isso nao e chamada por nada
     * que receba id de fora sem passar por `byId` antes.
     *
     * Conflito nao vira update silencioso: apelido ja usado para outra coisa
     * e uma decisao de alguem, e sobrescrever apagaria a decisao anterior sem
     * que ninguem soubesse.
     */
    async addAlias({ org_id, entity_type, canonical_id, alias, actor_id = null }) {
      const { rows } = await pool.query(
        `insert into ${S}.entity_aliases
           (org_id, entity_type, canonical_id, alias, created_by_actor_id)
         values ($1,$2,$3,$4,$5)
         on conflict do nothing
         returning id`,
        [org_id, entity_type, canonical_id, alias, actor_id]);
      if (rows[0]) return { ok: true, id: rows[0].id };

      // `entities.byAlias`, e nao `this.byAlias`: quem desestrutura a porta
      // (`const { addAlias } = ports.entities`) perderia o `this` e receberia
      // um TypeError no lugar da recusa.
      const atual = await entities.byAlias(org_id, entity_type, alias);
      return atual?.id === canonical_id
        ? { ok: true, id: null, ja_existia: true }
        : { ok: false, reason: "ALIAS_TAKEN", canonical_id: atual?.id ?? null };
    },

    /** Os apelidos de uma entidade, para a tela que os mostra e os remove. */
    async aliasesOf(org_id, entity_type, canonical_id) {
      const { rows } = await pool.query(
        `select id, alias, created_by_actor_id, created_at
           from ${S}.entity_aliases
          where org_id = $1 and entity_type = $2 and canonical_id = $3
          order by created_at`, [org_id, entity_type, canonical_id]);
      return rows;
    },
  };

  return { routing, budget, registry, runs, policies, receipts, outbox, approvals,
           connections, variants, publishing, content, knowledge, authoring, entities };
}
