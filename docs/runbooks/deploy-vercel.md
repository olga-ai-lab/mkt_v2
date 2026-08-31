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

## 3. Antes de promover: abra `/api/health`

Uma URL responde tudo o que costuma dar errado num primeiro deploy. Devolve
**503 enquanto faltar algo essencial**, e 200 quando está pronta — então serve
também para monitor externo.

```json
{
  "ok": true,
  "versao":  { "branch": "claude/novo-modulo-marketing-5l992o",
               "commit": "d938e78d", "ambiente": "production" },
  "checks":  { "variaveis": true, "banco": true, "migrations": true,
               "agente": true, "publicacao_falsa": true },
  "banco":   { "schema": "mkt_v2", "migrations_aplicadas": 16,
               "ultima_migration": "0016_safety_trace.sql" },
  "faltando": []
}
```

**`versao.branch` é o campo mais importante.** Ele responde "eu deployei o que
eu acho que deployei?" — pergunta que ninguém pensa em fazer, e que neste
projeto já produziu duas cópias da branch errada. Se ali aparecer
`claude/projeto-superpower-plugin-iyj47t`, o deploy está servindo o produto
antigo, e nenhuma tela vai dizer isso.

| Sintoma | Causa |
|---|---|
| `banco.erro: "42P01"` | o schema existe mas está vazio — **faltam as migrations** |
| `banco.erro: "ECONNREFUSED"` / `"28P01"` | `DATABASE_URL` errada ou sem senha |
| `banco.schema: "mkt"` | `MKT_SCHEMA` não definida, caiu no default. **Não é o nosso** |
| `migrations_aplicadas: 10` | branch antiga, ou migrations pela metade |
| `faltando: [...]` | diz o nome de cada variável e o que ela custa |
| `publicacao_falsa: false` | `META_ADAPTER=real` sem o app review (ADR-0008) |

> A rota nunca devolve o **valor** de uma variável — só se está definida. E
> nunca a mensagem do Postgres, só o código: a mensagem carrega host e porta.
> `apps/web/test/health.test.mjs` falha se alguém "melhorar" isso num dia ruim
> de depuração.

### As migrations, se ainda não foram

Duas pastes, nesta ordem: `packages/db/dist/mkt_v2_0010-0011-0012-0013-0014.sql`,
depois `packages/db/dist/mkt_v2_0015-0016.sql`. Sem elas o agente não resolve
marca, não move `DRAFT → AI_REVIEW` e marca toda fatia como vencida.

### E duas checagens de olho

- [ ] `/prototipo` abre com a faixa laranja — a prova mais barata de que o build
      saiu inteiro.
- [ ] `/` autenticado mostra as contagens.

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
