# Deploy — a ordem, e o que quebra se ela for trocada

Este arquivo existe porque o erro que mais custou neste repositório não foi
falta de teste: foi falta de alguém montar. Uma variável ausente não quebra o
boot do Next — ela quebra a primeira requisição que precisar dela, e o sintoma
aparece longe da causa.

**A plataforma é Railway** (ADR-0012, ACEITA em 08/09/2026). A ADR-0002, que
dizia Vercel, está `SUPERSEDIDA` — mas só na parte da web: **o Inngest Cloud
continua sendo o motor durável** (ADR-0001). Railway substituiu a Vercel, não o
Inngest; os dois nunca foram alternativas um do outro.

## Antes de qualquer coisa

```bash
npm run check:env            # perfil de produção
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

**Migration não roda no start do container.** Parece conveniente e quebra no dia
em que houver duas réplicas: duas subidas simultâneas aplicando a mesma migration
é a forma mais rápida de corromper o controle de versão do schema. É passo de
release, feito uma vez, por uma pessoa ou por um job.

> **O alvo é `mkt_v2`, sempre.** No projeto Supabase da Olga, `mkt` e `rh` têm
> dados que não são nossos (`docs/HANDOFF.md` §3). É por isso que `MKT_SCHEMA`
> existe, e por isso `check:env` reprova quando ele falta em vez de deixar o
> padrão `mkt` valer em produção.

Confira depois de aplicar:

```sql
select count(*) from information_schema.tables where table_schema = 'mkt_v2';
-- e nenhuma tabela sem RLS:
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'mkt_v2' and c.relkind = 'r' and not c.relrowsecurity;
```

A segunda tem de voltar vazia. Há teste estrutural para isso, mas ele roda
contra o Postgres da CI — a produção merece a pergunta feita de novo.

### 2. Variáveis de ambiente no Railway

| Variável | Sem ela |
|---|---|
| `DATABASE_URL` | nenhuma tela é servida |
| `MKT_SCHEMA` | o app lê o schema `mkt`, que não é nosso |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | o login não fala com o Supabase Auth |
| `SUPABASE_JWT_SECRET` | ninguém entra, e o erro fala de token, não de configuração |
| `ANTHROPIC_API_KEY` | o loop de agente não é montado; `/api/agent` responde `PROVIDER_UNAVAILABLE` |
| `INNGEST_EVENT_KEY` | o app não consegue publicar o evento que dispara a publicação |
| `INNGEST_SIGNING_KEY` | **falha silenciosa:** o Inngest não chama o endpoint durável, nada dá erro, e as publicações ficam agendadas para sempre |
| `INNGEST_SERVE_ORIGIN` | **falha silenciosa:** atrás do proxy do Railway o Next não adivinha o host externo; o registro acontece com a URL errada e o workflow nunca é chamado |

`PORT` o Railway injeta sozinho; o `Dockerfile` traz 3000 como padrão.

As duas últimas são as piores da lista, e são as únicas que não aparecem como
erro em lugar nenhum. É por isso que estão no `check:env`.

### 3. Registrar o endpoint durável no Inngest

No painel do Inngest, a URL é `https://<host-do-railway>/api/inngest`, e ela tem
de bater com `INNGEST_SERVE_ORIGIN`. Sem esse registro, o item 2 acontece mesmo
com as duas chaves configuradas.

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
testes, e isso está dito em `packages/runtime/test/secrets.test.mjs` como teste
de nome próprio, não como nota de rodapé.

## A imagem

```bash
docker build -t olga-web .
docker run --rm -p 3000:3000 -e DATABASE_URL=... -e MKT_SCHEMA=mkt_v2 olga-web
curl -i localhost:3000/api/health
```

**Construa e RODE.** Não é zelo: a primeira imagem construída aqui subiu, ficou
saudável, e respondeu **500** no primeiro request. `packages/contracts` lê os
schemas do **disco** em tempo de execução, e bundler nenhum rastreia leitura de
arquivo — o `standalone` não os levava. Na Vercel isso nunca apareceu porque a
plataforma sobe o repositório inteiro. É exatamente a diferença que uma troca de
plataforma cobra.

O `Dockerfile` copia `packages/contracts/enums` e `schemas` por causa disso, e
`loadDir` passou a falhar com o nome do diretório em vez de um `ENOENT` dentro
de um chunk do webpack.

## Depois do deploy, antes de dizer que subiu

1. **`/api/health`** — 200 com `schema: "mkt_v2"` no corpo. Se vier `mkt`, a
   variável não chegou. Se vier 503, o banco não está alcançável.
2. **`/login`** — entrar. Falha aqui é quase sempre `SUPABASE_JWT_SECRET`.
3. **`/content/novo`** — pedir um rascunho. `PROVIDER_UNAVAILABLE` é falta de
   `ANTHROPIC_API_KEY`; `BUDGET_NOT_CONFIGURED` é o item 4.
4. **`/traces`** — o pedido acima tem de aparecer, com o plano dentro.
5. **`/approvals`** → aprovar; **`/content`** → publicar. Com `fake`, a
   publicação completa e o receipt aparece no trace.

Os cinco passos, nessa ordem, exercitam o caminho inteiro. Um deploy em que os
cinco passam está de pé.

## O que este documento não cobre

O Gate G1 **não fecha por aqui**. Falta um post real numa conta real, com
`META_ADAPTER=real`, e isso depende do app review da Meta (ADR-0008). Nenhuma
configuração de deploy substitui isso, e `npm run gate:g1` continua dizendo o
que falta em vez de mostrar verde.
