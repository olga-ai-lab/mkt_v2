#!/usr/bin/env node
/**
 * Gera, a partir dos JSON Schemas, duas coisas:
 *
 *   generated/schemas.mjs   o barril de imports estaticos (runtime)
 *   generated/index.d.ts    os tipos TypeScript
 *
 * Editar generated/ a mao e proibido, e o CI reprova (`git diff --exit-code`).
 *
 * ── Por que o barril existe ────────────────────────────────────────────────
 *
 * `src/index.mjs` lia os schemas com `readdirSync` + `readFileSync`. Funciona
 * em `node --test` e falha empacotado: o rastreador de arquivos do Next segue
 * `import`, nao caminho montado em tempo de execucao. Os 34 .json ficavam de
 * fora do bundle.
 *
 * O build passava — ele roda com o disco do repositorio inteiro a mao — e a
 * primeira requisicao em producao quebraria, em qualquer rota, porque
 * `assertValid` esta em todas. Um deploy verde e um 500 imediato.
 *
 * Este script continua lendo o diretorio, e pode: e script de build, roda em
 * Node com fs. O que ele emite e que precisa ser estatico.
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "generated");
mkdirSync(OUT, { recursive: true });

/** As quatro pastas, na ordem em que o barril as expoe. */
const PASTAS = {
  enums: "enums",
  ioSchemas: "schemas/io",
  registrySchemas: "schemas/registry",
  domainSchemas: "schemas/domain",
};

const arquivosDe = (rel) =>
  readdirSync(join(ROOT, rel)).filter((f) => f.endsWith(".json")).sort();

// ── generated/schemas.mjs ───────────────────────────────────────────────────
//
// Um identificador por arquivo, derivado do caminho: dois schemas de pastas
// diferentes podem ter o mesmo nome, e um `import x` repetido nao compila.
const ident = (rel, f) =>
  `s_${rel.replace(/[^a-z]/gi, "_")}_${f.replace(/\.json$/, "").replace(/[^a-z0-9]/gi, "_")}`;

const imports = [];
const grupos = [];
for (const [nome, rel] of Object.entries(PASTAS)) {
  const ids = arquivosDe(rel).map((f) => {
    const id = ident(rel, f);
    imports.push(`import ${id} from "../${rel}/${f}" with { type: "json" };`);
    return id;
  });
  grupos.push(`export const ${nome} = [\n  ${ids.join(",\n  ")},\n];`);
}

writeFileSync(join(OUT, "schemas.mjs"),
  [
    "// GERADO POR scripts/generate.mjs - NAO EDITAR A MAO",
    "//",
    "// Imports estaticos de proposito: o rastreador de arquivos do bundler segue",
    "// `import` e nao caminho montado em tempo de execucao. Ler o diretorio aqui",
    "// deixaria os .json fora do bundle, e toda rota quebraria na primeira",
    "// requisicao — porque `assertValid` esta em todas.",
    "",
    ...imports,
    "",
    ...grupos,
    "",
    "export const allSchemas = [...enums, ...ioSchemas, ...registrySchemas, ...domainSchemas];",
    "",
  ].join("\n"));

const total = Object.values(PASTAS).reduce((n, rel) => n + arquivosDe(rel).length, 0);
console.log(`ok  generated/schemas.mjs (${total} schemas)`);

const { allSchemas, ioSchemas, registrySchemas, domainSchemas } =
  await import(join(OUT, "schemas.mjs"));

const byId = Object.fromEntries(allSchemas.map((s) => [s.$id, s]));

const parts = ["// GERADO POR scripts/generate.mjs - NAO EDITAR A MAO", ""];
for (const schema of [...ioSchemas, ...registrySchemas, ...domainSchemas]) {
  const ts = await compile(schema, schema.title, {
    bannerComment: "",
    additionalProperties: false,
    $refOptions: { resolve: { olga: {
      order: 1,
      canRead: /^olga:\/\//,
      read: (file) => JSON.stringify(byId[file.url.replace(/\/$/, "")] ?? byId[file.url]),
    } } },
  });
  parts.push(ts.trim(), "");
}
writeFileSync(join(OUT, "index.d.ts"), parts.join("\n"));
console.log(`ok  generated/index.d.ts  (${ioSchemas.length + registrySchemas.length + domainSchemas.length} tipos)`);
