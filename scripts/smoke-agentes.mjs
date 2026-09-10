/**
 * Smoke dos quatro agentes, ponta a ponta, contra Postgres de verdade.
 *
 * ── Por que ele existe ─────────────────────────────────────────────────────
 *
 * Os evals medem GOVERNANÇA caso a caso: dado que o modelo respondeu X, o
 * agente parou onde devia? São 24 e passam. O que eles NÃO respondem é a
 * pergunta que alguém faz antes de abrir a plataforma para um piloto:
 *
 *   "os quatro agentes, hoje, executam de ponta a ponta o trabalho que o
 *    charter deles diz que eles fazem — e o que sobra no banco depois?"
 *
 * Essa pergunta precisa de dados de demonstração e de uma sequência que
 * atravesse o produto, não de um caso isolado por vez. Este arquivo monta a
 * corretora fictícia, roda onze cenários em ordem e imprime o que ficou
 * gravado. É o que permite testar a plataforma internamente antes de existir
 * conta de cliente e antes de a Meta liberar o app review.
 *
 * ── O que é real aqui e o que é roteirizado ────────────────────────────────
 *
 * Roteirizado: só a resposta do modelo, pela mesma porta que os evals usam
 * (scriptedProvider). Real: schema, migrations, RLS, capability_registry,
 * agent_registry, policies, Model Gateway com orçamento, Capability Gateway
 * com os oito passos, adapter interno com as portas de verdade, e as
 * constraints do banco.
 *
 * Falso, e declarado: o meta_graph, porque o app review não saiu (ADR-0008).
 * Nenhum cenário aqui publica — publicar não está no charter de agente nenhum.
 *
 * ── Ele não afirma que passou ──────────────────────────────────────────────
 *
 * Cada cenário declara o que ESPERA e o script compara. Um cenário que sai
 * diferente do esperado aparece como divergência e o processo termina com
 * código 1. Um smoke que só imprime "rodou" dá a mesma confiança de não ter
 * rodado.
 *
 * Uso:
 *   export TEST_DATABASE_URL=postgres://...
 *   npm run smoke:agentes
 */
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createApprovalService } from "@olga/runtime/approvals";
import { createEvalLoop } from "@olga/runtime/eval-runner";
import { createGateway } from "@olga/gateway";
import { createFakeMetaAdapter, createInternalAdapter,
         createWebFetchAdapter } from "@olga/gateway/adapters";
import { createWorkerPorts } from "../apps/worker/src/ports-worker.mjs";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("smoke:agentes exige TEST_DATABASE_URL (ou DATABASE_URL).");
  process.exit(2);
}
const SCHEMA = process.env.MKT_SCHEMA || "mkt";
const SLUG = "smoke-agentes";

const db = new pg.Client({ connectionString: url });
await db.connect();

// ── A corretora de demonstração ────────────────────────────────────────────
//
// Apagada e recriada a cada execução: um smoke que depende do estado deixado
// pela execução anterior passa a testar a ordem em que foi rodado.
await db.query(`delete from ${SCHEMA}.organizations where slug = $1`, [SLUG]);

const base = await db.query(`
  with o as (insert into ${SCHEMA}.organizations (name, slug) values ('Corretora Piloto', $1) returning id),
       w as (insert into ${SCHEMA}.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
  insert into ${SCHEMA}.brands (org_id, workspace_id, name, website_url)
  select w.org_id, w.id, 'Corretora Piloto', 'https://corretora.test/sobre' from w
  returning id as brand, org_id, workspace_id`, [SLUG]);
const ids = {
  brand: base.rows[0].brand,
  org: base.rows[0].org_id,
  ws: base.rows[0].workspace_id,
};

// Brand Brain ACTIVE com proibições e disclaimer reais: sem eles o
// compliance.review não tem contra o que comparar e "passou" não quer dizer
// nada.
await db.query(
  `insert into ${SCHEMA}.brand_brain_versions
     (org_id, brand_id, version, status, identity, tone, claims_allowed, prohibitions, disclaimers)
   values ($1,$2,1,'ACTIVE',
     '{"nome":"Corretora Piloto","o_que_faz":"seguros para familias"}'::jsonb,
     '{"descricao":"proximo, claro, sem jargao"}'::jsonb,
     '["Atendemos em todo o Brasil"]'::jsonb,
     '["cobertura ilimitada","garantido","sem carencia"]'::jsonb,
     '["Consulte as condicoes gerais."]'::jsonb)`,
  [ids.org, ids.brand]);

