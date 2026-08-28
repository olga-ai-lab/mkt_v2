# Runbook — subir o produto na Vercel

**Quando usar:** primeiro deploy, ou quando alguém precisar recriar o projeto.

**Por que Vercel e não Lovable:** ADR-0012. O Lovable hospeda em Cloudflare
Workers, e três coisas do `mkt_v2` não rodam lá — `pg.Pool`, o carregamento de
schemas, e a defesa de SSRF do `web-fetch`, que usa `node:dns`. O Lovable
continua hospedando o protótipo, que é o que ele sabe hospedar.

---

## 1. Criar o projeto

Não deu para criar por API a partir desta sessão: a conta devolveu
`403 forbidden — You don't have permission to create the project`. Pelo painel:

**New Project → Import `olga-ai-lab/mkt_v2`**, e então:

| Campo | Valor | Por quê |
|---|---|---|
| Root Directory | `apps/web` | é um monorepo npm workspaces; a raiz não é o app |
| Framework Preset | Next.js | detectado sozinho |
| Build Command | *(padrão)* | `next build`; `transpilePackages` já cuida dos pacotes |
| Install Command | *(padrão)* | precisa rodar na raiz para o workspace resolver — a Vercel faz isso quando o Root Directory é subpasta |
| Production Branch | a que você for promover | hoje o trabalho está em `claude/novo-modulo-marketing-5l992o` |

---

## 2. As variáveis de ambiente

Tiradas do código, não de memória — é a lista completa do que o servidor lê.

### Sem estas, nada funciona

| Variável | Onde é lida | O que acontece sem ela |
|---|---|---|
| `DATABASE_URL` | `apps/web/lib/db.ts` | toda rota e toda porta falham; é o pool do Postgres |
| `MKT_SCHEMA` | `ports-postgres.mjs`, `ports-worker.mjs` | cai no default `mkt`. **Para o projeto da Olga tem de ser `mkt_v2`** — ver o aviso no topo do HANDOFF: nunca aplique nada em `mkt` |
| `SUPABASE_JWT_SECRET` | `lib/session.mjs`, `lib/auth.ts` | login falha com `PROVIDER_UNAVAILABLE`; é o que valida a assinatura do token |
| `SUPABASE_URL` | `lib/supabase-auth.mjs` | login não sai do lugar (aceita `NEXT_PUBLIC_SUPABASE_URL` como alternativa) |
| `SUPABASE_ANON_KEY` | `lib/supabase-auth.mjs` | idem (ou `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `ANTHROPIC_API_KEY` | `lib/providers/anthropic.ts` | o loop de agente não monta; sem ele `agentLoop` é `null` e `/api/agent` devolve 503 |

### Com default, mas decida

| Variável | Default | Quando mexer |
|---|---|---|
| `META_ADAPTER` | `fake` | **deixe `fake`.** `real` exige o app review da Meta, que não saiu (ADR-0008). Um valor inválido derruba o boot em vez de virar `fake` em silêncio |
| `INNGEST_EVENT_KEY` | — | necessária para o workflow durável de publicação disparar |
| `INNGEST_DEV` | `NODE_ENV !== "production"` | em produção deixe sem valor |

> **Não cole segredo em chat, issue ou commit.** Todos estes vão em
> Settings → Environment Variables, e o `DATABASE_URL` e o `SUPABASE_JWT_SECRET`
> dão acesso ao banco inteiro.

---

## 3. Antes de promover para produção

- [ ] **As migrations 0010 a 0016 aplicadas em `mkt_v2`.** Duas pastes, nesta
      ordem: `packages/db/dist/mkt_v2_0010-0011-0012-0013-0014.sql`, depois
      `packages/db/dist/mkt_v2_0015-0016.sql`. Sem elas o agente não resolve
      marca, não move `DRAFT → AI_REVIEW` e marca toda fatia como vencida.
- [ ] `/prototipo` abre e mostra a faixa laranja. É a checagem mais barata de
      que o build saiu inteiro.
- [ ] `/login` responde. Se der `PROVIDER_UNAVAILABLE`, falta `SUPABASE_JWT_SECRET`.
- [ ] `/` autenticado mostra as contagens. Se der 500, olhe `DATABASE_URL` e
      `MKT_SCHEMA` antes de qualquer outra coisa.

---

## 4. O que observar depois

**Tempo de função.** A conta está no plano **Hobby**, que tem limite de tempo.
Um run de agente chama o modelo três vezes — resolver, planner, responder —
mais retrieval e gateway. É I/O e não CPU, mas o limite é de parede.

`/api/agent` é a rota a observar. Se ela começar a cortar, o sintoma é timeout
sem erro nomeado, e a resposta é subir de plano — não encurtar o loop. O loop é
o produto.

**Onde olhar quando algo sair errado:** `mkt.agent_runs` tem o trace de todo run
(versões, custo, reason codes, e a linha *Safety*). O runbook de contenção é
`docs/runbooks/conter-incidente.md`.
