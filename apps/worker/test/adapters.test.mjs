import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdapters, createEnvSecrets } from "../src/adapters.mjs";

const portas = { connections: { get: async () => null }, variants: { get: async () => null } };
const secrets = { resolve: async () => "tok" };

test("o padrao e o adapter falso, e isso e decisao, nao esquecimento", () => {
  const { adapters, mode } = createAdapters({ mode: undefined, ports: portas, secrets });
  assert.equal(mode, "fake");
  assert.equal(typeof adapters.meta_graph.call, "function");
});

test("modo real monta o adapter do Meta Graph", () => {
  const { adapters, mode } = createAdapters({ mode: "real", ports: portas, secrets });
  assert.equal(mode, "real");
  assert.equal(adapters.meta_graph.name, "meta_graph");
});

test("modo real sem portas falha ao montar, nao na hora de publicar", () => {
  assert.throws(() => createAdapters({ mode: "real", ports: {}, secrets }), /connections e variants/);
  assert.throws(() => createAdapters({ mode: "real", ports: portas, secrets: {} }), /secrets/);
});

test("modo desconhecido nao vira falso silenciosamente", () => {
  assert.throws(() => createAdapters({ mode: "producao", ports: portas, secrets }), /META_ADAPTER invalido/);
});

test("os dois adapters expoem a mesma porta para o gateway", () => {
  const falso = createAdapters({ mode: "fake" }).adapters.meta_graph;
  const real = createAdapters({ mode: "real", ports: portas, secrets }).adapters.meta_graph;
  // Se esta igualdade quebrar, o gateway passa a distinguir um do outro — e a
  // fronteira que permite esperar a Meta sem travar o resto deixa de existir.
  assert.deepEqual(
    Object.keys(falso).filter((k) => typeof falso[k] === "function"),
    Object.keys(real).filter((k) => typeof real[k] === "function"));
});

test("o resolvedor de segredo traduz o secret_ref para variavel de ambiente", async () => {
  const s = createEnvSecrets({ META_SECRET_META_CONN1: "tok-123" });
  assert.equal(await s.resolve("vault://meta/conn1"), "tok-123");
  assert.equal(await s.resolve("vault://meta/desconhecida"), null);
  assert.equal(await s.resolve(null), null);
});

test("web_fetch entra nos dois modos", () => {
  // Buscar a pagina publica de um cliente nao depende do app review da Meta,
  // e a defesa de SSRF do adapter nao e opcional em nenhum modo.
  for (const mode of ["fake", "real"]) {
    const { adapters } = createAdapters({ mode, ports: portas, secrets });
    assert.equal(adapters.web_fetch?.name, "web_fetch", `falta web_fetch em modo ${mode}`);
  }
});

test("o registry nomeia web_fetch, e a montagem entrega esse nome", () => {
  // O gateway resolve o adapter por cap.provider_adapter. Se o nome divergisse,
  // brand.extract_from_url falharia com PROVIDER_UNAVAILABLE na primeira
  // execucao real, e nao antes.
  const { adapters } = createAdapters({ mode: "fake" });
  assert.ok("web_fetch" in adapters);
  assert.ok("meta_graph" in adapters);
});
