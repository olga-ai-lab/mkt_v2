/**
 * Implementacao das portas contra Postgres. O runtime nao conhece SQL;
 * conhece estas interfaces. Trocar Supabase por outro banco mexe aqui
 * e em nenhum outro lugar.
 *
 * O schema e injetavel para o codigo servir tanto `mkt` quanto `mkt_v2`.
 */
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
    async getAgent(agent_id) {
      const { rows } = await pool.query(
        `select agent_id, version, status::text, mission, baseline_autonomy, max_autonomy,
                capabilities, model_profile
           from ${S}.agent_registry
          where agent_id = $1
          order by version desc limit 1`, [agent_id]);
      return rows[0] ?? null;
    },
    async getCapability(capability_id, version) {
      const { rows } = await pool.query(
        `select capability_id, version, status::text, mode::text, side_effect::text,
                risk_tier::text, permissions, idempotency_required,
                idempotency_key_template, provider_adapter, timeout_ms, max_attempts
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
           (id, org_id, workspace_id, trace_id, agent_id, agent_version, task_class, status, started_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8::${S}.run_status,$9)`,
        [r.id, r.org_id, r.workspace_id, r.trace_id, r.agent_id, r.agent_version,
         r.task_class, r.status, r.started_at]);
    },
    async finish(id, p) {
      await pool.query(
        `update ${S}.agent_runs set
           status = coalesce($2::${S}.run_status, status),
           respondability = coalesce($3, respondability),
           reason_codes = coalesce($4, reason_codes),
           autonomy_used = coalesce($5, autonomy_used),
           model = coalesce($6, model),
           input_tokens = coalesce($7, input_tokens),
           output_tokens = coalesce($8, output_tokens),
           cost_cents = coalesce($9, cost_cents),
           latency_ms = coalesce($10, latency_ms),
           finished_at = coalesce($11::timestamptz, now())
         where id = $1`,
        [id, p.status ?? null, p.respondability ?? null, p.reason_codes ?? null,
         p.autonomy_used ?? null, p.model ?? null, p.input_tokens ?? null,
         p.output_tokens ?? null, p.cost_cents ?? null, p.latency_ms ?? null, p.finished_at ?? null]);
    },
  };

  const policies = {
    async listActive(org_id) {
      const { rows } = await pool.query(
        `select policy_id, version, status::text, priority, scope, conditions,
                effect::text, max_autonomy, reason_code, message_key
           from ${S}.rule_policies
          where status = 'ACTIVE' and (org_id is null or org_id = $1)
          order by priority asc`, [org_id]);
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

  return { routing, budget, registry, runs, policies, receipts, outbox, approvals,
           connections, variants };
}
