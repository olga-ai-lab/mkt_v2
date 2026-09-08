/**
 * O delta de cada agente, conferido contra o registry REAL.
 *
 * Os testes em packages/runtime provam a forma do delta com um agente
 * inventado. Este prova o que importa em produção: que os agentes que estão
 * mesmo semeados no banco têm delta, e que nenhum delta promete algo que a
 * linha do registry não sustenta.
 *
 * Sem este arquivo, alguém acrescentaria um quinto agente à migration 0006 e
 * ele rodaria com a postura genérica sem ninguém notar.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readdirSync } from "node:fs";
import { deltaFor, uncertaintyPolicy, AGENTS_COM_DELTA } from "@olga/runtime/agent-deltas";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
let agentes = [];
let capabilities = new Set();
let registroDeCapabilities = [];

before(async () => {
  await db.connect();
  const a = await db.query(
    `select agent_id, version, status::text as status, mission, capabilities,
            reason_codes, deviates_from_base, baseline_autonomy, max_autonomy,
            modes::text[] as modes
       from mkt.agent_registry order by agent_id`);
  agentes = a.rows;
  const c = await db.query(
    `select capability_id, side_effect::text as side_effect, mode::text as mode
       from mkt.capability_registry`);
  capabilities = new Set(c.rows.map((r) => r.capability_id));
  registroDeCapabilities = c.rows;
});

after(async () => { await db.end(); });

test("todo agente semeado tem delta proprio", () => {
  const semDelta = agentes.map((a) => a.agent_id).filter((id) => !AGENTS_COM_DELTA.includes(id));
  assert.deepEqual(semDelta, [],
    "agente novo no seed sem delta rodaria com a postura generica sem ninguem notar");
});

test("nao ha delta orfao, apontando para agente que nao existe", () => {
  const ids = new Set(agentes.map((a) => a.agent_id));
  const orfaos = AGENTS_COM_DELTA.filter((id) => !ids.has(id));
  assert.deepEqual(orfaos, []);
});

test("o delta de cada agente cita a missao e as capabilities da propria linha", () => {
  for (const a of agentes) {
    const texto = deltaFor(a);
    assert.ok(texto.includes(a.mission), `${a.agent_id}: missao do registry ausente no delta`);
    for (const cap of a.capabilities) {
      assert.ok(texto.includes(cap), `${a.agent_id}: capability ${cap} ausente no delta`);
    }
  }
});

test("nenhum delta cita capability fora do registry", () => {
  // Se o delta nomeasse uma capability inexistente, o agente proporia um passo
  // que o gateway recusaria — e a culpa pareceria do modelo.
  for (const a of agentes) {
    for (const cap of a.capabilities) {
      assert.ok(capabilities.has(cap),
        `${a.agent_id} declara ${cap}, que nao existe no capability_registry`);
    }
  }
});

test("o delta so oferece os reason codes que a linha declara", () => {
  for (const a of agentes) {
    const texto = deltaFor(a);
    for (const rc of a.reason_codes) {
      assert.ok(texto.includes(rc), `${a.agent_id}: reason code ${rc} ausente no delta`);
    }
  }
});

test("os desvios da base do banco aparecem no delta", () => {
  for (const a of agentes.filter((x) => (x.deviates_from_base ?? []).length > 0)) {
    for (const d of a.deviates_from_base) {
      assert.ok(deltaFor(a).includes(d),
        `${a.agent_id}: desvio declarado no banco nao chegou ao prompt`);
    }
  }
});

test("agente com autonomia maior nao ganha politica de incerteza mais solta", () => {
  // O teto de autonomia diz o que o agente PODE fazer; a politica de
  // incerteza diz para que lado ele erra. Um teto alto nao afrouxa o segundo.
  for (const a of agentes) {
    const p = uncertaintyPolicy(a.agent_id);
    assert.ok(p.na_duvida.length > 20, `${a.agent_id} sem politica de duvida`);
    assert.ok(!/prossiga|assuma|escolha o mais provavel/i.test(p.na_duvida),
      `${a.agent_id}: politica de duvida nao pode mandar seguir em frente`);
  }
});

/**
 * O inventario dos agentes ACTIVE, fixado a mao.
 *
 * Este bloco ja foi tres coisas diferentes: "os quatro sao CANDIDATE", depois
 * "so o COPILOT e ACTIVE", depois "os dois somente-leitura". Ele quebrou em
 * cada promocao, e e para isso que serve — promover agente nao passa
 * despercebido num diff.
 *
 * A forma mudou na 0013 porque a pergunta mudou. Enquanto nenhum agente ACTIVE
 * escrevia, bastava afirmar isso. Agora dois escrevem, e afirmar "quem esta
 * ACTIVE" ja nao diz o que eles alcancam: o que importa e o charter de cada um,
 * capability por capability.
 *
 * Entao o inventario e explicito. Mudar o charter de um agente promovido — ou
 * promover outro — obriga a editar esta constante, o que obriga a olhar para o
 * que se esta concedendo.
 */
