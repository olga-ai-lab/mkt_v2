/**
 * Onboarding de marca a partir da URL, contra Postgres real.
 *
 * Os testes de unidade respondem "a decisão está certa?". Este responde a
 * pergunta que dublê nenhum responde: o registry aplicado, o gateway e o SQL
 * concordam com o que o adapter acredita?
 *
 * O caminho medido aqui é a Fase 2 inteira em duas chamadas:
 *
 *   brand.extract_from_url  → página lida, itens conferidos, procedência assinada
 *   brand.propose_version   → uma versão CANDIDATE em mkt.brand_brain_versions
 *
 * O que só aparece aqui: a validação de `output_schema_ref` pelo gateway (a
 * coluna que ficou três migrations sendo decoração), a rota do registry para o
 * adapter certo, e o que o INSERT realmente grava em source_refs.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createGateway } from "@olga/gateway";
import { createBrandExtractAdapter, createInternalAdapter } from "@olga/gateway/adapters";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports;

const limpar = () => db.query(`delete from mkt.organizations where slug = 'onb-test'`);

const PAGINA =
  "Corretora Ipe. Seguros para quem mora em area de risco climatico. " +
  "Atendemos enchente e alagamento desde 1998, em todo o estado de Santa Catarina. " +
  "Nossa equipe conhece o Vale do Itajai e sabe o que uma cheia faz com uma casa, " +
  "com um estoque e com um caminhao parado. Trabalhamos com residencial, empresarial " +
  "e frota, e acompanhamos o cliente do orcamento ate a regulacao do sinistro. " +
  "Atendimento de segunda a sexta, das 8h as 18h, e plantao para sinistro em " +
  "evento climatico. Consulte as condicoes gerais da apolice. Susep 12.345.";

/** Busca roteirizada: o que o web_fetch devolveria, sem sair para a rede. */
const fetcherFixo = () => ({
  async call() {
    return {
      texto: PAGINA,
      hash: crypto.createHash("sha256").update(PAGINA).digest("hex").slice(0, 32),
      url_final: "https://ipe.example/",
      request_hash: "rh-1",
    };
  },
});

/**
 * Extrator roteirizado.
 *
 * Só a resposta do modelo é roteirizada — o registry, a policy, o gateway, a
 * conferência de citação e o SQL são os de verdade. Um teste que trouxesse as
 * próprias regras só provaria que concorda consigo mesmo.
 *
 * Ele devolve de propósito um item COM lastro e um SEM: é a mistura que uma
 * página real produz.
 */
const extratorFixo = () => ({
  async fromPage() {
    return {
      identity: { summary: "Corretora de risco climatico em Santa Catarina.", audience: "Moradores de area alagavel" },
      tone: { voice: "Direta, tecnica, sem promessa de cobertura total." },
      claims_allowed: [
        { text: "Atende enchente e alagamento desde 1998", quote: "Atendemos enchente e alagamento desde 1998" },
        { text: "A maior corretora do pais", quote: "Somos a maior corretora do pais" },
      ],
      disclaimers: [
        { text: "Consulte as condicoes gerais da apolice", quote: "Consulte as condicoes gerais da apolice" },
      ],
    };
  },
});

function montarGateway() {
  const brandExtract = createBrandExtractAdapter({
    knowledge: ports.knowledge, fetcher: fetcherFixo(), extract: extratorFixo(),
  });
  const internal = createInternalAdapter({
    authoring: ports.authoring, knowledge: ports.knowledge, publishing: ports.publishing,
  });
  return createGateway({
    registry: {
      getCapability: (id, v) => ports.registry.getCapability(id, v),
      newId: () => crypto.randomUUID(),
      isApprovalValid: async () => ({ valid: true }),
    },
    policies: ports.policies,
    receipts: ports.receipts,
    adapters: { brand_extract: brandExtract, internal },
  });
}

const pedido = (capability_id, args) => ({
  trace_id: "tr_onb",
  tenant: { org_id: ids.org, workspace_id: ids.ws, actor_id: "u-onb" },
  capability_id, capability_version: 1,
  mode: capability_id === "brand.propose_version" ? "write" : "read",
  args, requested_autonomy: "A2", approval_id: null,
  idempotency_key: `onb:${capability_id}`,
});

const contexto = { facts: {}, actor: { id: "u-onb", role: "OWNER", org_id: null } };

before(async () => {
  await db.connect();
  await limpar();

  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Onb','onb-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora Ipe', 'https://ipe.example' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;

  ports = createPostgresPorts(db);
  contexto.actor.org_id = ids.org;
});

after(async () => { await limpar(); await db.end(); });

// ── O registry manda para o adapter certo ───────────────────────────────────

test("o registry aponta brand.extract_from_url para brand_extract, e declara o contrato da saida", async () => {
  const cap = await ports.registry.getCapability("brand.extract_from_url", 1);
  assert.equal(cap.provider_adapter, "brand_extract");
  assert.equal(cap.output_schema_ref, "olga://io/brand-proposal");
});

