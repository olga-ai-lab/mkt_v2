/**
 * Implementacao das portas contra Postgres. O runtime nao conhece SQL;
 * conhece estas quatro interfaces. Trocar Supabase por outro banco mexe aqui
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

  return { routing, budget, registry, runs, policies, receipts };
}