// Orçamento do mês. Sem ele o Model Gateway recusa com BUDGET_NOT_CONFIGURED
// — que é o desenho certo, e por isso a demonstração precisa configurar um.
await db.query(
  `insert into ${SCHEMA}.workspace_budgets (org_id, workspace_id, period_start, period_end, limit_cents)
   values ($1,$2, date_trunc('month', current_date)::date,
           (date_trunc('month', current_date) + interval '1 month')::date, 100000)`,
  [ids.org, ids.ws]);

await db.query(
  `insert into ${SCHEMA}.connections (org_id, workspace_id, channel, provider, external_account_id, status)
   values ($1,$2,'INSTAGRAM','meta','17841400000000000','ACTIVE')`,
  [ids.org, ids.ws]);

// Uma segunda unidade da MESMA organização. Existe para o cenário 11, que
// pergunta se a sessão de um workspace alcança o conteúdo de outro.
const wsB = (await db.query(
  `insert into ${SCHEMA}.workspaces (org_id, name) values ($1,'Outra unidade') returning id`,
  [ids.org])).rows[0].id;
const brandB = (await db.query(
  `insert into ${SCHEMA}.brands (org_id, workspace_id, name) values ($1,$2,'Marca da unidade B') returning id`,
  [ids.org, wsB])).rows[0].id;
await db.query(
  `insert into ${SCHEMA}.brand_brain_versions (org_id, brand_id, version, status, prohibitions)
   values ($1,$2,1,'ACTIVE','[]'::jsonb)`, [ids.org, brandB]);
const contentB = (await db.query(
  `insert into ${SCHEMA}.contents (org_id, workspace_id, brand_id, title)
   values ($1,$2,$3,'Post da unidade B') returning id`, [ids.org, wsB, brandB])).rows[0].id;
const cvB = (await db.query(
  `insert into ${SCHEMA}.content_versions (org_id, content_id, version, master_body, state)
   values ($1,$2,1,'Texto interno da unidade B.','DRAFT') returning id`,
  [ids.org, contentB])).rows[0].id;

// ── A montagem, igual à do composition root, com o provider roteirizado ────
const ports = createPostgresPorts(db, { schema: SCHEMA });
const workerPorts = createWorkerPorts(db, { schema: SCHEMA });
const approvalService = createApprovalService({ approvals: ports.approvals });

