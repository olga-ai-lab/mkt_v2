#!/usr/bin/env node
/**
 * Traz o desenho do Lovable para dentro do monorepo.
 *
 *   node scripts/sync-prototipo.mjs            # clona e sincroniza
 *   node scripts/sync-prototipo.mjs --check    # so diz se ha diferenca
 *   ORIGEM=/caminho/local node scripts/sync-prototipo.mjs
 *
 * ── Por que existem dois repositorios, e por que isso NAO e para consertar ──
 *
 * O Lovable monta um app inteiro na RAIZ do repositorio, a partir de um
 * template fixo (`.lovable/project.json` diz qual). Ele nao sabe escrever
 * dentro de `apps/web/` de um monorepo que ja existe — se fosse apontado para
 * o mkt_v2, tentaria ser dono do package.json da raiz.
 *
 * E a sincronia dele e de MAO DUPLA: o que se empurra para `main` la volta a
 * aparecer no editor. Ou seja, `marketplace-sync` nao e um export que sobrou de
 * um acidente: e a prancheta, e ela precisa continuar viva para o Lovable
 * continuar servindo para desenhar.
 *
 * O que este script faz e transformar "dois repositorios" de problema em
 * processo: um comando, com verificacao, em vez de copiar pasta na mao e
 * torcer.
 *
 * ── A regra que impede os dois de brigarem ─────────────────────────────────
 *
 * Cada lado e dono de uma coisa, e so de uma:
 *
 *   LAYOUT e visual      -> Lovable manda. Desenhe la, sincronize para ca.
 *   LIGACAO com dados    -> mkt_v2 manda. Nunca se escreve isso no Lovable.
 *
 * Por isso `apps/web/mktos/` e copia LITERAL e ninguem a edita a mao. Tudo o
 * que liga tela a banco mora em `apps/web/app/<rota>/page.tsx`, fora daqui, e
 * sobrevive a toda sincronizacao.
 *
 * O manifesto abaixo e o que faz essa regra valer em vez de ser um combinado:
 * se alguem editar um arquivo copiado, o hash nao bate e a sincronizacao PARA,
 * em vez de apagar o trabalho da pessoa em silencio. E o mesmo mecanismo do
 * `prompts.lock.json`.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = join(RAIZ, "apps/web/mktos");
const MANIFESTO = join(DESTINO, ".sync.json");
const REPO = "https://github.com/olga-ai-lab/marketplace-sync";
const SUBPASTA = "src/mktos";

/**
 * Os tres arquivos que entram no grafo de modulos do Next pela pagina.
 *
 * A transformacao e deterministica de proposito: uma sincronizacao que
 * dependesse de alguem lembrar de reaplicar `"use client"` seria uma
 * sincronizacao que quebra o build de vez em quando.
 */
const CLIENTE = new Set(["store.tsx", "MarketingOS.tsx", "css.tsx"]);
const transformar = (rel, texto) =>
  CLIENTE.has(rel) && !texto.startsWith('"use client"') ? `"use client";\n${texto}` : texto;

const sha = (t) => createHash("sha256").update(t).digest("hex").slice(0, 16);

const arquivosDe = (base, prefixo = "") =>
  readdirSync(join(base, prefixo), { withFileTypes: true }).flatMap((e) => {
    const rel = prefixo ? `${prefixo}/${e.name}` : e.name;
    if (e.isDirectory()) return arquivosDe(base, rel);
    return e.name.startsWith(".") ? [] : [rel];
  });

// ── Origem ──────────────────────────────────────────────────────────────────
let origem = process.env.ORIGEM;
let temporario = null;
if (!origem) {
  temporario = join(process.env.TMPDIR ?? "/tmp", `mktos-sync-${process.pid}`);
  console.log(`clonando ${REPO}...`);
  execFileSync("git", ["clone", "--depth", "1", "-q", REPO, temporario], { stdio: "inherit" });
  origem = temporario;
}
const pastaOrigem = join(origem, SUBPASTA);
if (!existsSync(pastaOrigem)) {
  console.error(`nao achei ${SUBPASTA} em ${origem}`);
  process.exit(1);
}

