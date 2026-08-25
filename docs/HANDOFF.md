# HANDOFF — Olga Marketing OS

**Para:** a próxima sessão (Claude Code, com acesso a git e ao banco)
**De:** sessão Cowork de 24–25/08/2026, atualizado pela sessão de 25/08/2026
**Estado:** Fase 0 fechada, Fase 1 quase toda de pé. 203 testes, 10/10 no Gate G0.
**Pendências reais:** só duas, e nenhuma é código — ver §4.

> O LLM interpreta; os contratos decidem; o código calcula; as ferramentas
> executam; a evidência sustenta.

Este é o princípio de governança do produto e a régua deste repositório. Se
uma regra crítica só existe em prompt, ela não existe. Ela precisa quebrar
alguma coisa quando for contrariada — um teste, uma constraint, um schema.

---

## 1. O que você está recebendo

Um monorepo npm workspaces, JavaScript com ESM, sem framework de teste externo
(`node --test`). Sete pacotes:

| Pacote | O que é | Testes |
|---|---|---|
| `packages/contracts` | JSON Schema dos objetos de I/O, registries e enums fechados. Tipos TS gerados e commitados | 15 |
| `packages/policy` | Engine determinístico de autonomia. Invariantes hard-coded + regras como dado. Default deny | 19 |
| `packages/gateway` | Capability Gateway — os 8 passos do MKT-09B §10. Única porta de efeito colateral | 19 |
| `packages/db` | 8 migrations, 28 tabelas, RLS forçada, state machine em trigger | 35 |
| `packages/runtime` | Model Gateway e Agent Runtime | 29 |
| `apps/worker` | Workflow durável de publicação, replay-safe (Inngest) | 5 |
| `apps/web` | Next.js — tokens do MKT-06A e microcopy de todo reason code | 4 |

Mais `docs/adr/` (11 ADRs), `docs/AGT-BASE.md`, `docs/GATE-G0.md` e
`scripts/gate-g0.mjs` — que é a verificação executável do gate, não uma
checklist em prosa.

O `README.md` explica as decisões. Leia antes de mexer em qualquer coisa.

---

## 2. O código está no GitHub

Resolvido. O repositório foi para `olga-ai-lab/mkt_v2`, na branch
`claude/projeto-superpower-plugin-iyj47t`, com os 6 commits originais
preservados — o histórico não foi recriado.

```bash
git log --oneline    # 6 commits originais + os desta sessão
```

**`main` continua vazia.** O push foi para a branch de trabalho, não para
`main`; promover para `main` é decisão da Olga, não da sessão.

## 3. Mapa de acesso ao Supabase — leia antes de tocar em qualquer projeto

Esta seção existe porque a sessão anterior errou aqui, e o erro é fácil de
repetir. Três projetos, três situações diferentes.

### 3.1 O projeto certo

| | |
|---|---|
| **URL** | `https://emumzyejysosywlsridm.supabase.co` |
| **Nome** | Olga's Project |
| **Org** | Sistemas OLGA PRO |
| **Nosso schema** | `mkt_v2` |

**`mkt` e `rh` neste projeto NÃO são nossos.** São schemas que já existiam,
com dados da Olga. É exatamente por isso que o runner de migrations aceita
`MKT_SCHEMA` — para materializar a mesma estrutura sob outro nome sem
encostar no que já está de pé.

**Nunca aplique nada em `mkt` neste projeto.** Nosso alvo é `mkt_v2`, sempre.

Estado: migrations **0001 a 0006 aplicadas** pela Olga, pelo SQL Editor.
**0007 e 0008 seguem pendentes** — e a sessão de 25/08 não conseguiu
aplicá-las. O motivo está medido, não suposto:

| | |
|---|---|
| Conector `Supabase` | enxerga **uma** organização: `88i` (`unybbcqvrknnpuqysoma`), com 4 projetos |
| Conector `Dashboard_supabase` | preso ao projeto `bakjzzdvvkrhdoyihvhf`, que o outro conector nem lista |
| `get_project('emumzyejysosywlsridm')` | `You do not have permission to perform this action` |