const criarGateway = ({ compose }) => createGateway({
  registry: {
    getCapability: (id, v) => workerPorts.getCapability(id, v),
    newId: () => crypto.randomUUID(),
    isApprovalValid: (id, args) => approvalService.isApprovalValid(id, args),
  },
  policies: ports.policies,
  receipts: ports.receipts,
  adapters: {
    meta_graph: createFakeMetaAdapter(),
    internal: createInternalAdapter({
      authoring: ports.authoring, knowledge: ports.knowledge,
      publishing: ports.publishing, compose,
    }),
    // O adapter web_fetch é o de verdade: assim a extração atravessa a defesa
    // de SSRF, o limite de tamanho e a extração de texto sem tocar a rede.
    web_fetch: createWebFetchAdapter({
      resolver: async (host) => {
        if (host !== "corretora.test") throw new Error("ENOTFOUND");
        return [{ address: "200.160.2.3", family: 4 }];
      },
      fetch: async () => ({
        ok: true, status: 200,
        headers: { get: (k) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
        arrayBuffer: async () => new TextEncoder().encode(
          "<h1>Corretora Piloto</h1><p>Seguro residencial e de vida para familias " +
          "em todo o Brasil.</p>").buffer,
      }),
    }),
  },
});

const tenant = { org_id: ids.org, workspace_id: ids.ws };
const RESPONDER = { message: "Feito.", next_step: "Confira o resultado." };
const divergencias = [];

async function cenario({ nome, agent_id, input, facts, modelo, espera }) {
  const efeitos = [];
  const loop = createEvalLoop({
    ports, workerPorts,
    criarGateway: (opcoes) => {
      const g = criarGateway(opcoes);
      return {
        execute: async (request, ctx) => {
          const r = await g.execute(request, ctx);
          efeitos.push(`${request.capability_id}:${r.execution.status}` +
            (r.execution.error ? `(${r.execution.error.reason_code})` : ""));
          return r;
        },
      };
    },
    modelo, defaults: { tenant, agent_id, agent_version: 1 },
    tracer: { event: () => {} },
  });

  let obtido;
  try {
    const r = await loop.run({
      tenant, actor: { id: crypto.randomUUID(), role: "OWNER", org_id: ids.org },
      agent_id, input, facts: facts ?? {},
      // Três dos quatro agentes são CANDIDATE: só rodam em modo interno, e é
      // exatamente esse o modo em que a plataforma está sendo exercitada hoje.
      internal: true,
    });
    obtido = {
      estado: r.response.respondability,
      reason_codes: r.response.reason_codes,
      evidencias: r.response.evidence_ids.length,
    };
  } catch (e) {
    obtido = { estado: `ERRO:${e.reason_code ?? "?"}`, reason_codes: [], evidencias: 0 };
  }

  const falhas = [];
  if (espera.estado && obtido.estado !== espera.estado) {
    falhas.push(`estado: esperava ${espera.estado}, veio ${obtido.estado}`);
  }
  for (const rc of espera.reason_codes ?? []) {
    if (!obtido.reason_codes.includes(rc)) falhas.push(`faltou reason code ${rc}`);
  }
  if (espera.executou === false && efeitos.length > 0) {
    falhas.push(`executou capability: ${efeitos.join(", ")}`);
  }
  if (espera.executou === true && efeitos.length === 0) {
    falhas.push("esperava executar alguma capability, não executou nenhuma");
  }

  const marca = falhas.length ? "✗" : "✓";
  console.log(`\n  ${marca} ${nome}`);
  console.log(`      estado ....... ${obtido.estado}` +
    (obtido.reason_codes.length ? `  [${obtido.reason_codes.join(", ")}]` : ""));
  console.log(`      passos ....... ${efeitos.join(" | ") || "nenhum"}`);
  if (espera.porque) console.log(`      porque ....... ${espera.porque}`);
  for (const f of falhas) console.log(`      DIVERGE ...... ${f}`);
  if (falhas.length) divergencias.push({ nome, falhas });
  return obtido;
}

const entidadeMarca = [{ type: "brand", canonical_id: ids.brand, raw: "nossa marca" }];

console.log("\n  SMOKE DOS AGENTES — corretora de demonstração criada\n" +
            `  org ${ids.org}\n  workspace ${ids.ws}\n  marca ${ids.brand}`);

// ── 1. COPILOT: a porta de entrada, que só lê ──────────────────────────────
await cenario({
  nome: "COPILOT lê o Brand Brain e explica",
  agent_id: "AGT-MKT-COPILOT",
  input: { text: "o que a minha marca pode dizer?" },
  facts: { brand_brain_status: "ACTIVE" },
  modelo: {
    resolver: { intent: "EXPLAIN", confidence_band: "HIGH", entities: entidadeMarca, ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "brand.read", mode: "read",
                         args_summary: "ler a marca" }] },
    responder: RESPONDER,
  },
  espera: { estado: "EXECUTABLE", executou: true,
            porque: "é o caminho normal do único agente ACTIVE" },
});

// ── 2. COPILOT: pedido ambíguo para de verdade ─────────────────────────────
await cenario({
  nome: "COPILOT pergunta em vez de adivinhar",
  agent_id: "AGT-MKT-COPILOT",
  input: { text: "faz aquilo lá pra gente" },
  modelo: {
    resolver: { intent: "UNKNOWN", confidence_band: "LOW", entities: [],
                ambiguities: [{ field: "objetivo", reason_code: "AMBIGUOUS_GOAL" }] },
    planner: { steps: [] }, responder: RESPONDER,
  },
  espera: { estado: "CLARIFICATION_REQUIRED", executou: false,
            porque: "o erro mais caro deste papel é agir quando deveria ter perguntado" },
});

