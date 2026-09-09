/**
 * Os pacotes do monorepo sao ESM sem build. `transpilePackages` faz o Next
 * compila-los junto em vez de exigir um passo de build por pacote.
 */
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@olga/contracts", "@olga/runtime", "@olga/gateway", "@olga/policy"],
  typedRoutes: true,
  /**
   * `standalone` monta um servidor com apenas o que o app importa de verdade.
   *
   * Sem isto, a imagem do container carregaria o monorepo inteiro — os pacotes
   * de teste, as migrations, o node_modules de todos os workspaces. Na Vercel
   * isso era invisivel porque a plataforma resolvia; no Railway a imagem e
   * nossa, e o que entra nela e escolha nossa (ADR-0012).
   */
  output: "standalone",
};