São **duas credenciais diferentes**, e nenhuma alcança o projeto certo.
`Olga's Project` vive na org **Sistemas OLGA PRO**; os conectores desta
sessão só têm 88i. Não é problema de qual projeto escolher — é falta de
autorização para a organização.

Isso não é dedução a partir de uma listagem vazia: a API respondeu
negando o projeto pelo id. A diferença importa, porque uma listagem vazia
poderia ser filtro e a negação explícita não é.

**Para destravar, escolha uma:**

1. A Olga aplica pelo SQL Editor. O arquivo já está pronto e versionado em
   `packages/db/dist/mkt_v2_0007-0008.sql`. É a rota mais segura.
2. A Olga passa a `DATABASE_URL` do projeto e a sessão roda
   `node packages/db/scripts/migrate.mjs`, que pula 0001–0006.
3. Alguém autoriza o conector Supabase na org `Sistemas OLGA PRO`.

### 3.2 O projeto onde a sessão anterior aplicou por engano

| | |
|---|---|
| **Ref** | `bakjzzdvvkrhdoyihvhf` |
| **O que é** | produção de Chat BI / SUSEP |

Existem ali dois schemas órfãos, `mkt` e `mkt_v2`, com 25 tabelas cada,
vazios exceto pelo seed (12 capabilities, 4 agents, 11 policies). Foram
criados por engano: a sessão anterior aplicou no projeto que o conector
enxergava, em vez de parar e perguntar qual era o certo.

**Achado novo (25/08), e este é de segurança:** nesses dois schemas órfãos,
`processed_events` está com **RLS DESLIGADA** — `mkt.processed_events` e
`mkt_v2.processed_events`. É exatamente a falha que a migration 0008
corrige, e ela está de pé numa base de produção. As tabelas estão vazias,
mas enquanto a RLS estiver desligada qualquer um com a anon key lê e
escreve nelas. O advisor do próprio Supabase sinaliza como crítico.

Apagar os schemas resolve junto, porque remove as tabelas. Ligar só a RLS
(sem policy) também fecha, e é o contrato correto dessa tabela: só
`service_role` alcança.

**A Olga escolheu deixar os dois como estão** e não autorizou mexer.
Não faça nada com eles sem ela pedir explicitamente. Se ela pedir, a
limpeza é:

```sql
drop schema mkt cascade;
drop schema mkt_v2 cascade;
```

Confirme antes de rodar que esses schemas não ganharam dependentes desde
25/08/2026.

Há também, nesse mesmo projeto e **sem relação com o nosso trabalho**, três
tabelas em `public` com RLS desligada — `chat_bi_cobertura_auditoria` (128
linhas), `_ses_campos_fix_tmp` (2.036) e `opin_chave_atributo` (47). Vale
avisar quem cuida daquele sistema. **Não ligue RLS ali por conta própria:**
`opin_chave_atributo` aparenta ser lida pelo agente, e ligar RLS sem policy
derruba o acesso.

### 3.3 O projeto órfão que custa dinheiro

`ogmypcbaqcamguqbhxjo`, nome `olga-marketing-os`, org 88i, criado em
24/08/2026. Não é usado por nada. Não é free-tier, então a API não deixa
pausar nem apagar. **Só a Olga resolve**, pelo painel: Settings → General →
Delete project. Lembre-a se ela não tiver feito.

---

## 4. Fila de trabalho

**T1 — Push do repositório.** Feito. Ver §2.

**T5 — Ligar `mkt.outbox` ao Inngest.** Feito.
`apps/worker/src/outbox-relay.mjs` drena o outbox; a guarda de consumo usa
`mkt.processed_events`. A entrega é at-least-once **de propósito**: entre
`bus.send()` e `markPublished()` existe uma janela que só uma transação
distribuída entre Postgres e o barramento fecharia. A defesa fica onde já
estava — a idempotência do efeito externo mora no Capability Gateway.
O ledger evita trabalho repetido; não é ele que impede post duplicado.

