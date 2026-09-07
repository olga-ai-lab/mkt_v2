/**
 * O vault: onde o token vive, e onde ele NAO vive.
 *
 * O invariante do repositorio e curto — "segredo nunca no banco de dominio".
 * `mkt.connections.secret_ref` guarda a referencia; quem resolve a referencia
 * e o vault (ADR-0005, ADR-0014).
 *
 * ── O buraco que este arquivo fecha ────────────────────────────────────────
 *
 * Ate aqui existia UM resolvedor, `createEnvSecrets`, que le variavel de
 * ambiente. Ele resolve e nao grava. Enquanto o token era colado a mao no
 * deploy isso bastava; um callback de OAuth recebe o token em tempo de
 * execucao e precisa guarda-lo em algum lugar.
 *
 * Sem uma porta de escrita, a saida mais provavel seria a pior: gravar o token
 * numa coluna de `mkt.connections`. Este modulo existe para que essa saida nao
 * seja a mais facil.
 *
 * ── As duas implementacoes, e por que as duas ──────────────────────────────
 *
 * `createVaultSecrets` usa o Supabase Vault: o segredo e cifrado em repouso
 * com uma chave que nao esta no banco, e `vault.decrypted_secrets` so responde
 * para quem tem o papel. E o vault que o projeto ja tem, e nao um servico novo
 * para operar.
 *
 * `createEnvSecrets` continua servindo desenvolvimento e o deploy simples — e
 * agora RECUSA gravar, dizendo por que. Uma porta que aceita gravar e esquece
 * seria pior que uma que recusa: a conexao apareceria ACTIVE e a primeira
 * publicacao falharia com "credencial nao encontrada", longe da causa.
 */

export class SecretError extends Error {
  constructor(reason_code, message) {
    super(message);
    this.reason_code = reason_code;
  }
}

/** `vault://meta/<id>` — a forma que o adapter de publicacao ja espera. */
export const refDeConexao = (id) => `vault://meta/${id}`;

/**
 * Vault do Supabase.
 *
 * `vault.create_secret` e `vault.update_secret` sao funcoes da extensao
 * `supabase_vault`. O nome do segredo e o proprio `secret_ref`, e nao um id
 * gerado: assim a referencia guardada em `connections` e suficiente para
 * achar o segredo, sem uma terceira tabela de-para que poderia dessincronizar.
 */
export function createVaultSecrets(pool) {
  return {
    async resolve(secret_ref) {
      if (!secret_ref) return null;
      const { rows } = await pool.query(
        `select decrypted_secret from vault.decrypted_secrets where name = $1`, [secret_ref]);
      return rows[0]?.decrypted_secret ?? null;
    },

    /**
     * Grava, ou substitui se ja existir.
     *
     * Reconectar o mesmo canal e o caso normal — token expira a cada 60 dias —
     * e criar um segundo segredo com o mesmo nome deixaria dois vivos, com o
     * `resolve` escolhendo um deles por sorte.
     */
    /**
     * @param {string} secret_ref
     * @param {string} valor
     * @param {{ descricao?: string|null }} [opcoes]
     * @returns {Promise<string>}
     */
    async store(secret_ref, valor, { descricao = null } = {}) {
      if (!secret_ref) throw new SecretError("SCHEMA_VALIDATION_FAILED", "secret_ref vazio");
      if (!valor) throw new SecretError("SCHEMA_VALIDATION_FAILED", "segredo vazio");

      const { rows } = await pool.query(
        `select id from vault.secrets where name = $1`, [secret_ref]);

      if (rows[0]) {
        await pool.query(`select vault.update_secret($1, $2, $3, $4)`,
          [rows[0].id, valor, secret_ref, descricao]);
      } else {
        await pool.query(`select vault.create_secret($1, $2, $3)`,
          [valor, secret_ref, descricao]);
      }
      return secret_ref;
    },
  };
}

/**
 * Resolvedor por variavel de ambiente.
 *
 * Move de apps/worker/src/adapters.mjs para ca porque agora tem dois donos: o
 * worker, que resolve para publicar, e o app web, que precisa saber que NAO
 * consegue gravar.
 *
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

    /**
     * @param {string} [_secret_ref]
     * @param {string} [_valor]
     * @param {{ descricao?: string|null }} [_opcoes]
     * @returns {Promise<string>}
     */
    async store(_secret_ref, _valor, _opcoes) {
      // Recusa nomeada, e nao silenciosa. Quem chamou precisa decidir o que
      // fazer; fingir que gravou deixaria a conexao ACTIVE apontando para um
      // segredo que nao existe.
      throw new SecretError("PROVIDER_UNAVAILABLE",
        "este vault e somente leitura (variavel de ambiente). " +
        "Conectar canal pelo navegador exige um vault com escrita — ver ADR-0014.");
    },
  };
}
