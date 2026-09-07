#!/usr/bin/env node
/**
 * Confere o ambiente ANTES de subir, e falha com o nome do que falta.
 *
 * Este script existe pelo mesmo motivo que `conferirSuperficie()` e
 * `conferirPortasInternas()`: neste repositorio, o erro que mais custou nao foi
 * falta de teste — foi falta de alguem montar. Uma variavel ausente nao quebra
 * o boot do Next; ela quebra a primeira requisicao que precisar dela, e o
 * sintoma aparece longe da causa.
 *
 * Tres exemplos ja vistos aqui, e cada um vira uma linha abaixo:
 *
 *   SUPABASE_JWT_SECRET ausente  -> ninguem entra, e a mensagem fala de token
 *   MKT_SCHEMA ausente           -> o app le o schema `mkt`, que nao e nosso
 *   INNGEST_SIGNING_KEY ausente  -> o workflow durable nunca e chamado, e nada
 *                                   falha: as publicacoes simplesmente ficam
 *                                   agendadas para sempre
 *
 * O ultimo e o pior tipo: falha silenciosa que parece lentidao.
 *
 * Uso:
 *   node scripts/check-env.mjs           confere o perfil de producao
 *   node scripts/check-env.mjs --dev     afrouxa o que so vale em producao
 */
const dev = process.argv.includes("--dev");
const env = process.env;

/**
 * @typedef {{ nome: string, porque: string, alternativa?: string,
 *             quando?: () => boolean, valida?: (v: string) => string|null,
 *             opcional?: boolean }} Regra
 */

/** @type {Regra[]} */
const REGRAS = [
  {
    nome: "DATABASE_URL",
    porque: "sem banco nao ha portas: o app nao serve uma unica tela.",
  },
  {
    nome: "MKT_SCHEMA",
    porque:
      "sem isto o app le o schema `mkt`, que no projeto de producao tem dados " +
      "que nao sao nossos. O alvo e `mkt_v2`, sempre (docs/HANDOFF.md §3).",
    valida: (v) =>
      /^[a-z][a-z0-9_]*$/.test(v) ? null : `schema invalido: ${v}`,
  },
  // As duas aceitam o prefixo NEXT_PUBLIC_ porque `authConfig` aceita, e uma
  // conferencia mais rigorosa que o codigo reprovaria deploy que funciona.
  {
    nome: "SUPABASE_URL",
    alternativa: "NEXT_PUBLIC_SUPABASE_URL",
    porque: "o login troca email e senha com o Supabase Auth por esta URL.",
  },
  {
    nome: "SUPABASE_ANON_KEY",
    alternativa: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    porque: "o login usa a chave publica para autenticar contra o Supabase.",
  },
  {
    nome: "SUPABASE_JWT_SECRET",
    porque:
      "e com ele que a assinatura do token e conferida. Sem isto ninguem entra, " +
      "e a mensagem de erro fala de token em vez de configuracao.",
  },
  {
    nome: "ANTHROPIC_API_KEY",
    porque:
      "sem provider de modelo o loop de agente nao e montado, e /api/agent " +
      "responde PROVIDER_UNAVAILABLE a tudo.",
  },
  {
    nome: "INNGEST_EVENT_KEY",
    porque: "sem ela o app nao consegue publicar o evento que dispara a publicacao.",
    quando: () => !dev,
  },
  {
    nome: "INNGEST_SIGNING_KEY",
    porque:
      "sem ela o Inngest nao chama o endpoint durable. Nada falha: as publicacoes " +
      "ficam agendadas para sempre, que e a falha mais dificil de diagnosticar.",
    quando: () => !dev,
  },
  {
    nome: "META_ADAPTER",
    porque: "decide se o produto fala com a Meta de verdade. O padrao e `fake`.",
    opcional: true,
    valida: (v) =>
      v === "real" || v === "fake" ? null : `use "real" ou "fake", nao "${v}"`,
  },
  // As tres da Meta so sao exigidas quando alguem pediu o modo real. Exigi-las
  // sempre transformaria a espera pelo app review (ADR-0008) num erro de boot.
  {
    nome: "META_APP_ID",
    porque: "META_ADAPTER=real fala com o Graph em nome do app.",
    quando: () => env.META_ADAPTER === "real",
  },
  {
    nome: "META_APP_SECRET",
    porque: "alem do Graph, ele assina o `state` do OAuth (ADR-0014).",
    quando: () => env.META_ADAPTER === "real",
  },
  {
    nome: "META_REDIRECT_URI",
    porque:
      "tem de bater exatamente com o cadastrado no app da Meta, senao o " +
      "consentimento volta com erro e nada e gravado.",
    quando: () => env.META_ADAPTER === "real",
  },
  {
    nome: "META_VAULT",
    porque:
      "conectar canal pelo navegador exige um vault que GRAVE (ADR-0014). " +
      "Sem `supabase`, a conexao e recusada no callback — de proposito.",
    quando: () => env.META_ADAPTER === "real",
    valida: (v) =>
      v === "supabase" ? null : `com META_ADAPTER=real, use META_VAULT=supabase (veio "${v}")`,
  },
];

const faltando = [];
const invalidas = [];

for (const r of REGRAS) {
  if (r.quando && !r.quando()) continue;
  const v = env[r.nome] ?? (r.alternativa ? env[r.alternativa] : undefined);
  if (!v) {
    if (!r.opcional) faltando.push(r);
    continue;
  }
  const erro = r.valida?.(v);
  if (erro) invalidas.push({ ...r, erro });
}

const perfil = dev ? "desenvolvimento" : "producao";
const meta = env.META_ADAPTER ?? "fake (padrao)";

console.log(`\n  Ambiente — perfil ${perfil}, META_ADAPTER=${meta}\n`);

for (const r of REGRAS) {
  if (r.quando && !r.quando()) continue;
  const v = env[r.nome] ?? (r.alternativa ? env[r.alternativa] : undefined);
  const ruim = invalidas.find((i) => i.nome === r.nome);
  const marca = ruim ? "✗" : v ? "✓" : r.opcional ? "·" : "✗";
  const nota = ruim ? ruim.erro : v ? "" : r.opcional ? "nao definida (ok)" : "FALTA";
  console.log(`  ${marca}  ${r.nome.padEnd(22)} ${nota}`);
}

if (faltando.length === 0 && invalidas.length === 0) {
  console.log("\n  Ambiente completo para este perfil.\n");
  process.exit(0);
}

console.log("");
for (const r of faltando) console.log(`  ⛔ ${r.nome} — ${r.porque}`);
for (const r of invalidas) console.log(`  ⛔ ${r.nome} — ${r.erro}`);
console.log("\n  Ver .env.example e docs/DEPLOY.md.\n");
process.exit(1);