A decisão que custou mais pensamento: marcar consumido **depois** do
sucesso, não reservar a chave antes. Reservar antes perde evento se o
processo cair no meio — e evento perdido em silêncio é a pior falha de um
outbox. Há teste para a janela exata.

**T4 — Tela de aprovação.** Feito. A decisão é vinculada à versão, e quem
derruba a aprovação numa edição continua sendo o trigger
`mkt.invalidate_approval_on_edit()`. A camada nova lê o efeito e recusa
publicar; não reimplementa. O aceite do handoff — *aprovar, editar, e a
aprovação cai* — está em `packages/db/test/approvals.test.mjs`, contra
Postgres.

Fechou também um buraco que o trigger sozinho deixava: aprovar → editar →
aprovar de novo fazia a decisão antiga voltar a valer sobre um texto que
aquele aprovador nunca leu. Resolvido comparando `decided_at` com
`approved_at`, exato porque os dois saem da mesma transação.

**T3 — Adapter real do Meta Graph.** Código feito; o aceite não.
`packages/gateway/src/adapters/` agora existe, com o contrato escrito, o
falso extraído e o real. A decisão central é a classificação de retry:
falhar **criando o container** é seguro repetir (container órfão expira em
24h e não é post); falhar **publicando** sem resposta é ambíguo, e aí o
adapter marca como não-retentável de propósito. Item parado que uma pessoa
resolve vale mais que post duplicado que ninguém desfaz.

**O aceite pede o teste de replay contra uma conta de teste real, e isso
depende da submissão do app na Meta.** Continua sendo o caminho crítico da
Fase 1 e continua não sendo código (ADR-0008). Se ainda não foi submetida,
**é o item mais urgente do projeto inteiro.** Pergunte à Olga antes de
investir em qualquer outra coisa.

**T2 — Aplicar 0007 e 0008.** Bloqueado por autorização, não por código.
Ver §3.1 para o diagnóstico e as três rotas de saída.

**T6 — Brand Brain a partir de URL (Fase 2).** Não começado. Depende de T3
de verdade (com a Meta liberada), não do código do adapter.

### O que esta sessão acrescentou, em números

| | Antes | Depois |
|---|---|---|
| Testes | 126 | 203 |
| Gate G0 | 10/10 | 10/10 |
| Migrations | 8 | 8 (nenhuma nova) |

Nenhuma migration nova foi criada de propósito: a fila de coisas para a
Olga aplicar à mão já tinha duas, e "attempts alto e published_at nulo" já
era a definição de linha travada — uma coluna de dead-letter seria um
segundo lugar para a mesma verdade.

### Dois defeitos que estavam de pé e foram corrigidos

- **`apps/web/lib/auth.ts` não existia**, e `app/api/agent/route.ts` já o
  importava. O app web não subia. Agora existe, com a parte verificável em
  `lib/session.mjs`: assinatura conferida com `timingSafeEqual`, `alg: none`
  e troca de algoritmo recusados, e o papel vindo da membership em vez da
  claim — token com role forjada não vira permissão.
- **Não havia typecheck.** Passou a haver, e entrou no `npm test`: tipo
  quebrado é o mesmo que teste quebrado.

## 5. Regras de engajamento neste repositório

**Antes de qualquer commit:**
```bash
npm test && npm run gate:g0
```
126 testes, 10/10. Se cair, não commite.

**Rodar os testes de banco** precisa de um Postgres local:
```bash
createdb olga_test
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/olga_test
npm run db:migrate:local
```
Sem isso, `npm run test:rls` falha — e ele é 35 dos 126 testes.

**Não afrouxe invariante para o teste passar.** Os invariantes em
`packages/policy/src/index.mjs` são tetos que nenhuma linha de banco relaxa.
Se um teste bate num invariante, quase sempre o teste está pedindo a coisa
errada.

**Policy só restringe.** Nunca escreva regra que conceda autonomia acima do
teto de risco. Há teste para isso.