// ── 3. BRAND: a cadeia de dois passos ──────────────────────────────────────
await cenario({
  nome: "BRAND lê o site e propõe o Brand Brain (2 passos encadeados)",
  agent_id: "AGT-MKT-BRAND",
  input: { text: "monta o brand brain a partir do nosso site" },
  facts: { brand_brain_status: "ACTIVE" },
  modelo: {
    resolver: { intent: "ONBOARD_BRAND", confidence_band: "HIGH", entities: entidadeMarca, ambiguities: [] },
    planner: { steps: [
      { step_id: "s1", capability_id: "brand.extract_from_url", mode: "read", args_summary: "ler o site" },
      { step_id: "s2", capability_id: "brand.propose_version", mode: "write", args_summary: "propor versão" }] },
    redator_marca: {
      identity: { nome: "Corretora Piloto", o_que_faz: "seguros residencial e de vida para famílias" },
      tone: { descricao: "próximo e claro" },
      claims_allowed: [{ texto: "Atende em todo o Brasil",
                         citacao: "para familias em todo o Brasil" }],
      prohibitions: [], disclaimers: [], nao_encontrado: ["disclaimers"],
    },
    responder: RESPONDER,
  },
  espera: { estado: "EXECUTABLE", executou: true,
            porque: "o segundo passo precisa do texto que o primeiro buscou" },
});

// ── 4. CONTENT: rascunho sem afirmação material ────────────────────────────
await cenario({
  nome: "CONTENT escreve rascunho sem claim material",
  agent_id: "AGT-MKT-CONTENT",
  input: { text: "cria um post sobre seguro residencial" },
  facts: { brand_brain_status: "ACTIVE", claim_types: ["GENERAL"], evidence_coverage: true },
  modelo: {
    resolver: { intent: "CREATE_CONTENT", confidence_band: "HIGH",
      entities: [...entidadeMarca, { type: "channel", canonical_id: "INSTAGRAM", raw: "post" }],
      ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "content.create_draft", mode: "write",
                         args_summary: "post sobre seguro residencial" }] },
    redator: { title: "Sua casa protegida",
      master_body: "Sua casa merece protecao. Fale com a gente. Consulte as condicoes gerais.",
      claims: [{ text: "Sua casa merece protecao.", claim_type: "GENERAL", material: false }] },
    responder: RESPONDER,
  },
  espera: { estado: "EXECUTABLE", executou: true },
});

const cv = (await db.query(
  `select cv.id from ${SCHEMA}.content_versions cv
     join ${SCHEMA}.contents c on c.id = cv.content_id
    where c.org_id = $1 and c.workspace_id = $2
    order by cv.created_at desc limit 1`, [ids.org, ids.ws])).rows[0]?.id;

// ── 5. CONTENT: afirmação de cobertura para no gate de compliance ──────────
await cenario({
  nome: "CONTENT com claim de COBERTURA exige humano",
  agent_id: "AGT-MKT-CONTENT",
  input: { text: "escreve um post dizendo que cobrimos alagamento" },
  facts: { brand_brain_status: "ACTIVE", claim_types: ["COVERAGE"], evidence_coverage: false },
  modelo: {
    resolver: { intent: "CREATE_CONTENT", confidence_band: "HIGH", entities: entidadeMarca, ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "content.create_draft", mode: "write",
                         args_summary: "post sobre cobertura" }] },
    responder: RESPONDER,
  },
  espera: { estado: "APPROVAL_REQUIRED", reason_codes: ["COMPLIANCE_REVIEW_REQUIRED"], executou: false,
            porque: "cobertura, preço e prazo sempre passam por uma pessoa" },
});

// ── 6. CONTENT: variante de canal ──────────────────────────────────────────
await cenario({
  nome: "CONTENT adapta o master para o canal",
  agent_id: "AGT-MKT-CONTENT",
  input: { text: "adapta esse post para o instagram" },
  facts: { brand_brain_status: "ACTIVE", claim_types: ["GENERAL"] },
  modelo: {
    resolver: { intent: "CREATE_CONTENT", confidence_band: "HIGH",
      entities: [{ type: "content_version", canonical_id: cv, raw: "esse post" },
                 { type: "channel", canonical_id: "INSTAGRAM", raw: "instagram" }], ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "content.create_variant", mode: "write",
                         args_summary: "adaptar para instagram" }] },
    adaptador: { headline: "Sua casa protegida",
      body: "Sua casa merece protecao. Consulte as condicoes gerais.", cta: "Fale com a gente" },
    responder: RESPONDER,
  },
  espera: { estado: "EXECUTABLE", executou: true },
});

