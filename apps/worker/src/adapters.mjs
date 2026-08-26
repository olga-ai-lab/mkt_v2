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
         createInternalAdapter, createBrandExtractAdapter,
         conferirPortasInternas } from "@olga/gateway/adapters";

/**
 * @param {{ ports?: any, secrets?: any, mode?: string, tracer?: any,
 *           compose?: any, extract?: any }} deps
 *   `compose` e o redator (createComposer) e `extract` e o extrator de marca
 *   (createBrandExtractor). Sem eles as capabilities que dependem de modelo
 *   recusam com PROVIDER_UNAVAILABLE em vez de fingir — um worker que so escoa
 *   outbox nao precisa de chave de LLM para subir.
 */
export function createAdapters({ ports, secrets, mode = process.env.META_ADAPTER ?? "fake",
                                 tracer, compose, extract } = {}) {
  if (mode !== "real" && mode !== "fake") {
    throw new Error(`META_ADAPTER invalido: ${mode} (use "real" ou "fake")`);
  }

  // web_fetch entra nos dois modos: buscar a pagina publica de um cliente nao
  // depende do app review da Meta, e a defesa de SSRF dele nao e opcional.
  const web_fetch = createWebFetchAdapter({ tracer });

  // brand_extract compoe o web_fetch com a leitura por modelo. Ele entra pelo
  // mesmo motivo que o internal: desde a migration 0010 o registry manda
  // brand.extract_from_url para ca, e um adapter declarado no registry que nao
  // existe no mapa vira PROVIDER_UNAVAILABLE no primeiro pedido de um cliente.
  // Ha teste comparando as duas listas, porque foi assim que "internal" ficou
  // faltando por tres migrations.
  const brand_extract = createBrandExtractAdapter({
    knowledge: ports?.knowledge, fetcher: web_fetch, extract,
  });

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
    return { adapters: { internal, meta_graph: createFakeMetaAdapter(), web_fetch, brand_extract }, mode };
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
      brand_extract,
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
