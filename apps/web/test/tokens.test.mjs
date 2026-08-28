/**
 * Todo estado que a tela pode receber tem regra de estilo.
 *
 * ── O defeito que este arquivo existe para não deixar voltar ───────────────
 *
 * As telas montam a classe do chip a partir do VALOR DO ENUM:
 *
 *     const classeDeEstado = (s) => `state-${s.toLowerCase().replace(/_/g, "-")}`;
 *
 * Isso é bom — não há um mapa manual para alguém esquecer de atualizar. Mas
 * significa que um estado sem regra em `tokens.css` não dá erro em lugar
 * nenhum: renderiza um chip sem cor e sem fundo, texto solto no meio da lista.
 *
 * Era o caso de `CANCELLED`, que existe em `mkt.content_state` desde a 0002 e
 * nunca teve regra. Ninguém viu porque cancelar conteúdo é raro — e "raro" é
 * exatamente o tipo de caminho que só aparece quebrado na frente de um cliente.
 *
 * ── Por que ler o .sql, e não uma lista escrita aqui ───────────────────────
 *
 * Uma lista de estados neste arquivo seria uma terceira cópia do enum, e
 * copiar o enum é o que este teste existe para impedir. A migration é a fonte:
 * um estado novo entra por lá, e este teste falha no mesmo commit.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leia = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const TOKENS = leia("../styles/tokens.css");
const MIGRATION = leia("../../../packages/db/migrations/0002_brand_content.sql");

/** Os valores de um `create type ... as enum (...)` da migration. */
function enumDe(sql, nome) {
  const m = sql.match(new RegExp(`create type mkt\\.${nome} as enum \\(([^)]+)\\)`, "s"));
  assert.ok(m, `nao achei o enum ${nome} na migration`);
  return [...m[1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
}

const classeDe = (estado) => `state-${estado.toLowerCase().replace(/_/g, "-")}`;
const temRegra = (classe) => new RegExp(`\\.${classe}[\\s,{]`).test(TOKENS);

test("todo mkt.content_state tem regra de chip", () => {
  const estados = enumDe(MIGRATION, "content_state");
  assert.ok(estados.length >= 10, `so achei ${estados.length} estados; o regex quebrou?`);

  const sem = estados.filter((e) => !temRegra(classeDe(e)));
  assert.deepEqual(sem, [],
    `estes estados renderizam chip sem estilo: ${sem.map(classeDe).join(", ")}`);
});

test("todo mkt.lifecycle_status tem regra de chip", () => {
  // A tela de Brand Brain monta a classe do mesmo jeito, a partir do status da
  // versao (DRAFT, CANDIDATE, ACTIVE, DEPRECATED, BLOCKED).
  const sql = leia("../../../packages/db/migrations/0001_iam.sql");
  const sem = enumDe(sql, "lifecycle_status").filter((e) => !temRegra(classeDe(e)));
  assert.deepEqual(sem, []);
});

test("todo mkt.channel tem cor de canal", () => {
  // A cor do canal e o que faz alguem reconhecer "Instagram" na periferia da
  // visao. Um canal novo sem cor herda a do anterior e confunde em silencio.
  const canais = enumDe(MIGRATION, "channel");
  const sem = canais.filter((c) => !new RegExp(`\\.canal-${c.toLowerCase()}\\s*\\{`).test(TOKENS));
  assert.deepEqual(sem, [], `canais sem cor: ${sem.join(", ")}`);
});

test("nenhuma regra de estado sobrou apontando para estado que nao existe", () => {
  // O outro lado da divergencia: uma classe que ninguem mais usa e uma cor que
  // alguem vai copiar achando que significa alguma coisa.
  const conhecidos = new Set([
    ...enumDe(MIGRATION, "content_state"),
    ...enumDe(leia("../../../packages/db/migrations/0001_iam.sql"), "lifecycle_status"),
    // Estados de respondability que tambem viram chip na resposta do agente.
    "TEMPORARILY_UNAVAILABLE",
  ].map(classeDe));

  const declaradas = [...TOKENS.matchAll(/\.(state-[a-z-]+)/g)].map((m) => m[1]);
  const orfas = [...new Set(declaradas)].filter((c) => !conhecidos.has(c));
  assert.deepEqual(orfas, [], `regras sem estado correspondente: ${orfas.join(", ")}`);
});

test("nenhum hex solto fora dos tokens", () => {
  // Os VALORES moram em :root. Uma cor escrita direto numa regra e a primeira
  // linha de uma segunda paleta — e duas paletas parecidas convivendo e o pior
  // dos mundos: de longe ninguem ve a diferenca, de perto nada combina.
  const corpo = TOKENS.slice(TOKENS.indexOf("}", TOKENS.indexOf(":root")));
  const soltos = [...corpo.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(soltos, [],
    `cores fora do :root — devem virar token: ${soltos.join(", ")}`);

  const app = leia("../styles/app.css");
  const noApp = [...app.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map((m) => m[0]);
  assert.deepEqual(noApp, [], `app.css compoe, nao define cor: ${noApp.join(", ")}`);
});
