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
import { createMetaGraphAdapter, createFakeMetaAdapter, createWebFetchAdapter,
         createInternalAdapter, conferirPortasInternas } from "@olga/gateway/adapters";

/**
 * @param {{ ports?: any, secrets?: any, mode?: string, tracer?: any, compose?: any }} deps
 *   `compose` e o redator (createComposer). Sem ele o adapter interno funciona
 *   para sete das nove capabilities; as duas que escrevem texto recusam com
 *   PROVIDER_UNAVAILABLE em vez de fingir. Um worker que so escoa outbox nao
 *   precisa de chave de LLM para subir.
 */
export function createAdapters({ ports, secrets, mode = process.env.META_ADAPTER ?? "fake", tracer, compose } = {}) {
  if (mode !== "real" && mode !== "fake") {
    throw new Error(`META_ADAPTER invalido: ${mode} (use "real" ou "fake")`);
  }

  // web_fetch entra nos dois modos: buscar a pagina publica de um cliente nao
  // depende do app review da Meta, e a defesa de SSRF dele nao e opcional.
  const web_fetch = createWebFetchAdapter({ tracer });

  // O adapter interno tambem entra nos dois modos, e por um motivo mais forte:
  // ele nao fala com a Meta. Nove das doze capabilities do registry tem
  // provider_adapter nulo e caem em adapters["internal"] — entre elas as tres
  // do AGT-MKT-COPILOT, que esta ACTIVE. Sem esta linha, o agente promovido
  // responde PROVIDER_UNAVAILABLE a tudo que sabe fazer.
  conferirPortasInternas(ports);
  const internal = createInternalAdapter({
    authoring: ports?.authoring, knowledge: ports?.knowledge,
    publishing: ports?.publishing, compose,
  });

  if (mode === "fake") {
    return { adapters: { internal, meta_graph: createFakeMetaAdapter(), web_fetch }, mode };
  }

  if (!ports?.connections || !ports?.variants) {
    throw new Error("META_ADAPTER=real exige as portas connections e variants");
  }
  if (!secrets?.resolve) {
    throw new Error("META_ADAPTER=real exige uma porta secrets para resolver o secret_ref");
  }

  return {
    adapters: {
      internal,
      meta_graph: createMetaGraphAdapter({
        connections: ports.connections,
        variants: ports.variants,
        secrets, tracer,
      }),
      web_fetch,
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
