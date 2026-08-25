/**
 * Onde se escolhe entre o adapter falso e o real.
 *
 * Este arquivo e pequeno de proposito: ele e a prova de que a espera pela Meta
 * (ADR-0008) custa uma variavel de ambiente, e nao uma integracao. O gateway
 * recebe um objeto `adapters` e nunca pergunta qual e qual.
 *
 * META_ADAPTER=real  exige as portas e as credenciais de verdade.
 * META_ADAPTER=fake  (padrao) roda o produto inteiro de ponta a ponta.
 *
 * O padrao e o falso por decisao, nao por esquecimento: enquanto o app review
 * nao sair, "real" nao tem como funcionar, e um default que falha ao subir
 * seria um default que esconde a espera atras de um erro de boot.
 */
import { createMetaGraphAdapter, createFakeMetaAdapter } from "@olga/gateway/adapters";

export function createAdapters({ ports, secrets, mode = process.env.META_ADAPTER ?? "fake", tracer } = {}) {
  if (mode !== "real" && mode !== "fake") {
    throw new Error(`META_ADAPTER invalido: ${mode} (use "real" ou "fake")`);
  }

  if (mode === "fake") {
    return { adapters: { meta_graph: createFakeMetaAdapter() }, mode };
  }

  if (!ports?.connections || !ports?.variants) {
    throw new Error("META_ADAPTER=real exige as portas connections e variants");
  }
  if (!secrets?.resolve) {
    throw new Error("META_ADAPTER=real exige uma porta secrets para resolver o secret_ref");
  }

  return {
    adapters: {
      meta_graph: createMetaGraphAdapter({
        connections: ports.connections,
        variants: ports.variants,
        secrets, tracer,
      }),
    },
    mode,
  };
}

/**
 * Resolvedor de segredo por variavel de ambiente.
 *
 * Serve para desenvolvimento e para um deploy simples; a interface e a mesma
 * que um vault de verdade implementa, entao trocar nao mexe no adapter.
 * Um `secret_ref` de "vault://meta/conn1" procura META_SECRET_CONN1.
 */
export function createEnvSecrets(env = process.env) {
  return {
    async resolve(secret_ref) {
      if (!secret_ref) return null;
      const chave = "META_SECRET_" + String(secret_ref)
        .replace(/^\w+:\/\//, "")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .toUpperCase();
      return env[chave] ?? null;
    },
  };
}