const ATIVOS_ESPERADOS = {
  "AGT-MKT-COPILOT": ["brand.read", "evidence.read", "quality.precheck"],
  "AGT-MKT-COMPLIANCE": ["brand.read", "compliance.review", "evidence.read"],
  "AGT-MKT-BRAND": ["brand.extract_from_url", "brand.propose_version", "brand.read"],
  "AGT-MKT-CONTENT": [
    "brand.read", "content.create_draft", "content.create_variant",
    "evidence.read", "publishing.schedule", "quality.precheck",
  ],
};

test("o inventario dos agentes ACTIVE bate com o registry, agente por agente", () => {
  const ativos = agentes.filter((a) => a.status === "ACTIVE");

  assert.deepEqual(
    ativos.map((a) => a.agent_id).sort(), Object.keys(ATIVOS_ESPERADOS).sort(),
    "promover ou rebaixar agente entra por migration, com motivo junto (0009, 0012, 0013)");

  for (const a of ativos) {
    assert.deepEqual(
      [...(a.capabilities ?? [])].sort(), [...ATIVOS_ESPERADOS[a.agent_id]].sort(),
      `o charter de ${a.agent_id} mudou. Se foi de proposito, atualize o inventario ` +
      `junto com a migration — e olhe para o que esta sendo concedido.`);
  }
});

/**
 * O teto, e ele nao e uma lista de nomes.
 *
 * Ate a 0013 o invariante era "nenhum agente ACTIVE escreve", conferido contra
 * uma lista de capabilities escrita a mao. A lista era um proxy grosseiro:
 * juntava criar um rascunho no nosso banco com publicar no perfil de um
 * cliente. A primeira se apaga; a segunda nao.
 *
 * O teto que ficou no lugar sai de `side_effect`, no proprio registry. Uma
 * capability que ganhe efeito externo amanha passa a ser barrada sem que
 * ninguem se lembre de editar isto — que e a diferenca entre um invariante e
 * uma lista que envelhece.
 */
const alcanca = (agente, efeito) => (agente.capabilities ?? [])
  .map((cap) => registroDeCapabilities.find((c) => c.capability_id === cap))
  .filter((c) => c?.side_effect === efeito)
  .map((c) => c.capability_id);

test("nenhum agente ACTIVE alcanca efeito externo", () => {
  for (const a of agentes.filter((x) => x.status === "ACTIVE")) {
    assert.deepEqual(alcanca(a, "external"), [],
      `${a.agent_id} esta ACTIVE alcancando efeito EXTERNO. Publicar e do workflow ` +
      `duravel depois de decisao humana; conectar canal e consentimento no navegador.`);
  }
});

