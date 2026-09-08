/**
 * Implementacao das portas contra Postgres. O runtime nao conhece SQL;
 * conhece estas interfaces. Trocar Supabase por outro banco mexe aqui
 * e em nenhum outro lugar.
 *
 * O schema e injetavel para o codigo servir tanto `mkt` quanto `mkt_v2`.
 */
import { canTransition } from "@olga/contracts";

const json = (v) => (v == null ? null : JSON.stringify(v));

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
                   input_tokens, output_tokens, fallback_used, agent_run_id, capability_id }) {
      if (cost_cents == null) return;
      // `capability_id` nulo nao e lacuna: as chamadas do proprio loop
      // (resolver, planner, responder) nao rodam sob capability nenhuma, e e
      // essa distincao que separa custo de pensar de custo de produzir.
      await pool.query(
        `insert into ${S}.model_spend
           (org_id, workspace_id, task_class, provider, model, cost_cents,
            input_tokens, output_tokens, fallback_used, trace_id, agent_run_id, capability_id)
         values ($1,$2,$3::${S}.task_class,$4,$5,$6,$7,$8,coalesce($9,false),$10,$11,$12)`,
        [org_id, workspace_id, task_class, provider ?? null, model ?? null, cost_cents,
         input_tokens ?? null, output_tokens ?? null, fallback_used ?? false, trace_id,
         agent_run_id ?? null, capability_id ?? null]);
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

  /**
   * IAM: de quem e o token, e o que ele alcanca.
   *
   * Esta consulta morava escrita a mao em `apps/web/lib/auth.ts`, com o schema
   * `mkt` literal — enquanto todo o resto do sistema resolve o schema por
   * `MKT_SCHEMA`. Em producao, onde o alvo e `mkt_v2`, o login lia um schema
   * que nao e nosso: ninguem entrava, e a leitura batia em dados de terceiros.
   *
   * O consertavel nao foi trocar o prefixo: foi tirar SQL de um arquivo que
   * nao devia conhecer SQL. Quem resolve schema e este modulo, e so ele.
   */
  const iam = {
    async membershipsOf(user_id) {
      const { rows } = await pool.query(
        `select m.org_id, m.role::text as role, w.id as workspace_id
           from ${S}.memberships m
           join ${S}.workspaces w on w.org_id = m.org_id
          where m.user_id = $1
          order by w.created_at asc`, [user_id]);
      return rows;
    },
  };

  /**
   * Trilha de auditoria.
   *
   * `mkt.audit_events` existe desde a migration 0004, com RLS e teste de RLS —
   * e ate aqui nenhuma linha de codigo de producao escrevia nela. A tabela
   * estava correta e vazia, que e a forma mais silenciosa de uma auditoria
   * falhar: quem consulta ve zero eventos e conclui que nada aconteceu.
   *
   * `record` aceita um cliente por parametro justamente para poder entrar na
   * MESMA transacao do efeito que ela registra. Auditoria que pode divergir do
   * fato — porque uma commitou e a outra nao — nao e auditoria, e a diferenca
   * so aparece no dia em que alguem precisa dela.
   *
   * A RLS daquela tabela e append-only para o papel da aplicacao (ha teste):
   * nao existe update nem delete aqui de proposito, e nao e esquecimento.
   */
  const audit = {
    /**
     * @param {{ org_id: string, workspace_id?: string|null, actor_type: string,
     *           actor_id?: string|null, action: string, object_type: string,
     *           object_id?: string|null, object_version?: number|null,
     *           decision?: string|null, reason_codes?: string[],
     *           trace_id?: string|null, payload?: object }} e
     * @param {any} [client] cliente da transacao em curso; sem ele, o pool.
     */
    async record(e, client = pool) {
      await client.query(
        `insert into ${S}.audit_events
           (org_id, workspace_id, actor_type, actor_id, action, object_type,
            object_id, object_version, decision, reason_codes, trace_id, payload)
         values ($1,$2,$3::${S}.actor_type,$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12::jsonb,'{}'::jsonb))`,
        [e.org_id, e.workspace_id ?? null, e.actor_type, e.actor_id ?? null,
         e.action, e.object_type, e.object_id ?? null, e.object_version ?? null,
         e.decision ?? null, e.reason_codes ?? [], e.trace_id ?? null, json(e.payload ?? {})]);
    },
  };

  /**
   * Leitura do trace: do pedido ao efeito, numa linha do tempo.
   *
   * A Documentacao Mestra pede rastreabilidade do pedido ao efeito, e os dados
   * sempre existiram — `agent_runs`, `audit_events`, `action_receipts`,
   * `outbox` e `workflow_runs` compartilham `trace_id`, e ha teste provando
   * que a cadeia liga. O que nao existia era como olhar: a auditoria era uma
   * consulta SQL escrita a mao por quem soubesse as cinco tabelas.
   *
   * Cinco selects e um merge em memoria, e nao um UNION: as cinco tabelas tem
   * colunas diferentes e forcar todas na mesma forma dentro do SQL produziria
   * uma consulta que ninguem consegue ler nem manter. O volume por trace e de
   * dezenas de linhas — o custo esta na rede, nao no ordenamento.
   *
   * `org_id` entra em toda clausula. A RLS ja isola por organizacao e continua
   * valendo por baixo; o filtro aqui e para que a porta funcione igual sob
   * service_role, que tem BYPASSRLS.
   */
  const trace = {
    /** Os traces mais recentes do workspace, com o essencial de cada um. */
    async list(org_id, workspace_id, { limit = 50 } = {}) {
      const { rows } = await pool.query(
        `select r.trace_id,
                min(r.started_at) as started_at,
                max(r.agent_id) as agent_id,
                max(r.status::text) as status,
                max(r.respondability) as respondability,
                sum(coalesce(r.cost_cents, 0)) as cost_cents,
                (select count(*) from ${S}.action_receipts ar
                  where ar.trace_id = r.trace_id and ar.org_id = $1) as receipts
           from ${S}.agent_runs r
          where r.org_id = $1 and r.workspace_id = $2
          group by r.trace_id
          order by min(r.started_at) desc
          limit $3`, [org_id, workspace_id, limit]);
      return rows.map((r) => ({
        ...r,
        cost_cents: r.cost_cents == null ? null : Number(r.cost_cents),
        receipts: Number(r.receipts),
      }));
    },

    /**
     * A linha do tempo de um trace.
     *
     * Devolve os eventos ja ordenados por instante. Cada um traz `fonte` — a
     * tabela de onde veio — porque quem audita precisa saber se olha para uma
     * intencao registrada, um efeito com receipt ou um aviso no barramento.
     * Achatar isso num tipo so pouparia uma coluna e custaria a pergunta que
     * mais importa: isto aconteceu la fora, ou so aqui dentro?
     */
    async byTraceId(org_id, trace_id) {
      const [runs_, audit_, receipts_, outbox_, workflows_] = await Promise.all([
        pool.query(
          `select id, agent_id, agent_version, task_class, status::text as status,
                  respondability, reason_codes, autonomy_used, model,
                  input_tokens, output_tokens, cost_cents, latency_ms,
                  started_at, finished_at
             from ${S}.agent_runs where org_id = $1 and trace_id = $2
            order by started_at asc`, [org_id, trace_id]),
        pool.query(
          `select id, actor_type::text as actor_type, actor_id, action, object_type,
                  object_id, object_version, decision, reason_codes, payload, occurred_at
             from ${S}.audit_events where org_id = $1 and trace_id = $2
            order by occurred_at asc`, [org_id, trace_id]),
        pool.query(
          `select id, capability_id, capability_version, provider, external_id,
                  status::text as status, autonomy_used, approval_id, recorded_at
             from ${S}.action_receipts where org_id = $1 and trace_id = $2
            order by recorded_at asc`, [org_id, trace_id]),
        pool.query(
          `select id, event_type, payload, occurred_at, published_at, attempts
             from ${S}.outbox where org_id = $1 and trace_id = $2
            order by occurred_at asc`, [org_id, trace_id]),
        pool.query(
          `select id, workflow_id, external_run_id, current_state, attempts,
                  dead_lettered, last_reason_code, started_at, updated_at
             from ${S}.workflow_runs where org_id = $1 and trace_id = $2
            order by started_at asc`, [org_id, trace_id]),
      ]);

      const eventos = [
        ...runs_.rows.map((r) => ({
          fonte: "agent_run", instante: r.started_at,
          titulo: `${r.agent_id} executou`, status: r.status,
          reason_codes: r.reason_codes ?? [], detalhe: r,
        })),
        ...audit_.rows.map((r) => ({
          fonte: "audit_event", instante: r.occurred_at,
          titulo: r.action, status: r.decision,
          reason_codes: r.reason_codes ?? [], detalhe: r,
        })),
        ...receipts_.rows.map((r) => ({
          fonte: "receipt", instante: r.recorded_at,
          titulo: r.capability_id, status: r.status,
          reason_codes: [], detalhe: r,
        })),
        ...outbox_.rows.map((r) => ({
          fonte: "evento", instante: r.occurred_at,
          titulo: r.event_type, status: r.published_at ? "PUBLISHED" : "PENDING",
          reason_codes: [], detalhe: r,
        })),
        ...workflows_.rows.map((r) => ({
          fonte: "workflow", instante: r.started_at,
          titulo: r.workflow_id, status: r.current_state,
          reason_codes: r.last_reason_code ? [r.last_reason_code] : [],
          detalhe: r,
        })),
      ].sort((a, b) => new Date(a.instante) - new Date(b.instante));

      return {
        trace_id,
        // Vazio nao e erro: um trace_id que ninguem reconhece e resposta
        // legitima, e distingui-la de "existe e nao tem nada" e trabalho da
        // tela, nao da porta.
        encontrado: eventos.length > 0,
        eventos,
      };
    },
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
        const resultado = parear(par[0]);

        // Na mesma transacao do efeito: uma decisao que commitou sem deixar
        // rastro, ou um rastro de decisao que nao aconteceu, seriam os dois
        // piores estados possiveis desta tabela.
        await audit.record({
          org_id,
          workspace_id: resultado?.approval?.workspace_id ?? null,
          actor_type: "user",
          actor_id: decided_by,
          action: "approval.decided",
          object_type: "content_version",
          object_id: rows[0].subject_id,
          object_version: resultado?.content?.version ?? null,
          decision,
          trace_id,
          payload: { approval_id, comment },
        }, c);

        return resultado;
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
    /**
     * Grava a conexao consentida no navegador, ou atualiza a que ja existe.
     *
     * Reconectar o mesmo canal e o caso normal, e nao excecao: o token longo
     * da Meta dura 60 dias. A constraint `unique (workspace_id, channel,
     * external_account_id)` diz o que e "a mesma conexao", e o upsert obedece
     * a ela em vez de inventar outro criterio.
     *
     * `secret_ref` entra; token nao passa por esta funcao em nenhum caminho.
     * Nao e disciplina: nao existe parametro para ele.
     */
    /**
     * @param {{ org_id: string, workspace_id: string, channel: string, provider: string,
     *           external_account_id: string, display_name?: string|null, secret_ref: string,
     *           scopes?: string[], expires_at?: string|null }} conexao
     */
    async upsert({ org_id, workspace_id, channel, provider, external_account_id,
                   display_name = null, secret_ref, scopes = [], expires_at = null }) {
      if (!secret_ref) {
        const e = new Error("conexao sem secret_ref");
        e.reason_code = "CHANNEL_NOT_CONNECTED";
        throw e;
      }
      const { rows } = await pool.query(
        `insert into ${S}.connections
           (org_id, workspace_id, channel, provider, external_account_id,
            display_name, status, secret_ref, scopes, expires_at, last_checked_at)
         values ($1,$2,$3::${S}.channel,$4,$5,$6,'ACTIVE',$7,$8,$9, now())
         on conflict (workspace_id, channel, external_account_id) do update
           set display_name = excluded.display_name,
               status = 'ACTIVE',
               secret_ref = excluded.secret_ref,
               scopes = excluded.scopes,
               expires_at = excluded.expires_at,
               last_checked_at = now()
         returning id, channel::text as channel, external_account_id,
                   display_name, status::text as status, expires_at`,
        [org_id, workspace_id, channel, provider, external_account_id,
         display_name, secret_ref, scopes, expires_at]);
      return rows[0];
    },

    /**
     * Revoga uma conexao.
     *
     * Marca REVOKED em vez de apagar: `publications` aponta para `connections`
     * com foreign key, e apagar a linha levaria junto a resposta para "por
     * onde aquele post saiu". O segredo, esse sim, sai do vault — quem chama
     * cuida disso, porque so ele conhece o vault em uso.
     */
    async revoke(org_id, connection_id) {
      // O CTE existe porque RETURNING devolve o valor NOVO, e o que interessa
      // aqui e o ANTIGO: quem chama precisa do secret_ref para apagar o
      // segredo no vault, e ele acabou de virar null.
      const { rows } = await pool.query(
        `with antes as (
           select id, secret_ref from ${S}.connections
            where id = $1 and org_id = $2 and status <> 'REVOKED'
         ), feito as (
           update ${S}.connections c
              set status = 'REVOKED', secret_ref = null, last_checked_at = now()
             from antes where c.id = antes.id
           returning c.id
         )
         select antes.id, antes.secret_ref from antes join feito on feito.id = antes.id`,
        [connection_id, org_id]);
      return rows[0] ?? null;
    },

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
           -- O trace da execucao que criou esta versao. E o unico caminho da
           -- listagem para a auditoria: sem ele, quem ve um rascunho estranho
           -- nao tem como chegar ao pedido que o gerou.
           cv.trace_id,
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

    /**
     * O cadastro da marca: nome e site.
     *
     * Existe para o compilador de brand.extract_from_url, e por isso e uma
     * consulta e nao um campo de contexto. A URL que o servidor vai buscar nao
     * pode vir do modelo nem do texto do usuario — e exatamente o vetor que a
     * defesa de SSRF do web_fetch existe para conter, e o melhor jeito de
     * conter e nao deixar chegar la.
     */
    async brandSite(org_id, brand_id) {
      const { rows } = await pool.query(
        `select id as brand_id, name, website_url from ${S}.brands
          where id = $2 and org_id = $1`, [org_id, brand_id]);
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
     * Todas as marcas do workspace com as versoes de Brand Brain de cada uma.
     *
     * E a consulta da tela de revisao: mostra a ACTIVE ao lado das CANDIDATE
     * para quem vai decidir ver as duas juntas. Uma tela que mostrasse so a
     * candidata pediria uma promocao no escuro.
     */
    async brandBrainBoard(org_id, workspace_id) {
      const { rows } = await pool.query(
        `select b.id as brand_id, b.name as brand_name, b.website_url,
                bb.id as version_id, bb.version, bb.status::text as status,
                bb.identity, bb.tone, bb.claims_allowed, bb.prohibitions,
                bb.disclaimers, bb.source_refs,
                bb.created_at, bb.activated_at, bb.superseded_at,
                bb.created_by_actor_type::text as criado_por_tipo,
                bb.activated_by_actor_id as ativado_por
           from ${S}.brands b
           left join ${S}.brand_brain_versions bb
             on bb.brand_id = b.id and bb.org_id = b.org_id
            and bb.status in ('ACTIVE','CANDIDATE')
          where b.org_id = $1 and b.workspace_id = $2
          order by b.name, bb.status, bb.version desc`,
        [org_id, workspace_id]);
      return rows;
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
     * Registra que a revisao de IA aconteceu: DRAFT -> AI_REVIEW.
     *
     * Este metodo existe porque essa passagem nao existia em lugar nenhum, e
     * sem ela conteudo criado por agente ficava preso em DRAFT para sempre —
     * `approval.request` exige AI_REVIEW, e a state machine nao deixa pular.
     *
     * Tres recusas deliberadas, e nenhuma delas e erro:
     *
     * 1. So promove a partir de DRAFT. Conteudo que ja passou por olho humano
     *    nao volta para a fila da IA porque um precheck rodou de novo.
     * 2. Nao valida a transicao com um `if` proprio: quem decide e o trigger
     *    `assert_content_transition`. Um segundo julgamento aqui seria a
     *    mesma regra em dois lugares, e um dia eles discordariam.
     * 3. Devolve o que aconteceu em vez de levantar quando nada acontece.
     *    "Ja estava em AI_REVIEW" e resultado legitimo de uma reexecucao, nao
     *    falha — e o loop pode reexecutar um passo.
     */
    async markAiReviewed({ org_id, content_version_id }) {
      const { rows } = await pool.query(
        `update ${S}.content_versions
            set state = 'AI_REVIEW'
          where id = $1 and org_id = $2 and state = 'DRAFT'
          returning id, state::text as state`,
        [content_version_id, org_id]);

      if (rows[0]) return { transicionou: true, state: rows[0].state };

      const atual = await pool.query(
        `select state::text as state from ${S}.content_versions
          where id = $1 and org_id = $2`, [content_version_id, org_id]);
      if (!atual.rows[0]) {
        const e = new Error("versao de conteudo inexistente");
        e.reason_code = "SCHEMA_VALIDATION_FAILED";
        throw e;
      }
      return { transicionou: false, state: atual.rows[0].state };
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
                               prohibitions, disclaimers, source_refs, actor_id,
                               workspace_id = null, fonte = null }) {
      return emTransacao(async (c) => {
        // A fonte vira EVIDENCE na mesma transacao, e source_refs aponta para
        // a linha criada. Gravar a versao primeiro e a evidence depois abriria
        // um instante em que o Brand Brain cita procedencia que nao existe —
        // e procedencia que nao da para abrir e o mesmo que nenhuma.
        let refs = source_refs ?? [];
        if (fonte?.url && fonte?.hash && workspace_id) {
          const ev = await c.query(
            `insert into ${S}.evidence (org_id, workspace_id, source_kind, locator, hash, fact, quality)
             values ($1,$2,'SOURCE_ARTIFACT',$3,$4,$5,'MEDIUM') returning id`,
            [org_id, workspace_id, fonte.url, fonte.hash,
             `Pagina de ${fonte.url} lida em ${new Date().toISOString()}`]);
          refs = [...refs, { evidence_id: ev.rows[0].id, url: fonte.url, hash: fonte.hash }];
        }

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
           json(disclaimers), json(refs), actor_id ?? null]);
        return { ...rows[0], source_refs: refs };
      });
    },
  };

  /**
   * Governanca: os atos que só uma pessoa pode praticar.
   *
   * Separado de `authoring` porque a diferenca importa. `authoring` e o que o
   * AGENTE escreve — e tudo o que ele escreve nasce CANDIDATE ou DRAFT. Aqui
   * ficam as transicoes que exigem um humano assumindo responsabilidade.
   *
   * Se as duas famílias morassem no mesmo objeto, um dia alguem chamaria
   * `promoteBrandVersion` de dentro de uma capability sem perceber que estava
   * deixando o agente promover o proprio trabalho.
   */
  const governance = {
    /**
     * Promove uma versao CANDIDATE do Brand Brain para ACTIVE.
     *
     * Tres coisas numa transacao so, e a ordem importa:
     *
     *   1. a ACTIVE atual vira DEPRECATED e ganha superseded_at
     *   2. a candidata vira ACTIVE, com activated_at e QUEM promoveu
     *
     * O indice `brand_brain_one_active` garante uma ACTIVE por marca. Fazer o
     * passo 2 antes do 1 estouraria nele — e e bom que estoure: e o banco
     * dizendo que duas versoes ativas nunca podem coexistir, nem por um
     * instante dentro da transacao.
     *
     * Recusa promover o que nao e CANDIDATE. Promover um DRAFT seria pular a
     * proposta; promover uma DEPRECATED de volta seria reverter sem dizer que
     * estava revertendo — quem quer voltar propoe de novo, e o rastro mostra.
     */
    async promoteBrandVersion({ org_id, brand_id, version_id, actor_id, actor_type = "user" }) {
      return emTransacao(async (c) => {
        const alvo = await c.query(
          `select id, version, status::text as status from ${S}.brand_brain_versions
            where id = $1 and org_id = $2 and brand_id = $3 for update`,
          [version_id, org_id, brand_id]);

        if (!alvo.rows[0]) {
          const e = new Error("versao de Brand Brain inexistente nesta marca");
          e.reason_code = "NORMALIZATION_FAILED";
          throw e;
        }
        if (alvo.rows[0].status !== "CANDIDATE") {
          const e = new Error(
            `so promovo versao CANDIDATE; esta esta ${alvo.rows[0].status}`);
          e.reason_code = "UNSUPPORTED_VALUE";
          throw e;
        }

        const anterior = await c.query(
          `update ${S}.brand_brain_versions
              set status = 'DEPRECATED', superseded_at = now()
            where brand_id = $1 and org_id = $2 and status = 'ACTIVE'
            returning id, version`, [brand_id, org_id]);

        const nova = await c.query(
          `update ${S}.brand_brain_versions
              set status = 'ACTIVE', activated_at = now(),
                  activated_by_actor_type = $4::${S}.actor_type,
                  activated_by_actor_id = $5
            where id = $1 and org_id = $2 and brand_id = $3
            returning id, version, status::text as status, activated_at`,
          [version_id, org_id, brand_id, actor_type, actor_id]);

        // O momento em que um humano assume responsabilidade por um artefato
        // que o agente escreveu. `activated_by` na propria versao diz QUEM;
        // aqui fica o QUANDO em relacao a tudo o mais, no mesmo trace.
        await audit.record({
          org_id,
          actor_type,
          actor_id,
          action: "brand_brain.promoted",
          object_type: "brand_brain_version",
          object_id: version_id,
          object_version: nova.rows[0]?.version ?? null,
          decision: "ACTIVE",
          payload: {
            brand_id,
            substituida: anterior.rows[0]?.id ?? null,
          },
        }, c);

        return {
          promovida: nova.rows[0],
          substituida: anterior.rows[0] ?? null,
        };
      });
    },
  };

  return { routing, budget, registry, iam, audit, trace, runs, policies, receipts, outbox, approvals,
           connections, variants, publishing, content, knowledge, authoring, governance };
}
