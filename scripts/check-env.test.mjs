/**
 * O conferidor de ambiente tem de reprovar o que ele existe para pegar.
 *
 * Um verificador que aprova tudo passa por correto ate o dia em que era para
 * ele ter falado. Cada teste aqui e um deploy quebrado que ja aconteceu ou que
 * o codigo permite acontecer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "check-env.mjs");

const COMPLETO = {
  DATABASE_URL: "postgres://x", MKT_SCHEMA: "mkt_v2",
  SUPABASE_URL: "https://x", SUPABASE_ANON_KEY: "k", SUPABASE_JWT_SECRET: "s",
  ANTHROPIC_API_KEY: "a", INNGEST_EVENT_KEY: "e", INNGEST_SIGNING_KEY: "g",
  INNGEST_SERVE_ORIGIN: "https://olga.up.railway.app",
};

/** Roda o script com um ambiente montado do zero e devolve saida e codigo. */
function conferir(env, args = []) {
  try {
    const out = execFileSync(process.execPath, [script, ...args], {
      env: { PATH: process.env.PATH, ...env }, encoding: "utf8",
    });
    return { codigo: 0, out };
  } catch (e) {
    return { codigo: e.status, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("ambiente completo passa", () => {
  const { codigo } = conferir(COMPLETO);
  assert.equal(codigo, 0);
});

test("cada variavel exigida, sozinha, reprova o deploy", () => {
  // Sem este laco, uma regra removida por engano nao seria notada: o teste do
  // caminho feliz continuaria verde.
  for (const chave of Object.keys(COMPLETO)) {
    const parcial = { ...COMPLETO };
    delete parcial[chave];
    const { codigo, out } = conferir(parcial);
    assert.equal(codigo, 1, `${chave} ausente deveria reprovar`);
    assert.match(out, new RegExp(chave), `a saida precisa NOMEAR ${chave}`);
  }
});

test("a mensagem diz a consequencia, e nao so que falta", () => {
  // "INNGEST_SIGNING_KEY: FALTA" nao ajuda quem nao conhece o sistema. O que
  // ajuda e saber que sem ela as publicacoes ficam agendadas para sempre.
  const { MKT_SCHEMA, ...semSchema } = COMPLETO;
  assert.match(conferir(semSchema).out, /dados que nao sao nossos/);

  const { INNGEST_SIGNING_KEY, ...semKey } = COMPLETO;
  assert.match(conferir(semKey).out, /agendadas para sempre/);
});

test("MKT_SCHEMA com forma invalida reprova, e nao so quando falta", () => {
  const { codigo, out } = conferir({ ...COMPLETO, MKT_SCHEMA: "mkt; drop schema" });
  assert.equal(codigo, 1);
  assert.match(out, /schema invalido/);
});

test("META_ADAPTER invalido reprova antes do boot", () => {
  // `createAdapters` ja recusa, mas ali o erro aparece na subida do worker.
  // Aqui aparece antes de subir qualquer coisa.
  assert.equal(conferir({ ...COMPLETO, META_ADAPTER: "talvez" }).codigo, 1);
  assert.equal(conferir({ ...COMPLETO, META_ADAPTER: "fake" }).codigo, 0);
});

test("as variaveis da Meta so sao exigidas em modo real", () => {
  // Exigi-las sempre transformaria a espera pelo app review (ADR-0008) num
  // erro de configuracao, e o produto roda inteiro com o adapter falso.
  assert.equal(conferir({ ...COMPLETO, META_ADAPTER: "fake" }).codigo, 0);

  const { codigo, out } = conferir({ ...COMPLETO, META_ADAPTER: "real" });
  assert.equal(codigo, 1);
  for (const k of ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "META_VAULT"]) {
    assert.match(out, new RegExp(k));
  }
});

test("modo real com vault somente leitura reprova", () => {
  // A recusa acontece no callback de qualquer forma, mas descobrir isso ao
  // conectar significa descobrir na frente do cliente.
  const real = { ...COMPLETO, META_ADAPTER: "real", META_APP_ID: "1",
                 META_APP_SECRET: "2", META_REDIRECT_URI: "3" };
  assert.equal(conferir(real).codigo, 1);
  assert.equal(conferir({ ...real, META_VAULT: "env" }).codigo, 1);
  assert.equal(conferir({ ...real, META_VAULT: "supabase" }).codigo, 0);
});

test("--dev afrouxa o que so vale em producao, e nada alem disso", () => {
  const { INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, INNGEST_SERVE_ORIGIN, ...semInngest } = COMPLETO;
  assert.equal(conferir(semInngest, ["--dev"]).codigo, 0);

  // Mas nao afrouxa o resto: banco e sessao continuam exigidos.
  const { DATABASE_URL, ...semBanco } = semInngest;
  assert.equal(conferir(semBanco, ["--dev"]).codigo, 1);
});

// ── Railway (ADR-0012) ─────────────────────────────────────────────────────

test("INNGEST_SERVE_ORIGIN e exigido, e a mensagem diz por que", () => {
  // Das oito variaveis, esta e uma das duas que nao aparecem como erro em
  // lugar nenhum quando faltam: o registro acontece com a URL errada, o deploy
  // fica verde, e o workflow duravel simplesmente nunca e chamado.
  const { INNGEST_SERVE_ORIGIN, ...sem } = COMPLETO;
  const { codigo, out } = conferir(sem);
  assert.equal(codigo, 1);
  assert.match(out, /nunca e chamado/);
});

test("INNGEST_SERVE_ORIGIN sem https e recusado", () => {
  // Atras do proxy do Railway, http vira redirect e o registro do Inngest
  // aponta para um lugar que responde 301 em vez de executar a funcao.
  assert.equal(conferir({ ...COMPLETO, INNGEST_SERVE_ORIGIN: "olga.up.railway.app" }).codigo, 1);
  assert.equal(conferir({ ...COMPLETO, INNGEST_SERVE_ORIGIN: "http://olga.test" }).codigo, 1);
});

test("PORT e opcional, mas porta invalida reprova", () => {
  // O Railway injeta PORT em runtime e o Dockerfile traz 3000 como padrao,
  // entao a ausencia e aviso. Um valor sem sentido, nao.
  assert.equal(conferir(COMPLETO).codigo, 0, "sem PORT continua passando");
  assert.equal(conferir({ ...COMPLETO, PORT: "3000" }).codigo, 0);
  assert.equal(conferir({ ...COMPLETO, PORT: "oitenta" }).codigo, 1);
  assert.equal(conferir({ ...COMPLETO, PORT: "99999" }).codigo, 1);
});