**Efeito externo só pelo Capability Gateway.** Se você precisou chamar um
provider fora dele, a fronteira está errada, não o gateway.

**Tenant nunca vem do input do usuário.** `agent-runtime.mjs` lança
`TENANT_SCOPE_VIOLATION` se `org_id` ou `workspace_id` aparecerem no input.
Isso é proposital.

**Tabela nova sem RLS quebra o gate** — inclusive tabela sem `org_id`. Se não
for tenant-owned, ligue RLS sem policy: só `service_role` (que tem
`BYPASSRLS`) passa. Foi exatamente por essa brecha que `processed_events`
escapou; hoje um teste varre `pg_class` e não deixa repetir.

**Os `.sql` usam `mkt.` literalmente.** É a fonte única, executável direto no
psql. O `MKT_SCHEMA` é um rename de namespace feito pelo runner, não um
template — e há teste garantindo que nomes que só *contêm* "mkt" ficam
intactos.

---

## 6. O que a sessão anterior errou, para você não repetir

**Aplicou no projeto errado.** Havia um projeto visível pelo conector e outro
que a Olga queria. Em vez de parar e perguntar, assumiu que o visível era o
certo. Resultado: dois schemas órfãos numa base de produção. Quando o alvo de
uma escrita é ambíguo, pergunte — o custo de perguntar é um minuto, o de
errar é irreversível sem permissão de quem manda.

**Deixou uma tabela sem RLS.** `processed_events` não tem `org_id`, então não
passou pelo helper que liga RLS em toda tabela tenant-owned — e ninguém ligou
na mão. Ficou legível e gravável por qualquer um com a anon key. O advisor do
Supabase encontrou depois de o schema já estar em banco. A correção está em
`0005` e `0008`; o que impede a reincidência é o teste estrutural, não a
correção pontual.

**A sessão de 25/08 quase repetiu o primeiro erro.** Dois conectores
Supabase estavam ligados, nenhum alcançando o projeto certo, e um deles
apontando justamente para a base de produção onde os órfãos foram criados.
O que impediu a repetição não foi sorte: foi conferir o projeto pelo id
antes de escrever, e parar diante da negação em vez de aplicar no que
estava à mão. Fica a regra: **antes de qualquer escrita, prove o alvo pelo
id.** Uma listagem que não mostra o projeto pode ser filtro; uma negação
explícita pelo id é resposta.

Dois outros bugs, esses pegos pelos testes antes de chegar em banco, estão
documentados em `docs/GATE-G0.md`: `CREATE RULE ... DO INSTEAD NOTHING`
quebrando integridade referencial, e `array_length('{}', 1)` devolvendo NULL
e fazendo um CHECK passar vazio.

---

## 7. Contexto que não está no código

Os 11 PDFs originais (MKT-01 a MKT-09B) não estão no repositório — estão com
a Olga. O que eles decidiram está referenciado nos comentários das migrations
e dos schemas; o que eles deixavam em aberto está fechado nas ADRs.

Duas coisas foram **definidas por esta sessão**, não herdadas dos documentos,
e merecem revisão da Olga quando ela tiver tempo:

- **Os níveis A0–A4.** Apareciam em cinco documentos e não estavam definidos
  em nenhum. Hoje vivem em `packages/contracts/enums/autonomy.json`, com
  semântica por nível.
- **O enum de 29 reason codes** e o microcopy pt-BR de cada um, em
  `apps/web/messages/reason-codes.pt-BR.json`.

O plano completo está no MKT-17, entregue como PDF e como página navegável.

---

*Última verificação: 25/08/2026. 203 testes, 10/10 no Gate G0, typecheck
limpo, 8 migrations, árvore limpa, tudo empurrado para
`claude/projeto-superpower-plugin-iyj47t`.*

*Só duas coisas seguram a Fase 1, e nenhuma é código: a submissão do app na
Meta e a autorização do Supabase na org Sistemas OLGA PRO.*
