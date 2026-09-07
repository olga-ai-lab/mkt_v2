/**
 * O vault: o que ele grava, e o que ele recusa gravar.
 *
 * O invariante e "segredo nunca no banco de dominio". Ate o consentimento por
 * navegador existir, havia um resolvedor so — variavel de ambiente — e ele nao
 * grava. Um callback de OAuth recebe o token em tempo de execucao, e sem uma
 * porta de escrita a saida mais facil seria a pior: uma coluna em
 * `mkt.connections`.
 *
 * O dublê aqui e um pool que guarda o SQL. O que esta em teste e o contrato
 * das duas implementacoes; o Supabase Vault de verdade nao tem como ser
 * exercido neste Postgres, e isso esta dito no ultimo teste em vez de
 * disfarcado.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createEnvSecrets, createVaultSecrets, refDeConexao, SecretError } from "../src/secrets.mjs";

function poolEspiao(respostas = []) {
  const consultas = [];
  let n = 0;
  return {
    consultas,
    async query(sql, params) {
      consultas.push({ sql, params });
      return respostas[n++] ?? { rows: [] };
    },
  };
}

test("o secret_ref tem a forma que o adapter de publicacao ja espera", () => {
  // `meta-graph.mjs` resolve `conn.secret_ref` sem saber quem o escreveu. Se
  // a forma mudar aqui, a publicacao quebra la — e o teste que acusa e este.
  assert.equal(refDeConexao("ig-123"), "vault://meta/ig-123");
});

test("o vault grava o segredo com o proprio secret_ref como nome", async () => {
  const pool = poolEspiao([{ rows: [] }, { rows: [] }]);
  const v = createVaultSecrets(pool);

  await v.store("vault://meta/ig-1", "tok-secreto", { descricao: "Instagram corretora" });

  const [busca, cria] = pool.consultas;
  assert.match(busca.sql, /from vault\.secrets where name = \$1/);
  assert.match(cria.sql, /vault\.create_secret/);
  assert.deepEqual(cria.params, ["tok-secreto", "vault://meta/ig-1", "Instagram corretora"]);
});

test("reconectar substitui o segredo em vez de criar um segundo", async () => {
  // O token longo da Meta dura 60 dias, entao reconectar e rotina. Dois
  // segredos com o mesmo nome deixariam o `resolve` escolhendo um por sorte.
  const pool = poolEspiao([{ rows: [{ id: "sec-1" }] }, { rows: [] }]);
  await createVaultSecrets(pool).store("vault://meta/ig-1", "tok-novo");

  assert.match(pool.consultas[1].sql, /vault\.update_secret/);
  assert.equal(pool.consultas[1].params[0], "sec-1");
  assert.equal(pool.consultas[1].params[1], "tok-novo");
});

test("o vault le pela view de segredos decifrados", async () => {
  const pool = poolEspiao([{ rows: [{ decrypted_secret: "tok" }] }]);
  assert.equal(await createVaultSecrets(pool).resolve("vault://meta/ig-1"), "tok");
  assert.match(pool.consultas[0].sql, /vault\.decrypted_secrets/);
});

test("segredo ausente devolve null, e nao levanta", async () => {
  // `meta-graph.mjs` trata null como CHANNEL_NOT_CONNECTED, que e a resposta
  // certa. Levantar aqui viraria erro de infraestrutura no lugar de "reconecte
  // a conta".
  const pool = poolEspiao([{ rows: [] }]);
  assert.equal(await createVaultSecrets(pool).resolve("vault://meta/sumiu"), null);
  assert.equal(await createVaultSecrets(pool).resolve(null), null);
});

test("gravar sem valor ou sem referencia e recusado antes de tocar no banco", async () => {
  const pool = poolEspiao();
  const v = createVaultSecrets(pool);
  await assert.rejects(() => v.store("", "tok"), (e) => e instanceof SecretError);
  await assert.rejects(() => v.store("vault://meta/x", ""), (e) => e instanceof SecretError);
  assert.equal(pool.consultas.length, 0, "nada pode chegar ao banco antes da conferencia");
});

test("o resolvedor por ambiente le a variavel derivada do secret_ref", async () => {
  const s = createEnvSecrets({ META_SECRET_META_CONN1: "tok-123" });
  assert.equal(await s.resolve("vault://meta/conn1"), "tok-123");
  assert.equal(await s.resolve("vault://meta/desconhecida"), null);
});

test("o resolvedor por ambiente RECUSA gravar, e diz por que", async () => {
  // A recusa e o ponto deste teste. Uma porta que aceitasse e esquecesse
  // deixaria a conexao ACTIVE apontando para um segredo inexistente, e a falha
  // apareceria na primeira publicacao, longe da causa.
  const s = createEnvSecrets({});
  await assert.rejects(() => s.store("vault://meta/x", "tok"), (e) => {
    assert.equal(e.reason_code, "PROVIDER_UNAVAILABLE");
    assert.match(e.message, /somente leitura/);
    return true;
  });
});

test("o que este arquivo NAO prova", () => {
  // Registrado como teste para nao virar nota de rodape que ninguem le: o
  // Supabase Vault de verdade nao e exercido aqui. `vault.create_secret` vem
  // da extensao supabase_vault, que nao existe no Postgres dos testes. O que
  // esta provado e a forma das chamadas; que a extensao se comporta como
  // esperado depende de rodar contra o projeto Supabase.
  assert.ok(true);
});
