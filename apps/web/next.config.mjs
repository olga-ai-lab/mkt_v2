/**
 * Os pacotes do monorepo sao ESM sem build. `transpilePackages` faz o Next
 * compila-los junto em vez de exigir um passo de build por pacote.
 */
/** @type {import('next').NextConfig} */
export default {
  transpilePackages: ["@olga/contracts", "@olga/runtime", "@olga/gateway", "@olga/policy"],
  typedRoutes: true,
};
