/**
 * A configuração da Meta lida num lugar só.
 *
 * Duas rotas precisam das mesmas quatro coisas, e ler `process.env` em cada
 * uma é como um valor faltando vira dois erros diferentes na mesma jornada.
 * Aqui a falta é uma só, com o nome do que falta.
 */
import { pool } from "./db";
import { createVaultSecrets, createEnvSecrets } from "@olga/runtime/secrets";

export type ConfigMeta = {
  app_id: string;
  app_secret: string;
  redirect_uri: string;
};

/** Devolve a config, ou a lista do que falta. Nunca lança: quem chama responde. */
export function configMeta(): { config: ConfigMeta } | { faltando: string[] } {
  const faltando = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI"]
    .filter((k) => !process.env[k]);
  if (faltando.length) return { faltando };
  return {
    config: {
      app_id: process.env.META_APP_ID!,
      app_secret: process.env.META_APP_SECRET!,
      redirect_uri: process.env.META_REDIRECT_URI!,
    },
  };
}

/**
 * O vault em uso.
 *
 * `META_VAULT=supabase` escolhe o Vault do Supabase, que grava. O padrão é o
 * resolvedor por variável de ambiente, que RECUSA gravar dizendo por quê —
 * ver ADR-0014. O padrão é o que não grava de propósito: um vault escolhido
 * por engano deve falhar ao conectar, não guardar o token no lugar errado.
 */
export const vault = () =>
  process.env.META_VAULT === "supabase" ? createVaultSecrets(pool) : createEnvSecrets();