test("as duas capabilities de efeito externo nao estao no charter de ninguem", () => {
  // Dito do outro lado, porque e assim que a regra e lembrada. Um agente
  // ACTIVE que as tivesse seria pego pelo teste acima; este pega tambem o
  // CANDIDATE, antes de a promocao virar uma decisao que parece pequena.
  const externas = registroDeCapabilities
    .filter((c) => c.side_effect === "external").map((c) => c.capability_id).sort();
  assert.deepEqual(externas, ["channel.connect", "publishing.publish"],
    "surgiu capability de efeito externo nova: ela precisa de dono declarado, ou de nenhum");

  for (const a of agentes) {
    const tem = (a.capabilities ?? []).filter((c) => externas.includes(c));
    assert.deepEqual(tem, [], `${a.agent_id} (${a.status}) declara ${tem.join(", ")}`);
  }
});

test("o teto reprova um agente fabricado com capability externa", () => {
  // Sem este caso, `alcanca()` poderia estar quebrada e os dois testes acima
  // passariam por vacuidade — nenhum agente tem capability externa hoje, entao
  // uma funcao que sempre devolve lista vazia os aprovaria igual.
  const fabricado = { agent_id: "AGT-FAKE", capabilities: ["brand.read", "publishing.publish"] };
  assert.deepEqual(alcanca(fabricado, "external"), ["publishing.publish"]);
});

test("o efeito interno de cada agente ACTIVE esta declarado", () => {
  // Escrever no nosso banco e permitido a agente ACTIVE desde a 0013, e por
  // isso deixou de ser interessante perguntar SE ele escreve. O que continua
  // valendo a pena e que a lista do que ele escreve seja visivel — este teste
  // nao reprova nada por si, ele existe para que o inventario acima nao seja
  // lido como uma lista de nomes sem consequencia.
  for (const a of agentes.filter((x) => x.status === "ACTIVE")) {
    for (const cap of alcanca(a, "internal")) {
      assert.ok(ATIVOS_ESPERADOS[a.agent_id].includes(cap),
        `${a.agent_id} escreve por ${cap}, que nao esta no inventario`);
    }
  }
});

test("todo agente ACTIVE tem eval proprio", () => {
  // Amarra promocao a evidencia: o que esta em producao foi medido.
  const comEval = new Set(readdirSync(new URL("../../runtime/evals/", import.meta.url))
    .filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")));
  for (const a of agentes.filter((x) => x.status === "ACTIVE")) {
    assert.ok(comEval.has(a.agent_id),
      `${a.agent_id} esta ACTIVE sem eval: promover sem medir e promover no escuro`);
  }
});

test("nenhum agente tem publishing.publish no charter", () => {
  // Descoberto escrevendo um eval que assumia o contrário, e o eval falhou.
  //
  // Publicar é consequência de uma decisão humana de agendar; o workflow
  // durável é quem executa, com idempotência e replay. Um agente com essa
  // capability apagaria essa fronteira — e o pior é que apagaria em silêncio,
  // porque tudo o mais continuaria passando.
  //
  // Fica como teste estrutural, e não como eval, porque um eval só cobre o
  // caso que alguém lembrou de escrever. Isto varre os quatro.
  const comPublish = agentes
    .filter((a) => (a.capabilities ?? []).includes("publishing.publish"))
    .map((a) => a.agent_id);
  assert.deepEqual(comPublish, [],
    "publicar e do workflow durável, disparado por decisao humana de agendar");
});

test("agente que so le nao tem capability de escrita", () => {
  // modes `{read,simulate}` e capability de escrita juntos seriam uma
  // contradicao entre o que a linha declara e o que ela permite.
  for (const a of agentes) {
    const modos = a.modes ?? [];
    const soLeitura = modos.every((m) => m === "read" || m === "simulate");
    if (!soLeitura) continue;
    const escritas = (a.capabilities ?? []).filter((c) =>
      c.startsWith("content.create") || c.startsWith("publishing.") || c.startsWith("approval."));
    assert.deepEqual(escritas, [],
      `${a.agent_id} declara so leitura em modes mas tem capability de escrita`);
  }
});
