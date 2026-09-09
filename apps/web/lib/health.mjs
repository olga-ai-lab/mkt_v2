/**
 * A decisao do healthcheck, fora do handler HTTP.
 *
 * Mesma divisao de `lib/auth.ts` e `lib/session.mjs`: a rota e fina, e o que
 * decide roda em teste sem subir Next.
 *
 * ── Por que ele toca o banco ───────────────────────────────────────────────
 *
 * Um healthcheck que so responde 200 declara vivo um processo que perdeu o
 * Postgres. A plataforma entao mantem de pe exatamente o que nao serve, e o
 * sintoma aparece para o usuario em vez de aparecer no orquestrador — que e o
 * oposto do que um healthcheck existe para fazer.
 *
 * ── Por que ele NAO toca mais nada ─────────────────────────────────────────
 *
 * Nem modelo, nem Meta, nem Inngest. Um healthcheck que depende de terceiros
 * derruba o nosso deploy quando o terceiro cai, e a plataforma passa a
 * reiniciar em looping um processo saudavel. Dependencia externa e assunto do
 * reason code na requisicao real, nao da prontidao do container.
 */

/**
 * @param {{ query: (sql: string) => Promise<unknown> }} pool
 * @param {{ schema?: string, agora?: () => number }} [opcoes]
 * @returns {Promise<{ codigo: number, corpo: object }>}
 */
export async function verificarSaude(pool, { schema, agora = Date.now } = {}) {
  const inicio = agora();
  try {
    // `select 1` pelo pool confere duas coisas de uma vez: que ha conexao, e
    // que o pool nao esta esgotado. Um pool cheio responde tao mal quanto um
    // banco fora, e so o segundo seria visivel por um ping de rede.
    await pool.query("select 1");
    return {
      codigo: 200,
      corpo: { status: "ok", schema: schema ?? "mkt", db_ms: agora() - inicio },
    };
  } catch {
    // 503, e nao 500: e indisponibilidade, e o orquestrador trata as duas de
    // formas diferentes. A causa nao vai no corpo — mensagem de erro de banco
    // num endpoint publico e superficie de reconhecimento de graca.
    return { codigo: 503, corpo: { status: "degraded" } };
  }
}