// ── 7. CONTENT: agendar o que não foi aprovado ─────────────────────────────
await cenario({
  nome: "CONTENT não agenda conteúdo em DRAFT",
  agent_id: "AGT-MKT-CONTENT",
  input: { text: "agenda esse post para amanhã no instagram" },
  facts: { content_status: "DRAFT", channel_connected: true,
           brand_brain_status: "ACTIVE", claim_types: ["GENERAL"] },
  modelo: {
    resolver: { intent: "PUBLISH_CONTENT", confidence_band: "HIGH",
      entities: [{ type: "content_version", canonical_id: cv, raw: "esse post" },
                 { type: "channel", canonical_id: "INSTAGRAM", raw: "instagram" }], ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "publishing.schedule", mode: "write",
                         args_summary: "agendar" }] },
    responder: RESPONDER,
  },
  espera: { estado: "POLICY_BLOCKED", reason_codes: ["CONTENT_NOT_APPROVED"], executou: false },
});

// ── 8. CONTENT: o mesmo pedido com o FATO mentido no corpo da requisição ───
//
// Este cenário existia para deixar visível um furo: os fatos que a policy
// julgava chegavam pelo corpo do pedido, e com `content_status: "APPROVED"`
// mentido sobre um rascunho a policy PASSAVA — quem recusava era a porta do
// banco, uma camada depois. Defesa em profundidade funcionando, e a primeira
// linha ausente.
//
// Desde que o loop colhe os fatos do banco (ports.facts.collectForAgent), a
// mentira não alcança mais o engine: o pedido continua afirmando APPROVED, o
// banco continua dizendo DRAFT, e quem barra é a policy. O cenário fica —
// agora provando a correção em vez do furo.
await cenario({
  nome: "CONTENT com FATO FALSO no pedido: o banco vence a afirmacao",
  agent_id: "AGT-MKT-CONTENT",
  input: { text: "agenda esse post para amanhã no instagram" },
  facts: { content_status: "APPROVED", channel_connected: true,
           brand_brain_status: "ACTIVE", claim_types: ["GENERAL"] },
  modelo: {
    resolver: { intent: "PUBLISH_CONTENT", confidence_band: "HIGH",
      entities: [{ type: "content_version", canonical_id: cv, raw: "esse post" },
                 { type: "channel", canonical_id: "INSTAGRAM", raw: "instagram" }], ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "publishing.schedule", mode: "write",
                         args_summary: "agendar" }] },
    responder: RESPONDER,
  },
  espera: { estado: "POLICY_BLOCKED", reason_codes: ["CONTENT_NOT_APPROVED"], executou: false,
            porque: "o pedido diz APPROVED, o banco diz DRAFT — e quem decide e o banco" },
});

// ── 9. COMPLIANCE: termo proibido pelo Brand Brain ─────────────────────────
await db.query(`update ${SCHEMA}.content_versions set master_body = $2 where id = $1`,
  [cv, "Nossa cobertura ilimitada resolve tudo."]);
await cenario({
  nome: "COMPLIANCE pega o termo proibido e para o loop",
  agent_id: "AGT-MKT-COMPLIANCE",
  input: { text: "revisa esse post" },
  facts: { brand_brain_status: "ACTIVE" },
  modelo: {
    resolver: { intent: "REVIEW_CONTENT", confidence_band: "HIGH",
      entities: [{ type: "content_version", canonical_id: cv, raw: "esse post" }], ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "compliance.review", mode: "simulate",
                         args_summary: "revisar" }] },
    responder: RESPONDER,
  },
  espera: { estado: "QUALITY_BLOCKED", reason_codes: ["COMPLIANCE_REVIEW_REQUIRED"] },
});

// ── 10. COMPLIANCE: promessa de cobertura ROTULADA como genérica ───────────
//
// O cenário que mede a defesa contra o erro mais caro do produto. O texto
// promete cobertura, prazo e preço; a etiqueta do claim diz GENERAL. Se o
// compliance passar, a única defesa contra claim material sem evidência é a
// autodeclaração do modelo.
await db.query(
  `update ${SCHEMA}.content_versions
      set master_body = 'Cobrimos alagamento em ate 24 horas, por R$ 9,90 ao mes.'
    where id = $1`, [cv]);
await cenario({
  nome: "COMPLIANCE diante de promessa rotulada como GENERAL",
  agent_id: "AGT-MKT-COMPLIANCE",
  input: { text: "revisa esse post" },
  facts: { brand_brain_status: "ACTIVE" },
  modelo: {
    resolver: { intent: "REVIEW_CONTENT", confidence_band: "HIGH",
      entities: [{ type: "content_version", canonical_id: cv, raw: "esse post" }], ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "compliance.review", mode: "simulate",
                         args_summary: "revisar" }] },
    responder: RESPONDER,
  },
  espera: { estado: "QUALITY_BLOCKED",
            porque: "o texto promete cobertura, prazo e preço — a etiqueta diz que não" },
});

