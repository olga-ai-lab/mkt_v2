#!/usr/bin/env node
/**
 * Gera tipos TypeScript a partir dos JSON Schemas.
 * Os tipos sao derivados; editar generated/ a mao e proibido e o CI reprova.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { allSchemas, ioSchemas, registrySchemas, domainSchemas } from "../src/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "generated");
mkdirSync(OUT, { recursive: true });

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
