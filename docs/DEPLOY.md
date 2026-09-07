# Deploy — a ordem, e o que quebra se ela for trocada

Este arquivo existe porque o erro que mais custou neste repositório não foi
falta de teste: foi falta de alguém montar. Uma variável ausente não quebra o
boot do Next — ela quebra a primeira requisição que precisar dela, e o sintoma
aparece longe da causa.

**A plataforma é a da ADR-0002:** Vercel para `apps/web`, Inngest Cloud para as
funções duráveis. A ADR-0012 propõe Railway e continua **não decidida** — este
documento descreve a ADR vigente.

## Antes de qualquer coisa

```bash
npm run check:env     # perfil de produção
npm run check:env -- --dev
```

Ele falha nomeando o que falta **e a consequência**. Rode com o mesmo ambiente
do deploy, não com o seu `.env` local — o ponto dele é justamente pegar a
diferença entre os dois.

## A ordem, e por que ela é essa

### 1. Migrations, antes do código

```bash
DATABASE_URL=... MKT_SCHEMA=mkt_v2 npm run db:migrate:local
```

Código novo lê colunas novas; código antigo não lê colunas que não existem.
Aplicar o código antes deixa uma janela em que a versão nova consulta o que
ainda não existe.

> **O alvo é `mkt_v2`, sempre.** No projeto Supabase da Olga, `mkt` e `rh` têm
> dados que não são nossos (`docs/HANDOFF.md` §3). É por isso que `MKT_SCHEMA`
> existe, e é por isso que `check:env` reprova quando ele falta em vez de deixar
> o padrão `mkt` valer em produção.

Confira depois de aplicar:

```sql
select count(*) from information_schema.tables where table_schema = 'mkt_v2';
-- e nenhuma tabela sem RLS:
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'mkt_v2' and c.relkind = 'r' and not c.relrowsecurity;
```

A segunda consulta tem de voltar vazia. Há teste estrutural para isso, mas ele
roda contra o Postgres da CI — a produção merece a pergunta feita de novo.

### 2. Variáveis de ambiente

| Variável | Sem ela |
|---|---|
| `DATABASE_URL` | nenhuma tela é servida |
| `MKT_SCHEMA` | o app lê o schema `mkt`, que não é nosso |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | o login não fala com o Supabase Auth |
| `SUPABASE_JWT_SECRET` | ninguém entra, e o erro fala de token, não de configuração |
| `ANTHROPIC_API_KEY` | o loop de agente não é montado; `/api/agent` responde `PROVIDER_UNAVAILABLE` |
| `INNGEST_EVENT_KEY` | o app não consegue publicar o evento que dispara a publicação |
| `INNGEST_SIGNING_KEY` | **falha silenciosa:** o Inngest não chama o endpoint durável, nada dá erro, e as publicações ficam agendadas para sempre |

A última é a pior das sete, e é a única que não aparece como erro em lugar
nenhum. É por isso que ela está no `check:env`.

### 3. Registrar o endpoint durável no Inngest

`apps/web/app/api/inngest/route.ts` serve as duas funções. No painel do Inngest,
a URL é `https://<host>/api/inngest`. Sem esse registro, o item 2 acima acontece
mesmo com as duas chaves configuradas.

### 4. Orçamento por workspace

```sql
select * from mkt_v2.workspace_budgets;
```

Vazio é o esperado num deploy novo, e **não** é pendência: enquanto não houver
linha, o Model Gateway recusa rodar com `BUDGET_NOT_CONFIGURED` em vez de gastar
às cegas. O primeiro workspace que for operar precisa de uma linha, ou os
agentes recusam tudo — corretamente, e de um jeito que parece defeito.

### 5. Meta: só quando o app review sair

O padrão é `META_ADAPTER=fake`, e o produto roda inteiro assim: cria, revisa,
aprova, agenda, publica — sem que nada saia para uma conta real.

Para `real`, quatro coisas juntas, e o `check:env` exige as quatro:

- `META_APP_ID`, `META_APP_SECRET`
- `META_REDIRECT_URI`, **igual** ao cadastrado no app da Meta
- `META_VAULT=supabase` — conectar canal pelo navegador devolve um token em
  tempo de execução, e o resolvedor por variável de ambiente recusa gravar
  (ADR-0014)

E a extensão `supabase_vault` habilitada no projeto. Ela não é exercida pelos
testes: `vault.create_secret` não existe no Postgres da CI, e isso está dito em
`packages/runtime/test/secrets.test.mjs` como teste de nome próprio.

## Depois do deploy, antes de dizer que subiu

1. `/login` — entrar. Se falhar aqui, quase sempre é `SUPABASE_JWT_SECRET` ou
   `MKT_SCHEMA`.
2. `/content/novo` — pedir um rascunho. Se responder `PROVIDER_UNAVAILABLE`,
   falta `ANTHROPIC_API_KEY`; se responder `BUDGET_NOT_CONFIGURED`, é o item 4.
3. `/traces` — o pedido acima tem de aparecer, com o plano dentro.
4. `/approvals` — aprovar; `/content` — publicar. Com `fake`, a publicação
   completa e o receipt aparece no trace.

Os quatro passos, nessa ordem, exercitam o caminho inteiro. Um deploy em que os
quatro passam está de pé.

## O que este documento não cobre

O Gate G1 **não fecha por aqui**. Falta um post real numa conta real, com
`META_ADAPTER=real`, e isso depende do app review da Meta (ADR-0008). Nenhuma
configuração de deploy substitui isso, e `npm run gate:g1` continua dizendo o
que falta em vez de mostrar verde.