const limpar = () => { if (temporario) rmSync(temporario, { recursive: true, force: true }); };

try {
  // ── 1. Ninguem editou a copia a mao? ──────────────────────────────────────
  //
  // Esta e a checagem que impede o script de ser perigoso. Sem ela, uma
  // sincronizacao apagaria em silencio qualquer ajuste feito aqui — e a pessoa
  // so descobriria quando a tela voltasse a ficar errada.
  const manifesto = existsSync(MANIFESTO) ? JSON.parse(readFileSync(MANIFESTO, "utf8")) : null;
  if (manifesto) {
    const sujos = Object.entries(manifesto.arquivos)
      .filter(([rel, h]) => {
        const p = join(DESTINO, rel);
        return !existsSync(p) || sha(readFileSync(p, "utf8")) !== h;
      })
      .map(([rel]) => rel);
    if (sujos.length > 0) {
      console.error(
        "PAROU: estes arquivos foram editados a mao depois da ultima sincronizacao:\n" +
        sujos.map((r) => `  apps/web/mktos/${r}`).join("\n") +
        "\n\nA copia e literal por desenho: o que liga tela a dado mora em\n" +
        "apps/web/app/<rota>/page.tsx, fora daqui. Leve a mudanca para o Lovable\n" +
        "(se for layout) ou para a pagina (se for ligacao), e rode de novo.");
      process.exit(2);
    }
  }

  // ── 2. O que mudou ────────────────────────────────────────────────────────
  const novos = {};
  const mudancas = { novo: [], alterado: [], removido: [] };
  for (const rel of arquivosDe(pastaOrigem)) {
    const conteudo = transformar(rel, readFileSync(join(pastaOrigem, rel), "utf8"));
    novos[rel] = sha(conteudo);
    const atual = join(DESTINO, rel);
    if (!existsSync(atual)) mudancas.novo.push(rel);
    else if (sha(readFileSync(atual, "utf8")) !== novos[rel]) mudancas.alterado.push(rel);
  }
  for (const rel of Object.keys(manifesto?.arquivos ?? {})) {
    if (!(rel in novos)) mudancas.removido.push(rel);
  }

  const total = mudancas.novo.length + mudancas.alterado.length + mudancas.removido.length;
  if (total === 0 && manifesto) {
    console.log("o prototipo ja esta igual ao Lovable.");
    limpar();
    process.exit(0);
  }
  // Sem manifesto e sem diferenca ainda ha trabalho a fazer: ESCREVER o
  // manifesto. Sair aqui deixaria a guarda de edicao a mao desarmada, e ela so
  // faria falta no dia em que apagasse o trabalho de alguem.

  for (const [rotulo, lista] of Object.entries(mudancas)) {
    for (const rel of lista) console.log(`  ${rotulo.padEnd(9)} ${rel}`);
  }
  if (total === 0) console.log("  nenhuma diferenca; so registrando o manifesto.");

  if (process.argv.includes("--check")) {
    console.log(`\n${total} diferenca(s). Rode sem --check para aplicar.`);
    limpar();
    process.exit(1);
  }

  // ── 3. Aplica ─────────────────────────────────────────────────────────────
  for (const rel of Object.keys(novos)) {
    const alvo = join(DESTINO, rel);
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, transformar(rel, readFileSync(join(pastaOrigem, rel), "utf8")));
  }
  for (const rel of mudancas.removido) rmSync(join(DESTINO, rel), { force: true });

  const origem_sha = execFileSync("git", ["-C", origem, "rev-parse", "HEAD"]).toString().trim();
  writeFileSync(MANIFESTO, JSON.stringify({
    _: "GERADO. Nao edite arquivos de apps/web/mktos/ a mao — ver o cabecalho de scripts/sync-prototipo.mjs.",
    origem: REPO, commit: origem_sha, arquivos: novos,
  }, null, 2) + "\n");

  console.log(`\n${total} arquivo(s) sincronizados de ${origem_sha.slice(0, 8)}.`);
  console.log("Confira com: npm run build:web");
} finally {
  limpar();
}