// ── 11. Escopo: a sessão de um workspace alcança outro? ────────────────────
await cenario({
  nome: "COMPLIANCE com conteúdo de OUTRO workspace da mesma org",
  agent_id: "AGT-MKT-COMPLIANCE",
  input: { text: "revisa aquele post" },
  facts: { brand_brain_status: "ACTIVE" },
  modelo: {
    resolver: { intent: "REVIEW_CONTENT", confidence_band: "HIGH",
      entities: [{ type: "content_version", canonical_id: cvB, raw: "aquele post" }], ambiguities: [] },
    planner: { steps: [{ step_id: "s1", capability_id: "compliance.review", mode: "simulate",
                         args_summary: "revisar" }] },
    responder: RESPONDER,
  },
  espera: { estado: "CLARIFICATION_REQUIRED",
            porque: "a sessão é do workspace Principal; o conteúdo é da unidade B" },
});

// ── O que sobrou no banco ──────────────────────────────────────────────────
const gravado = await db.query(`
  select 'content_versions' t, count(*) n from ${SCHEMA}.content_versions where org_id=$1
  union all select 'channel_variants', count(*) from ${SCHEMA}.channel_variants where org_id=$1
  union all select 'brand_brain CANDIDATE', count(*) from ${SCHEMA}.brand_brain_versions
                where org_id=$1 and status='CANDIDATE'
  union all select 'claims', count(*) from ${SCHEMA}.claims where org_id=$1
  union all select 'evidence', count(*) from ${SCHEMA}.evidence where org_id=$1
  union all select 'action_receipts', count(*) from ${SCHEMA}.action_receipts where org_id=$1
  union all select 'agent_runs', count(*) from ${SCHEMA}.agent_runs where org_id=$1
  union all select 'audit_events', count(*) from ${SCHEMA}.audit_events where org_id=$1
  union all select 'publications', count(*) from ${SCHEMA}.publications where org_id=$1`,
  [ids.org]);

console.log("\n  ── o que ficou gravado ──");
for (const g of gravado.rows) console.log(`     ${g.t.padEnd(24)} ${g.n}`);

// A taxonomia do mercado nasce CANDIDATE e o codigo so le ACTIVE. Enquanto
// ninguem curar, ela nao decide nada — e dizer isso aqui evita que alguem leia
// "compliance passou" como "as vedacoes do mercado foram conferidas".
const pendentes = await ports.taxonomy.pendingCuration();
const curados = (await ports.taxonomy.activeProducts()).length;
console.log("\n  ── taxonomia do mercado ──");
console.log(`     produtos curados ....... ${curados}`);
console.log(`     esperando curadoria .... produtos ${pendentes.products}, termos ${pendentes.terms}, ` +
            `publicos ${pendentes.audiences}, tipos de conteudo ${pendentes.content_types}`);
if (curados === 0) {
  console.log("     ⚠ nenhuma linha curada: a taxonomia ainda nao julga nada.");
}

const runs = await db.query(
  `select agent_id, status::text as status, respondability, reason_codes,
          model, cost_cents
     from ${SCHEMA}.agent_runs where org_id=$1 order by started_at`, [ids.org]);
console.log("\n  ── agent_runs (o trace de cada execução) ──");
for (const r of runs.rows) {
  console.log(`     ${r.agent_id.padEnd(20)} ${r.status.padEnd(10)} ` +
    `${(r.respondability ?? "-").padEnd(22)} modelo=${r.model ?? "null"} ` +
    `custo=${r.cost_cents ?? "null"}`);
}

await db.end();

if (divergencias.length) {
  console.log(`\n  ${divergencias.length} cenário(s) divergiram do esperado:`);
  for (const d of divergencias) console.log(`     ${d.nome}: ${d.falhas.join("; ")}`);
  console.log("\n  Divergência aqui é achado, não falha de infraestrutura: ou o esperado " +
              "está errado, ou o sistema está. Descubra qual antes de mudar qualquer coisa.\n");
  process.exit(1);
}
console.log("\n  Os 11 cenários saíram como o esperado.\n");