// ── Extrair ─────────────────────────────────────────────────────────────────

test("extrai a marca do site cadastrado e devolve a proposta pelo gateway", async () => {
  const r = await montarGateway().execute(pedido("brand.extract_from_url", {
    brand_id: ids.brand, url: "https://ipe.example",
  }), contexto);

  assert.equal(r.execution.status, "SUCCEEDED", JSON.stringify(r.execution.error));
  assert.equal(r.execution.provider, "brand_extract");

  // O item com lastro entrou; o inventado nao, e esta nomeado em discarded.
  assert.deepEqual(r.output.claims_allowed, ["Atende enchente e alagamento desde 1998"]);
  assert.deepEqual(r.output.discarded, [
    { field: "claims_allowed", text: "A maior corretora do pais", reason_code: "CLAIM_UNSUPPORTED" },
  ]);
  assert.deepEqual(r.output.prohibitions, []);
  assert.equal(r.output.source_refs.length, 1);
  assert.equal(r.output.source_refs[0].locator, "https://ipe.example/");

  // Capability interna nao emite receipt: receipt e para efeito externo.
  assert.equal(r.receipt, undefined);
});

test("o gateway recusa saida fora do contrato que a capability declara", async () => {
  // `output_schema_ref` existia desde a 0004 e ninguem a lia. Este teste e o
  // que impede a coluna de voltar a ser decoracao: um adapter que devolva algo
  // fora do contrato falha aqui, e nao no primeiro cliente.
  const gateway = createGateway({
    registry: {
      getCapability: (id, v) => ports.registry.getCapability(id, v),
      newId: () => crypto.randomUUID(),
      isApprovalValid: async () => ({ valid: true }),
    },
    policies: ports.policies,
    receipts: ports.receipts,
    adapters: {
      brand_extract: {
        name: "brand_extract",
        // Sem source_refs: procedencia e obrigatoria no contrato.
        async call() { return { external_id: "x", output: { brand_id: String(ids.brand) } }; },
      },
    },
  });

  const r = await gateway.execute(pedido("brand.extract_from_url", {
    brand_id: ids.brand, url: "https://ipe.example",
  }), contexto);

  assert.equal(r.execution.status, "FAILED");
  assert.equal(r.execution.error.reason_code, "SCHEMA_VALIDATION_FAILED");
  assert.equal(r.output, null);
});

test("endereco fora do dominio cadastrado nao e buscado", async () => {
  const r = await montarGateway().execute(pedido("brand.extract_from_url", {
    brand_id: ids.brand, url: "https://169.254.169.254.evil.example/",
  }), contexto);

  assert.equal(r.execution.status, "FAILED");
  assert.equal(r.execution.error.reason_code, "UNSUPPORTED_VALUE");
});

// ── Propor ──────────────────────────────────────────────────────────────────

test("a proposta vira uma versao CANDIDATE, com a procedencia gravada", async () => {
  const gateway = montarGateway();

  const extraido = await gateway.execute(pedido("brand.extract_from_url", {
    brand_id: ids.brand, url: "https://ipe.example",
  }), contexto);

  const r = await gateway.execute(pedido("brand.propose_version", {
    brand_id: ids.brand,
    identity: extraido.output.identity, tone: extraido.output.tone,
    claims_allowed: extraido.output.claims_allowed,
    prohibitions: extraido.output.prohibitions,
    disclaimers: extraido.output.disclaimers,
    source_refs: extraido.output.source_refs,
  }), contexto);

  assert.equal(r.execution.status, "SUCCEEDED", JSON.stringify(r.execution.error));
  assert.equal(r.output.status, "CANDIDATE");

  const { rows } = await db.query(
    `select version, status::text as status, claims_allowed, prohibitions, source_refs,
            created_by_actor_type::text as actor_type, activated_at
       from mkt.brand_brain_versions where id = $1`, [r.output.brand_brain_version_id]);

  const bb = rows[0];
  assert.equal(bb.status, "CANDIDATE");
  assert.equal(bb.actor_type, "agent");
  assert.equal(bb.activated_at, null);
  assert.deepEqual(bb.claims_allowed, ["Atende enchente e alagamento desde 1998"]);
  assert.deepEqual(bb.prohibitions, []);
  assert.equal(bb.source_refs[0].hash.length, 32);
  assert.equal(bb.source_refs[0].kind, "WEB_PAGE");
});

test("uma marca recem-proposta ainda nao tem Brand Brain ATIVO", async () => {
  // É o ponto exato onde o onboarding para e uma pessoa entra. Enquanto ninguém
  // ativar, brand.read continua recusando — e content.create_draft também.
  const bb = await ports.knowledge.brandBrain(ids.org, ids.brand);
  assert.equal(bb, null);

  const r = await montarGateway().execute(pedido("brand.read", { brand_id: ids.brand }), contexto);
  assert.equal(r.execution.status, "FAILED");
  assert.equal(r.execution.error.reason_code, "BRAND_BRAIN_NOT_ACTIVE");
});
