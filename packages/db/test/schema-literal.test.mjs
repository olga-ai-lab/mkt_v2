/**
 * O schema nao pode estar escrito a mao em codigo de runtime.
 *
 * Este teste existe por causa de um defeito que estava de pe e que nenhum
 * outro teste podia pegar: `apps/web/lib/auth.ts` consultava `mkt.memberships`
 * com o nome do schema literal, enquanto todo o resto do sistema o resolve por
 * `MKT_SCHEMA` (`ports-postgres.mjs`, `ports-worker.mjs`).
 *
 * Em desenvolvimento os dois coincidem e nada quebra. Em producao, onde o alvo
 * e `mkt_v2` e o schema `mkt` guarda dados que nao sao nossos, o login lia o
 * lugar errado — e o sintoma seria "ninguem consegue entrar", longe da causa.
 *
 * Um teste unitario do login nao acharia isso: com o schema `mkt` no banco de
 * teste, a consulta funciona. So um varredor estrutural acha, e por isso ele
 * existe aqui em vez de uma correcao pontual naquele arquivo.
 *
 * Os `.sql` das migrations sao a excecao declarada: eles usam `mkt.`
 * literalmente de proposito, porque sao a fonte unica executavel direto no
 * psql, e o runner faz o rename de namespace. Ver docs/HANDOFF.md §5.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Diretorios onde `mkt.` literal e legitimo, ou onde nao ha codigo nosso. */
const IGNORADOS = new Set(["node_modules", ".git", ".next", "dist", "migrations", "test", "evals", "generated"]);
const EXTENSOES = new Set([".mjs", ".js", ".ts", ".tsx"]);

function* arquivos(dir) {
  for (const nome of readdirSync(dir)) {
    if (IGNORADOS.has(nome)) continue;
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) yield* arquivos(caminho);
    else if (EXTENSOES.has(path.extname(nome))) yield caminho;
  }
}

/**
 * Procura `mkt.<identificador>` em posicao de SQL.
 *
 * A busca ignora comentario de linha e de bloco: os cabecalhos deste
 * repositorio citam `mkt.outbox` e `mkt.connections` em prosa o tempo todo, e
 * prosa nao vira consulta. O que importa e o que sobra depois de tirar
 * comentario.
 */
function ocorrencias(fonte) {
  const semComentario = fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  return [...semComentario.matchAll(/\bmkt\.[a-z_][a-z0-9_]*/g)].map((m) => m[0]);
}

test("nenhum codigo de runtime escreve o nome do schema a mao", () => {
  const achados = [];
  for (const base of ["apps", "packages", "scripts"]) {
    for (const arquivo of arquivos(path.join(raiz, base))) {
      const encontradas = ocorrencias(readFileSync(arquivo, "utf8"));
      if (encontradas.length) {
        achados.push(`${path.relative(raiz, arquivo)}: ${[...new Set(encontradas)].join(", ")}`);
      }
    }
  }

  assert.deepEqual(
    achados, [],
    "schema escrito a mao em codigo de runtime. Use a porta correspondente em " +
    "ports-postgres.mjs, que resolve MKT_SCHEMA:\n  " + achados.join("\n  "));
});

test("o varredor reconhece o padrao que ele existe para pegar", () => {
  // Sem este caso, um varredor que nunca encontra nada passaria por correto.
  assert.deepEqual(ocorrencias("select * from mkt.memberships where id = $1"), ["mkt.memberships"]);
  // E prosa em comentario nao pode reprovar ninguem.
  assert.deepEqual(ocorrencias("// o relay drena mkt.outbox\n/* mkt.connections guarda o secret_ref */"), []);
});
