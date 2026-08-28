/**
 * Nenhum módulo que o bundle carrega lê disco.
 *
 * ── A regra, e as duas vezes que ela foi descoberta do jeito caro ──────────
 *
 * O rastreador de arquivos do Next segue `import`. Ele NÃO segue caminho
 * montado em tempo de execução — `readFileSync(new URL(..., import.meta.url))`
 * ou `readdirSync(join(ROOT, rel))` são opacos para ele, e o arquivo lido fica
 * de fora do bundle.
 *
 * O sintoma é o pior possível: **o build passa**. Ele roda com o repositório
 * inteiro em disco, então tudo é encontrado. O erro aparece em produção, na
 * primeira requisição, num arquivo que ninguém lembra de ter lido.
 *
 * Aconteceu duas vezes:
 *
 *   packages/runtime/src/prompts.mjs   lia prompts.lock.json
 *                                      → `next build` quebrava em /api/agent
 *   packages/contracts/src/index.mjs   lia 34 schemas de quatro diretórios
 *                                      → build verde, 34 arquivos fora do
 *                                        bundle, e `assertValid` está em TODA
 *                                        rota. Deploy verde, 500 imediato.
 *
 * O segundo só foi visto porque alguém abriu o `.nft.json` antes de deployar.
 * Este teste existe para a terceira vez cair aqui.
 *
 * ── O que continua permitido ──────────────────────────────────────────────
 *
 * `node:dns` e `node:net` (a defesa de SSRF do web-fetch) ficam: eles não leem
 * arquivo, e existem no runtime Node da Vercel. A regra é sobre DISCO, não
 * sobre builtins do Node.
 *
 * Scripts de build, migrations e testes leem disco à vontade — rodam em Node
 * com o repositório inteiro. O que não pode ler é o que vai empacotado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Este arquivo e um TESTE: le disco a vontade. A regra que ele impoe vale para
// o que vai empacotado, e nao para quem confere.
const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));

/** Os diretórios cujo código entra no bundle da web. */
const EMPACOTADOS = [
  "packages/contracts/src",
  "packages/runtime/src",
  "packages/gateway/src",
  "packages/policy/src",
  "apps/worker/src",
  "apps/web/lib",
];

function fontes(dir) {
  const base = join(RAIZ, dir);
  const saida = [];
  const anda = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory()) anda(f);
      else if (/\.(mjs|ts|tsx|js)$/.test(e.name)) saida.push(f);
    }
  };
  anda(base);
  return saida;
}

/** Leitura de disco, em qualquer das formas que já apareceram. */
const LEITURAS = [
  [/\bfrom\s+["']node:fs["']/, "importa node:fs"],
  [/\brequire\(\s*["'](node:)?fs["']\s*\)/, "require de fs"],
  [/\breadFileSync\b/, "readFileSync"],
  [/\breaddirSync\b/, "readdirSync"],
  [/\bcreateReadStream\b/, "createReadStream"],
];

/**
 * Tira comentários antes de procurar.
 *
 * Sem isto, o teste acusa os próprios arquivos que EXPLICAM o defeito: o
 * cabeçalho de `contracts/src/index.mjs` conta que ele lia com `readdirSync`,
 * e a palavra basta para casar. Um teste que proíbe descrever o problema
 * corrigido é um teste que apaga a explicação de por que a correção existe.
 *
 * Grosseiro de propósito: pode comer um `//` dentro de string (uma URL). Para
 * o que se procura aqui, comer demais é seguro — nenhuma chamada de fs some
 * por causa disso.
 */
const semComentario = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("nenhum modulo empacotado le disco", () => {
  const achados = [];
  for (const dir of EMPACOTADOS) {
    for (const arquivo of fontes(dir)) {
      const texto = semComentario(readFileSync(arquivo, "utf8"));
      for (const [re, oQue] of LEITURAS) {
        if (re.test(texto)) {
          achados.push(`${arquivo.replace(RAIZ, "")} — ${oQue}`);
        }
      }
    }
  }
  assert.deepEqual(achados, [],
    "estes modulos leem disco e vao empacotados. O build PASSA e a producao " +
    "quebra na primeira requisicao:\n  " + achados.join("\n  ") +
    "\n\nTroque por import estatico (ver packages/contracts/generated/schemas.mjs).");
});

test("os schemas dos contratos entram por import estatico", () => {
  // A prova positiva do outro lado: o barril gerado tem um import por schema,
  // e o numero bate com o que existe em disco. Um schema novo sem regenerar
  // quebra aqui, e o CI ja recusa diff nao commitado em generated/.
  const barril = readFileSync(join(RAIZ, "packages/contracts/generated/schemas.mjs"), "utf8");
  const importados = [...barril.matchAll(/^import .* from "\.\.\/([^"]+)" with \{ type: "json" \};$/gm)]
    .map((m) => m[1]);

  const emDisco = ["enums", "schemas/io", "schemas/registry", "schemas/domain"]
    .flatMap((d) => readdirSync(join(RAIZ, "packages/contracts", d))
      .filter((f) => f.endsWith(".json")).map((f) => `${d}/${f}`));

  assert.deepEqual([...importados].sort(), [...emDisco].sort(),
    "o barril gerado divergiu do diretorio: rode npm run contracts:generate");
});
