# HANDOFF — Olga Marketing OS

**Para:** a próxima sessão (Claude Code, com acesso a git e ao banco)
**De:** sessão Cowork de 24–25/08/2026
**Estado:** Fase 0 fechada, núcleo da Fase 1 de pé. 126 testes, 10/10 no Gate G0.

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

## 2. Como pegar o código — leia primeiro, é a parte que trava

**O repositório ainda não foi para o GitHub.** Ele existe em duas cópias:

1. Um `.zip` entregue à Olga na conversa Cowork, com o `.git` completo dentro
   (6 commits, branch `main`, remote já configurado).
2. Nada mais. Não há cópia no GitHub.

O remote `https://github.com/olga-ai-lab/mkt_v2.git` **existe e está vazio** —
a Olga criou o repositório, mas o push nunca aconteceu, porque a sessão
anterior não tinha permissão de rede para esse host.

### Sua primeira tarefa

Se você foi aberto dentro da pasta descompactada, confirme e empurre:

```bash
git log --oneline          # esperado: 6 commits, o mais recente sobre o handoff
git status                 # esperado: árvore limpa
git remote -v              # esperado: olga-ai-lab/mkt_v2.git
git push -u origin main
```

Se a pasta não existe ainda, peça o `.zip` à Olga antes de qualquer outra
coisa. **Não recrie o repositório do zero** — o histórico dos 6 commits
carrega as decisões e os dois bugs que os testes pegaram; perdê-lo custa mais
do que parece.

---

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
**0007 e 0008 pendentes.**

### 3.2 O projeto onde a sessão anterior aplicou por engano

| | |
|---|---|
| **Ref** | `bakjzzdvvkrhdoyihvhf` |
| **O que é** | produção de Chat BI / SUSEP |

Existem ali dois schemas órfãos, `mkt` e `mkt_v2`, com 25 tabelas cada,
vazios exceto pelo seed (12 capabilities, 4 agents, 11 policies). Foram
criados por engano: a sessão anterior aplicou no projeto que o conector
enxergava, em vez de parar e perguntar qual era o certo.

**A Olga escolheu deixar os dois como estão.** Não faça nada com eles sem ela
pedir explicitamente. Se ela pedir, a limpeza é:

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

Em ordem. Cada item tem critério de aceite verificável — não pare em "parece
funcionar".

### T1 — Push do repositório
Seção 2. **Aceite:** `git log origin/main --oneline` mostra os 6 commits.

### T2 — Aplicar 0007 e 0008 em `mkt_v2` no projeto certo

Duas rotas, escolha pela sua permissão de rede:

**Rota A — linha de comando** (precisa da connection string do projeto):
```bash
MKT_SCHEMA=mkt_v2 DATABASE_URL="postgres://...emumzyejysosywlsridm..." \
  node packages/db/scripts/migrate.mjs
```
O runner pula o que já rodou e aplica só 0007 e 0008.

**Rota B — SQL Editor** (se não alcançar o banco por rede):
```bash
MKT_SCHEMA=mkt_v2 MKT_ONLY=0007,0008 npm run db:bundle
# -> packages/db/dist/mkt_v2_0007-0008.sql
```
O arquivo já está gerado no repositório. Entregue à Olga para colar.

**Aceite** — ensaiado contra um banco com 0001–0006 em `mkt_v2`, deu isto:
```
tabelas antes:  26
tabelas depois: 29        (model_routing, workspace_budgets, model_spend)
tabelas sem RLS: nenhuma
```
Confira com:
```sql
select count(*) from information_schema.tables where table_schema = 'mkt_v2';
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'mkt_v2' and c.relkind = 'r' and c.relrowsecurity = false;
```
A segunda query precisa voltar **vazia**.

O bundle roda inteiro numa transação. Aplicar duas vezes falha no primeiro
`create type` e faz rollback completo — sem estado parcial, sem seed
duplicado. Isso foi testado, não deduzido.

### T3 — Adapter real do Meta Graph
Em `packages/gateway/src/adapters/`. O adapter falso já implementa o contrato
e o gateway não distingue um do outro — é essa a prova de que a fronteira
está no lugar certo.

**Bloqueado por fora:** a submissão do app na Meta leva de duas a seis semanas
(ADR-0008) e é o caminho crítico da Fase 1. Se ainda não foi submetida,
**esse é o item mais urgente do projeto inteiro, e ele não é código.** Pergunte
à Olga antes de investir em qualquer outra coisa.

**Aceite:** o mesmo teste de replay do `publish-workflow` passa com o adapter
real apontando para uma conta de teste, e o provider é chamado uma única vez.

### T4 — Tela de aprovação
Decisão vinculada à versão do conteúdo, não ao conteúdo. `mkt.approvals` já
existe e o trigger `invalidate_approval_on_edit()` já derruba a aprovação
quando a versão muda — a tela precisa respeitar isso, não reimplementar.

**Aceite:** aprovar, editar, e a aprovação cai. Teste, não clique.

### T5 — Ligar `mkt.outbox` ao Inngest
A tabela e o workflow existem; falta o consumidor. `mkt.processed_events` é o
ledger de deduplicação — use-o, não invente outro.

### T6 — Brand Brain a partir de URL (Fase 2)
Só depois de T3 e T4.

---

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

*Última verificação: 25/08/2026. 126 testes, 10/10 no Gate G0, 8 migrations,
árvore limpa, 6 commits à espera de push.*
