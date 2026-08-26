/**
 * Portas do workflow de publicacao contra Postgres.
 *
 * Ate aqui, `db` no publish-workflow existia so nos testes. O workflow era
 * provado contra um dublê e nao tinha como rodar contra banco nenhum — o
 * esqueleto estava desenhado, mas nao andava.
 *
 * Duas coisas neste arquivo merecem atencao:
 *
 * 1. `collectPublishFacts` e a fronteira entre o mundo e o Policy Engine.
 *    O engine nunca le texto livre nem consulta banco: ele recebe fatos ja
 *    reduzidos aos nomes do enum `olga://enums/policy-fact`. Se um fato novo
 *    precisar existir, ele entra no enum primeiro e aqui depois — nunca o
 *    contrario, senao a policy passa a depender de algo que nao esta declarado.
 *
 * 2. `markPublished` e as irmas escrevem estado do dominio E o evento no
 *    MESMO commit. E o padrao outbox: a mudanca de estado e a intencao de
 *    avisar nao podem divergir, e a unica forma de garantir isso e uma
 *    transacao, nao boa vontade.
 */
export function createWorkerPorts(pool, { schema = process.env.MKT_SCHEMA || "mkt" } = {}) {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error(`schema invalido: ${schema}`);
  const S = schema;

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
    } catch (e) { await client.query("rollback"); throw e; }
    finally { client.release(); }
  }

  /** Insere no outbox. Sempre recebe o client da transacao em curso. */
  async function enfileirar(c, { org_id, workspace_id, event_type, payload, trace_id }) {
    const { rows } = await c.query(
      `insert into ${S}.outbox (org_id, workspace_id, event_type, payload, trace_id)
       values ($1,$2,$3,$4::jsonb,$5) returning id`,
      [org_id, workspace_id ?? null, event_type, JSON.stringify(payload ?? {}), trace_id ?? null]);
    return rows[0].id;
  }

  return {
    async getCapability(capability_id, version) {
      const { rows } = await pool.query(
        `select capability_id, version, status::text, mode::text, side_effect::text,
                risk_tier::text, permissions, idempotency_required,
                idempotency_key_template, provider_adapter, timeout_ms, max_attempts,
                output_schema_ref
           from ${S}.capability_registry where capability_id = $1 and version = $2`,
        [capability_id, version]);
      const c = rows[0];
      if (!c) return null;
      return { ...c, idempotency: { required: c.idempotency_required, key_template: c.idempotency_key_template } };
    },

    /**
     * Reduz o estado do mundo aos fatos que a policy sabe avaliar.
     *
     * Uma consulta so: seis idas ao banco para decidir uma publicacao seriam
     * seis chances de ler o mundo em instantes diferentes e decidir sobre um
     * estado que nunca existiu junto.
     */
    async collectPublishFacts(event) {
      const { rows } = await pool.query(
        `select
           -- Conexao viva e o unico fato que nao depende do conteudo.
           (select conn.status = 'ACTIVE'
              from ${S}.connections conn where conn.id = $2) as channel_connected,

           (select cv.state::text
              from ${S}.content_versions cv where cv.id = $1) as content_status,

           (select cv.risk_tier::text
              from ${S}.content_versions cv where cv.id = $1) as risk_tier,

           -- O Brand Brain que vale e o ACTIVE da marca do conteudo.
           (select coalesce(max(bb.status::text), 'MISSING')
              from ${S}.content_versions cv
              join ${S}.contents ct on ct.id = cv.content_id
              join ${S}.brand_brain_versions bb on bb.brand_id = ct.brand_id
             where cv.id = $1 and bb.status = 'ACTIVE') as brand_brain_status,

           -- Cobertura de evidence: TODO claim material precisa de evidence.
           -- Sem claim material, a cobertura e trivialmente verdadeira.
           (select not exists (
              select 1 from ${S}.claims cl
               where cl.content_version_id = $1
                 and cl.material = true
                 and cardinality(cl.evidence_ids) = 0)) as evidence_coverage,

           -- Primeira publicacao do workspace: nenhuma ja publicada.
           (select not exists (
              select 1 from ${S}.publications p
               where p.workspace_id = $3 and p.status = 'PUBLISHED')) as workspace_first_publish,

           (select coalesce(array_agg(distinct cl.claim_type), '{}')
              from ${S}.claims cl where cl.content_version_id = $1) as claim_types
        `,
        [event.content_version_id, event.connection_id, event.workspace_id]);

      const f = rows[0] ?? {};
      return {
        // `channel_connected` volta NULL quando a conexao nem existe. NULL nao
        // e "false" para o engine, entao normalizamos aqui: conexao inexistente
        // e conexao desconectada, e a policy tem de bloquear igual.
        channel_connected: f.channel_connected === true,
        content_status: f.content_status ?? "MISSING",
        risk_tier: f.risk_tier ?? "LOW",
        brand_brain_status: f.brand_brain_status ?? "MISSING",
        evidence_coverage: f.evidence_coverage === true,
        workspace_first_publish: f.workspace_first_publish === true,
        claim_types: f.claim_types ?? [],
      };
    },

    async upsertWorkflowRun(r) {
      // Reexecucao do motor durável encontra o mesmo trace_id. Sem o guard,
      // cada replay criaria um run novo e a contagem de tentativas mentiria.
      const { rows } = await pool.query(
        `select id from ${S}.workflow_runs where trace_id = $1 and workflow_id = $2`,
        [r.trace_id, r.workflow_id]);
      if (rows[0]) {
        await pool.query(
          `update ${S}.workflow_runs set attempts = attempts + 1, updated_at = now() where id = $1`,
          [rows[0].id]);
        return rows[0].id;
      }
      const ins = await pool.query(
        `insert into ${S}.workflow_runs (org_id, workspace_id, workflow_id, trace_id, current_state, attempts)
         values ($1,$2,$3,$4,$5,1) returning id`,
        [r.org_id, r.workspace_id, r.workflow_id, r.trace_id, r.current_state ?? "RECEIVED"]);
      return ins.rows[0].id;
    },

    async updateWorkflowRun(trace_id, patch = {}) {
      await pool.query(
        `update ${S}.workflow_runs set
           current_state = coalesce($2, current_state),
           dead_lettered = coalesce($3, dead_lettered),
           last_reason_code = coalesce($4, last_reason_code),
           external_run_id = coalesce($5, external_run_id),
           updated_at = now()
         where trace_id = $1`,
        [trace_id, patch.current_state ?? null, patch.dead_lettered ?? null,
         patch.last_reason_code ?? null, patch.external_run_id ?? null]);
    },

    /**
     * Publicacao confirmada. Estado do dominio e evento no mesmo commit.
     *
     * `deduplicated` distingue "publicou agora" de "ja estava publicado e o
     * gateway devolveu o efeito anterior". Os dois marcam PUBLISHED; so o
     * primeiro emite evento, porque avisar duas vezes que algo foi publicado
     * e o mesmo problema que publicar duas vezes, um andar acima.
     */
    async markPublished(p) {
      return emTransacao(async (c) => {
        await c.query(
          `update ${S}.publications
              set status = 'PUBLISHED', published_at = now(), external_id = coalesce($2, external_id),
                  updated_at = now()
            where content_version_id = $1 and channel = $3::${S}.channel`,
          [p.content_version_id, p.external_id ?? null, p.channel]);

        // PUBLISHING -> PUBLISHED e a unica transicao legal daqui; a state
        // machine em trigger recusa qualquer outra.
        await c.query(
          `update ${S}.content_versions set state = 'PUBLISHING'
            where id = $1 and state in ('APPROVED','SCHEDULED')`, [p.content_version_id]);
        await c.query(
          `update ${S}.content_versions set state = 'PUBLISHED'
            where id = $1 and state = 'PUBLISHING'`, [p.content_version_id]);

        if (!p.deduplicated) {
          await enfileirar(c, {
            org_id: p.org_id, workspace_id: p.workspace_id,
            event_type: "olga/content.published",
            payload: { content_version_id: p.content_version_id, channel: p.channel,
                       external_id: p.external_id ?? null, receipt_id: p.receipt_id ?? null },
            trace_id: p.trace_id,
          });
        }
      });
    },

    /** Rejeicao de policy. Nao e falha tecnica: o conteudo volta para revisao. */
    async markBlocked(p) {
      return emTransacao(async (c) => {
        await c.query(
          `update ${S}.publications set status = 'CANCELLED', updated_at = now()
            where content_version_id = $1 and channel = $2::${S}.channel
              and status in ('SCHEDULED','PUBLISHING')`,
          [p.content_version_id, p.channel]);

        await enfileirar(c, {
          org_id: p.org_id, workspace_id: p.workspace_id,
          event_type: "olga/content.publish.blocked",
          payload: { content_version_id: p.content_version_id, channel: p.channel,
                     reason_code: p.reason_code, respondability: p.respondability ?? null },
          trace_id: p.trace_id,
        });
      });
    },

    async markFailed(p) {
      return emTransacao(async (c) => {
        await c.query(
          `update ${S}.publications set status = 'FAILED', updated_at = now()
            where content_version_id = $1 and channel = $2::${S}.channel`,
          [p.content_version_id, p.channel]);

        await enfileirar(c, {
          org_id: p.org_id, workspace_id: p.workspace_id,
          event_type: "olga/content.publish.failed",
          payload: { content_version_id: p.content_version_id, channel: p.channel,
                     reason_code: p.reason_code ?? null, error_class: p.error_class ?? null },
          trace_id: p.trace_id,
        });
      });
    },
  };
}
