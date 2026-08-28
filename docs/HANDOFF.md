# HANDOFF — Olga Marketing OS

**Para:** a próxima sessão (Claude Code, com acesso a git e ao banco)
**De:** sessões de 24–26/08/2026
**Estado:** Fases 0 e 1 fechadas em código; o primeiro bloco da Fase 2
(onboarding de marca a partir da URL) anda de ponta a ponta.
545 testes, 31 evals (14 golden, 17 adversariais), 10/10 no G0, 10/10 no G1, 14 migrations.
**Pendências reais:** a submissão do app na Meta, que segura o G1 e não é
código, e as migrations **0010 a 0014, que ainda não foram aplicadas em `mkt_v2`** —
ver §3.1.

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
| `packages/gateway` | Capability Gateway — os 8 passos do MKT-09B §10. Única porta de efeito colateral. Adapters: `meta_graph`, `web_fetch`, `brand_extract`, `internal` | 107 |
| `packages/db` | 10 migrations, 29 tabelas, RLS forçada, state machine em trigger | 146 |
| `packages/runtime` | Model Gateway, Agent Runtime, loop de agente, retrieval, redator, extrator de marca, ativação de Brand Brain | 129 |
| `apps/worker` | Workflow durável de publicação, replay-safe (Inngest) | 25 |
| `apps/web` | Next.js — home, login, conteúdo, fila de aprovação, revisão de Brand Brain | 24 |

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

Estado: **9 das 10 migrations estão aplicadas.** A Olga aplicou 0007 e 0008
pelo SQL Editor em 25/08/2026, e a conferência bateu nos quatro pontos abaixo.

> **As migrations 0010 a 0016 ainda não foram aplicadas.** São duas pastes, nesta
> ordem: `packages/db/dist/mkt_v2_0010-0011-0012-0013-0014.sql` e depois
> `packages/db/dist/mkt_v2_0015-0016.sql`. É seguro mesmo se a 0010 já tiver entrado
> (o corpo dela é um `update` idempotente e o ledger usa `on conflict do
> nothing`).
>
> Sem a **0015**, nenhum nome de marca resolve para um id: quem preenche
> `canonical_id` volta a ser o modelo, e um uuid inventado passa igual a um
> correto.
>
> Sem a **0010**, `brand.extract_from_url` continua apontando para o adapter
> `web_fetch` naquele banco e o onboarding de marca não funciona lá.
>
> Sem a **0011**, nada move `DRAFT` para `AI_REVIEW`, e todo conteúdo que o
> agente escrever fica preso antes da revisão humana.
>
> Sem a **0012**, o retrieval não encontra contrato de fonte nenhum e marca
> TODA fatia como vencida — é a escolha fail-closed, e ela trava o agente até a
> migration entrar.
>
> Sem a **0013**, o agente responde com a postura conservadora padrão em vez da
> persona dele, e o trace não registra com que persona o run falou.
>
> Sem a **0014**, não há kill switch: conter um incidente volta a exigir uma
> migration escrita na hora.
>
> As cinco conferem o próprio efeito e derrubam a transação se o resultado não
> bater.

| | esperado | obtido |
|---|---|---|
| tabelas em `mkt_v2` | 29 | **29** |
| tabelas sem RLS | nenhuma | **nenhuma** |
| rotas em `model_routing` | 7 | **7** |
| `workspace_budgets` | 0 | **0** |

`workspace_budgets` vazio é o esperado: orçamento é configurado por workspace
depois. Enquanto não houver linha, o Model Gateway recusa rodar com
`BUDGET_NOT_CONFIGURED` em vez de gastar às cegas — que é o desenho, não uma
pendência.

### Por que foi pelo SQL Editor, e não pela linha de comando

Fica registrado porque volta a valer na próxima sessão: **os conectores
Supabase desta sessão não alcançam o projeto certo.**

| | |
|---|---|
| Conector `Supabase` | enxerga **uma** organização: `88i` (`unybbcqvrknnpuqysoma`) |
| Conector `Dashboard_supabase` | preso ao projeto `bakjzzdvvkrhdoyihvhf`, que o outro nem lista |
| `get_project('emumzyejysosywlsridm')` | `You do not have permission to perform this action` |

São duas credenciais diferentes e nenhuma chega em `Olga's Project`, que vive
na org **Sistemas OLGA PRO**. Não é escolher o projeto errado — é falta de
autorização para a organização.

Isso não foi deduzido de uma listagem vazia: a API negou o projeto pelo id.
A diferença importa, porque listagem vazia pode ser filtro e negação
explícita não é. Se uma sessão futura precisar aplicar migration por linha de
comando, alguém precisa autorizar o conector nessa organização primeiro.

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

**T2 — Aplicar 0007 e 0008.** Feito, pelo SQL Editor, com a conferência
registrada em §3.1. O schema `mkt_v2` está completo: 29 tabelas, nenhuma
sem RLS.

**T6 — Brand Brain a partir de URL (Fase 2).** Feito, e ver §8. Não dependia
do T3: ler o site público de um cliente não passa pela Meta.

### As peças agora estão ligadas

O bloco seguinte à fila original fechou três buracos do mesmo tipo — coisa
desenhada que nunca encostou em banco:

**Ninguém alimentava as filas.** O relay drenava um outbox que nada escrevia;
a tela lia uma fila que nada criava. `ports.publishing` agora tem `schedule()`
e `requestApproval()`, e os dois gravam estado de domínio e evento no **mesmo
commit**. Agendar sem aprovação não deixa rastro nenhum — há teste conferindo
`publications` e `outbox` vazias.

**A porta do worker só existia nos testes.** `collectPublishFacts`,
`markPublished`, `markBlocked`, `markFailed` e os `workflow_runs` não tinham
SQL. O workflow era provado contra um dublê e não rodava contra banco nenhum.

**A CI nunca tinha rodado.** Disparava só em `push` para `main` (vazia) e em
PR (nenhum). Na primeira execução de verdade ela pegou uma divergência que
estava parada no repositório desde o commit do Model Gateway: o enum ganhou
quatro reason codes e `generated/index.d.ts` nunca foi regenerado — os quatro
já eram lançados em produção pelo código. Proteção que não executa não
protege, e o custo dessa foi exatamente isso.

`packages/db/test/pipeline.test.mjs` mede o caminho inteiro contra Postgres:
pedir aprovação → aprovar → agendar → outbox → relay → workflow → gateway →
adapter → publicado → evento de volta no outbox.

### O que falta, e de quem depende

> Esta lista é da sessão de 25/08 e ficou aqui como histórico. **A lista viva
> está em §9**, e é ela que a próxima sessão deve ler primeiro.

**Depende de você, não de código:**

1. ~~**Promover um agent para `ACTIVE`.**~~ Feito na 0009, para o
   `AGT-MKT-COPILOT`, depois dos evals e com um bloco que recusa a promoção se
   um agente `ACTIVE` tiver capability de escrita. Os outros três seguem
   `CANDIDATE`.
2. ~~**Definir o Gate G1.**~~ Feito: `npm run gate:g1`, 10/10 verificáveis. Ele
   nunca se declara fechado sozinho — o que falta não é código.
3. **Submeter o app na Meta** — o relógio mais lento do projeto, e o que
   segura o G1.

**Infraestrutura, essa sim é código:**

4. ~~Endpoint HTTP do Inngest.~~ Feito. `apps/web/app/api/inngest/route.ts`
   serve as duas funções, e `apps/worker/src/composition.mjs` é o único lugar
   que sabe montar tudo junto.

   Montar de verdade pela primeira vez achou um bug parado: `inngest.mjs`
   estava escrito na API v3 (config, gatilho, handler), e a v4 exige o gatilho
   dentro do primeiro argumento. Nunca falhou porque nenhum cliente Inngest
   real chegava a ser construído. Hoje `composition.test.mjs` constrói um.

   Falta configurar `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` no deploy.

5. ~~**App web além da tela de aprovação:** home, login, listagem de conteúdo.~~
   Feito. Somou-se a revisão de Brand Brain em `/brands/[id]/brain`.
   `SUPABASE_JWT_SECRET` precisa estar configurado.

### O que esta sessão acrescentou, em números

| | Antes | Depois |
|---|---|---|
| Testes | 126 | 403 |
| Evals de agente | 0 | 22 |
| Gate G0 | 10/10 | 10/10 |
| Gate G1 | — | 10/10 verificáveis |
| Migrations | 8 | 9 |

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

### O executor das capabilities internas — o agente promovido que não executava

O `AGT-MKT-COPILOT` foi promovido a `ACTIVE` na migração 0009. As três
capabilities dele são `brand.read`, `evidence.read` e `quality.precheck`, e as
três têm `provider_adapter` nulo no registry. O gateway resolve isso na linha

```js
const adapter = adapters[cap.provider_adapter ?? "internal"];
```

e `"internal"` não estava no mapa. Nove das doze capabilities do MVP caem nele.
Um agente promovido respondia `PROVIDER_UNAVAILABLE` a tudo que sabia fazer.

Os evals não pegaram porque o harness registrava
`internal: createFakeMetaAdapter({ idPrefix: "int" })`. `brand.read` "passava"
sem tocar em Brand Brain nenhum. Um eval que aprova o caminho que ninguém
montou é pior que nenhum eval, porque dá confiança.

Agora existe `packages/gateway/src/adapters/internal.mjs` com as nove, o
harness usa o adapter de verdade contra as portas de verdade, e
`packages/db/test/internal-executor.test.mjs` compara a lista do
`capability_registry` com a do código — divergência entre migração e handler
falha na CI em vez de aparecer no primeiro pedido de um cliente.

**Quatro coisas que só apareceram quando o caminho passou a ser exercido:**

1. **`output_schema_ref` era decoração.** A coluna está no registry desde a
   0004 e nada a lia — `getCapability` nem a selecionava. Uma capability de
   `simulate` vive do que devolve; saída fora do contrato passava como sucesso.
   O gateway agora valida, e devolve o laudo em `output`, ao lado do
   `ExecutionResult` (que tem `additionalProperties: false` de propósito).

2. **O loop descartava o laudo do `simulate`.** `quality.precheck` rodava,
   dizia "claim material sem lastro", e a resposta saía como se estivesse tudo
   certo. Conferir e não contar é o único resultado pior que não conferir. Um
   `simulate` com `valid: false` agora para o loop em `QUALITY_BLOCKED`.

3. **`approval.request` ignorava a state machine.** Escrevia o estado de
   destino direto; para um `DRAFT` o trigger devolvia `INVALID_STATE_TRANSITION`
   cru. A J11 não liga `DRAFT` a revisão humana — `AI_REVIEW` vem antes. Agora
   é recusa nomeada que diz o que falta.

4. **O check de claim sem evidence era inalcançável.** A constraint
   `claim_material_requires_evidence` impede que claim material entre com array
   vazio, então contra `cardinality(evidence_ids)` o check nunca reprovaria
   nada. Mas `evidence_ids` é `uuid[]` e não tem foreign key: apagar uma
   evidence deixa o id pendurado. `claimsFor` passou a contar evidence que
   **existe**, e é isso que `CLAIM_UNSUPPORTED` significa — "o que sustentava
   sumiu".

**O que o modelo escreve e o que ele apenas declara.** `content.create_draft`
e `content.create_variant` recebem uma porta `compose`
(`packages/runtime/src/composer.mjs`); as outras sete não chamam modelo nenhum,
porque contar claim material sem lastro é contagem, não julgamento. O redator
responde os contratos `olga://io/draft-composition` e
`olga://io/variant-composition` — é o schema que fecha `claim_type` num enum,
para que um claim de cobertura não possa ser rebaixado a genérico em silêncio.

**O que ainda falta aqui:** nada move `DRAFT` para `AI_REVIEW`. `quality.precheck`
é a revisão de IA em intenção, mas `side_effect` dela é `none` no registry, e
capability que não escreve não muda estado. Resolver isso é decisão de
governança — mudar o `side_effect` no registry é migração — e não foi tomada
por conta própria.






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

## 8. Fase 2 — onboarding de marca a partir da URL

Feito e verde. A cadeia inteira:

```
brand.extract_from_url ──> brand.propose_version ──> uma pessoa ativa
   busca + leitura            versão CANDIDATE          versão ACTIVE
```

### O que estava quebrado, e não parecia

Os dois cortes tinham aparência de coisa pronta, que é o que os tornava caros:

1. **`brand.extract_from_url` apontava para o adapter `web_fetch`.** Aquele
   adapter busca a página com toda a defesa de SSRF e devolve
   `{ texto, hash, url_final }` — sem a chave `output`, a única que o gateway
   entrega a quem chamou. A página era buscada e o texto era jogado fora. A
   capability chamada *extract* não extraía nada.

2. **Nada alimentava o passo seguinte.** O compilador de
   `brand.propose_version` lia `context.proposta`, e o loop compilava todo passo
   contra o mesmo `recuperado` do retrieval. A saída do passo N não chegava ao
   passo N+1, então propor a versão falhava sempre com `EVIDENCE_INSUFFICIENT` —
   um reason code correto para um defeito, que é o pior jeito de falhar.

3. **Não havia caminho de ativação.** `brand_brain_versions` nascia CANDIDATE
   desde a 0002 e nenhuma linha de código fazia CANDIDATE → ACTIVE. O
   onboarding terminava num beco: a marca seguia sem Brand Brain, com
   `brand.read` e `content.create_draft` recusando para sempre.

### As decisões que valem revisão da Olga

**Interpretação e permissão não correm no mesmo trilho.** `identity` e `tone`
são síntese. Cada item de `claims_allowed` e `disclaimers` exige a citação
literal da página que o sustenta, conferida por código; item sem lastro vai para
`discarded` com motivo, em vez de reprovar a extração inteira.

**`prohibitions` sai sempre vazia da extração**, com `maxItems: 0` no contrato
de saída da capability garantindo. Uma página diz o que a marca fala, não o que
ela se recusa a falar — não é limitação da extração, é a natureza da coisa. Quem
preenche é uma pessoa, em `/brands/[id]/brain`, e esse é o único caminho.

**Editar não muda a versão: cria a próxima.** Uma versão de Brand Brain é o que
autoriza o redator a afirmar cada coisa; mudar uma linha existente trocaria em
silêncio o que o agente pode dizer, sem rastro de que era outra coisa antes. É a
mesma regra do conteúdo, onde a decisão é vinculada à versão. `source_refs` são
herdadas, nunca regravadas: a pessoa editou o texto, não leu a página de novo.

**Derivar e ativar são dois atos, com dois papéis.** Derivar é propor
(`OWNER` ou `MARKETING`, e o resultado é sempre CANDIDATE); ativar é assumir
(`OWNER`). Um ato só faria de quem escreve a proibição a mesma pessoa que decide
que ela vale — e aí a segunda leitura, que existe para pegar o que a primeira
deixou passar, nunca aconteceria.

**Ativar não é capability, e a recomendação é que não vire.** Quem propõe não
pode ser quem aceita. A ativação exige papel `OWNER` e acontece em
`/brands/[id]/brain`.

**Promover o `AGT-MKT-BRAND` para ACTIVE é decisão sua, não desta sessão.** Ele
tem capability de escrita (`brand.propose_version`, MEDIUM), e a 0009 declarou
que promover quem escreve merece a própria migration e o próprio motivo. Os
evals agora cobrem o caminho de onboarding — inclusive claim sem lastro,
procedência forjada pelo modelo e URL vinda do plano — então a decisão tem em
que se apoiar.

---

## 9. O que ficou aberto

**Não é código, e é o mais lento:**

1. **Submeter o app na Meta** (ADR-0008). Continua segurando o G1.
2. **Aplicar a migration 0010 em `mkt_v2`** — `packages/db/dist/mkt_v2_0010.sql`.
   Sem ela o onboarding não funciona naquele banco (§3.1).
3. **Apagar o projeto órfão `ogmypcbaqcamguqbhxjo`**, que custa dinheiro (§3.3).

**Decisões de governança, esperando quem manda:**

4. ~~**Nada move `DRAFT` para `AI_REVIEW`.**~~ Feito, na 0011. Ver §10.
5. **Promover `AGT-MKT-BRAND`** (ver §8).

**Código, em ordem de quanto dói:**

6. ~~**Editar uma candidata antes de ativar.**~~ Feito. Ver §8.
7. **Versionar capability não funciona na prática.** O loop chama
   `registry.getCapability(id, 1)` com o `1` literal: uma v2 ACTIVE seria escrita
   no registry e ignorada em execução. Foi por isso que a 0010 atualizou a v1 em
   vez de criar uma v2 — está declarado na própria migration. Resolver é trocar
   por "a ACTIVE desta capability", e mexe nos dublês de vários testes.
8. ~~**Contrato de fonte.**~~ Feito na 0012. Ver §11.
9. **Golden dataset e evals de qualidade** (achado G11). Depende das três
   corretoras piloto, não de código. Os evals de hoje medem governança, e a
   separação é deliberada.

---

## 10. A cadeia editorial, e os dois becos que ela tinha

Fechada na migration 0011. A sequência agora anda inteira:

```
content.create_draft ─> quality.ai_review ─> approval.request ─> decisão humana
      DRAFT                 AI_REVIEW           HUMAN_REVIEW        APPROVED
```

### Os dois becos, e eles eram do mesmo tipo

**Nada movia `DRAFT` para `AI_REVIEW`.** A J11 não liga DRAFT à revisão humana,
e `approval.request` recusava — corretamente — por uma etapa que ninguém tinha
como cumprir. `quality.precheck` era a revisão de IA em intenção, mas o
`side_effect` dela é `none`, e capability que não escreve não muda estado.

**Nenhum agente tinha `approval.request` no charter.** A capability está ACTIVE
desde a 0006, tem compilador e tem policy — e os quatro charters passavam ao
largo dela. Uma capability que ninguém pode chamar é uma porta murada: existe no
registry, passa em todo teste de unidade, e nunca é alcançada. A 0011 agora
avisa (`raise warning`) quando encontra uma.

### As decisões que valem revisão

**Não foi só trocar o `side_effect` do precheck.** `mode: simulate` significa
"calcula um veredito e não produz efeito". Um simulate que escreve é mentira no
registry — e o registry é onde a policy decide, o gateway roteia e os evals
conferem. Então são duas capabilities sobre a **mesma conferência**, que é uma
função só: `quality.precheck` (simulate) pergunta "como está?" e
`quality.ai_review` (write) diz "então passa".

**O laudo que reprova não é falha da capability.** Achar problema é ela
funcionando: devolve `valid: false`, não transiciona, e quem para o loop é o
laudo. Lançar diria "tente de novo em alguns minutos" para um claim sem lastro,
que não melhora com o tempo.

**O gatilho no loop deixou de ser o `mode`.** Era `mode === "simulate"` enquanto
só simulate produzia laudo. Um laudo que reprova não fica menos verdadeiro
porque quem o emitiu tem permissão de escrever.

**`AI_REVIEW` não entra sozinho: o laudo é gravado junto**, na mesma transação,
em `mkt.marketing_events` — que ganhou o primeiro escritor dela. Estado sem
evidência é confiança sem lastro. O outbox não servia: outbox é evento que
precisa ser **entregue**, e este é fato que precisa ficar **registrado**.

---

## 11. Contrato de fonte, e a auditoria contra a Mestra

A Documentação Mestra de Engenharia de Agentes V11 entrou no projeto em
27/08/2026. A auditoria do que temos contra ela está resumida abaixo; o
primeiro item dela já foi feito.

### O que a 0012 resolveu (Mestra §7.5)

`createRetrieval` carregava `maxAgeDays = 90`: um teto único, aplicado igual ao
Brand Brain, a uma página de site e ao registro da marca no nosso próprio banco.
A Mestra §3 explica o custo — "freshness é parte da verdade: dado correto e
desatualizado pode gerar resposta falsa" — e o §7.5 diz onde a resposta mora.

Agora cada fonte tem contrato em `mkt.source_contracts`, com autoridade
temporal, prazo, qualidade padrão, PII, escopo de permissão e caveats. Três
decisões que valem revisão:

- **`max_age_days` nulo é uma afirmação**, não um campo esquecido: aquela fonte
  não vence. Um registro nosso não fica velho — fica errado, e errado não se
  detecta por idade.
- **Fonte sem contrato vence**, com o motivo. Fail-closed: a alternativa deixa
  uma fonte nova entrar em produção sem ninguém decidir quando ela envelhece.
- **A qualidade saiu do código.** Era `"HIGH"` fixo para toda fatia, o que fazia
  uma página de site valer tanto quanto um registro nosso. Hoje vem do contrato,
  e a linha que declara a própria qualidade vence sobre ele.

O retrieval também deixou de devolver só um booleano: junto de `stale` vai
`vencidas`, com qual fonte e por quê.

### O que a auditoria contra a Mestra encontrou, e ainda não foi feito

**Camadas de conhecimento (§7)** — de seis, temos rules/policies e parte do
canônico. Faltam ontologia, aliases de entidade e guias de raciocínio. A camada
semântica (§7.4) não se aplica: nossa classe (§2) é transacional, não analítica.

~~**Persona e prompt não são versionados (§9, §32).**~~ Feito na 0013. Ver §12.

~~**O trace está pela metade (§30).**~~ Feito, e a linha *Safety* fechou na
0016 (§15) — junto com as versões de rules, que saíram no mesmo lugar.

~~**Shadow, canary e rollback não existem (§33).**~~ Feito na 0014, menos shadow
e canary. Ver §13.

~~**Estamos abaixo do piso de golden do §46.**~~ Feito: 14 golden, 17
adversariais.

**Não há `AGENTS.md` nem `CLAUDE.md` (§36).** `docs/runbooks/` passou a existir,
com o de contenção de incidente.

**O naming do apêndice A não é seguido**: nossas capabilities são `brand.read`,
não `capability.brand.read`; as rules são `POL_*`, não `rule.<name>`.

### Sobre a estrutura de pastas do §35

Não seguimos o layout, e isso é deliberado no que importa: `capabilities/` e
`rules/` viraram **tabelas com migração e revisão** em vez de arquivos YAML —
uma forma mais forte que a recomendada, não mais fraca. O que falta de verdade
são as pastas cuja substância também não existe.

---

## 12. Persona versionada, prompts com lock, e o trace preenchido

Segundo item da auditoria contra a Mestra. Fecha §9, §30 e §32.

### Persona virou dado (§9)

O contrato conversacional tem oito campos. Tínhamos dois: `mission` no registry
e `uncertainty` dentro de um objeto literal em `agent-deltas.mjs`. O próprio
arquivo argumentava que missão e capabilities **não** deviam ser reescritas em
código porque já eram dado — e guardava em código a única parte que "não cabia
numa coluna". Agora cabe: `mkt.agent_personas`.

`agent-deltas.mjs` deixou de ser a fonte e virou o que sempre deveria ter sido:
o renderizador. Ele não conhece nenhum agente pelo nome.

**Dois defeitos silenciosos apareceram ao mexer nisso.** `getAgent` nunca
selecionou `reason_codes` nem `deviates_from_base` — o renderizador os projeta
no prompt desde que existe ("use um destes motivos", "regras específicas suas")
e recebia sempre `undefined`. As colunas estavam preenchidas no banco e o agente
nunca as viu.

### Prompt com lock (§32)

Os textos viraram constantes nomeadas, e `packages/runtime/prompts.lock.json`
guarda o hash de cada um mais o histórico por versão. `npm run prompts:lock`
**recusa** regravar quando a versão corrente já está registrada com outros
hashes: mudou o texto, sobe a versão. Sem isso, versionar prompt seria um número
que alguém lembra de subir — e o que alguém precisa lembrar de fazer não é uma
garantia.

Os prompts continuam ao lado do código que os usa, e não num diretório
separado: um prompt longe da função que o manda é um prompt que muda sem ninguém
ver o efeito.

### O trace, com a Performance vinda do ledger (§30)

`agent_run_id` nunca chegava ao Model Gateway, então `mkt.model_spend` não podia
ser ligado ao run. Agora chega, e `runs.finish` agrega o gasto **do próprio
ledger** no mesmo UPDATE que fecha o run.

A escolha é essa de propósito: o loop não vê as chamadas de modelo — elas
acontecem dentro das pontas — e somar por fora criaria uma segunda
contabilidade que um dia discordaria da primeira. O ledger continua respondendo
sobre dinheiro; a linha do run carrega o total para o trace ser auto-suficiente.

Um run que não chamou modelo fecha com `model` e `cost_cents` **nulos**, e não
zero: zero diria "consultei e não custou".

---

## 13. Contenção de incidente, e o que ainda falta da Mestra

Terceiro e quarto itens da auditoria. Fecham §34, §46 e o piso de golden.

### O kill switch é uma policy, e não uma flag nova

O mecanismo já existia. O que faltava era a operação — durante um incidente
ninguém escreve migration. `docs/runbooks/conter-incidente.md` é o passo a
passo; `POST /api/containment` é a porta.

| Ação | O que faz |
|---|---|
| `kill_writes` | para toda escrita do workspace, e deixa a leitura de pé |
| `kill_agent` | para um agente inteiro |
| `kill_capability` | para uma capability |
| `degrade_agent` | baixa o teto para A1 — interpreta e explica, não executa |
| `lift` | levanta, com motivo, marcando BLOCKED em vez de apagar |

Motivo é obrigatório. Uma linha que bloqueia sem dizer por quê vira, duas
semanas depois, uma linha que ninguém sabe se pode remover — e alguém remove.

`expires_at` **não** levanta nada sozinho: uma contenção que some por conta
própria é uma contenção em que ninguém confia.

### O rollback de agente estava quebrado

`getAgent` fazia `order by version desc` puro — a maior versão, qualquer que
fosse o status. Voltar para a última `ACTIVE` não funcionava: uma v2
`DEPRECATED` continuaria sendo servida sobre a v1 `ACTIVE`. Junto vieram os
índices de `ACTIVE` único em `agent_registry` e `capability_registry`, que
`model_routing` já tinha desde a 0007.

### O que ainda falta da Mestra

**Camadas de conhecimento (§7):** faltam ontologia e guias de raciocínio. A
camada semântica não se aplica à nossa classe (§2, transacional). Aliases de
entidade entraram na 0015 — ver §14.

**Shadow e canary (§33).** Replay/offline existe (os evals) e rollback passou a
existir. Rodar uma versão nova em sombra, medindo divergência, não.

~~**A linha *Safety* do trace (§30).**~~ Feita na 0016 — ver §15.

**`AGENTS.md` e `CLAUDE.md` (§36)**, que ensinariam a um coding agent onde estão
as fontes normativas.

**Naming do apêndice A**: capabilities são `brand.read` e não
`capability.brand.read`; rules são `POL_*` e não `rule.<name>`.

---

## 14. Entity Resolution: quem transforma um nome em id deixa de ser o modelo

`olga://io/entity-resolution` existia desde a Fase 0 — com métodos, reason
codes e tipos gerados — e **nada o implementava**. Um `grep` pelo nome do
contrato não devolvia uma linha fora do próprio schema.

Quem preenchia `canonical_id` era o LLM, dentro do `IntentResolution`. Um
modelo não tem como saber um uuid: ou devolvia `null`, e todo pedido que
nomeava uma marca morria em `CLARIFICATION_REQUIRED`, ou inventava um — e a
recusa vinha por acidente, se e quando o `SELECT` do compilador não achasse a
linha. Recusar por acidente é recusar às vezes.

Os evals não pegavam porque substituem `__BRAND__` pelo id real do fixture
antes de rodar. O caminho que eles aprovavam não era o que um cliente percorre.

### O passo, e onde ele entra

Entre o resolver (LLM) e o retrieval. Daqui para baixo, o loop trabalha com
entidades **verificadas contra o tenant** — `intent.entities` não chega mais ao
compilador. Sem essa troca, tudo isto seria auditoria sem consequência.

| Ordem | Método | Quando |
|---|---|---|
| 1 | `exact_id` | o texto já é o id (a tela mandou o id no lugar do nome) |
| 2 | `unique_natural_key` | igualdade de nome, depois de `mkt.norm` |
| 3 | `alias` | igualdade contra um apelido **registrado** |
| 4 | `exact_id` (banda `MEDIUM`) | o texto não resolveu e o palpite do modelo existe neste tenant |

Fuzzy continua proibido (§13). Só há igualdade — depois de normalizar caixa,
acento e espaço, que não é aproximação e sim a mesma palavra escrita de outro
jeito. `mkt.norm` é aplicada nos **dois lados** de toda comparação: normalizar
só de um é o jeito de nunca encontrar nada.

O custo é real e é o certo: "Corretora Ipe Seguros" não resolve se a marca está
cadastrada como "Ipê Seguros". O sistema pergunta. A alternativa — aceitar 0.87
de similaridade — é publicar no perfil errado uma vez a cada tanto, e ninguém
consegue dizer quanto é tanto. Para dois nomes que precisam conviver existe
apelido: uma linha que alguém escreveu, com autor e data.

### O palpite do modelo virou entrada não confiável

A linha 4 é o que sustenta pronome: "publica isso", "a marca", "esse post" são
pedidos legítimos cujo texto não resolve nada. Rejeitá-los quebraria a conversa
inteira; aceitá-los sem checar deixaria um uuid alucinado virar destino. A
trava que sobra é a única que importa — **o id tem de existir nesta
organização**. O modelo pode errar de entidade; não pode atravessar tenant.

Quando o nome resolve e o palpite discorda, **o cadastro vence** e a divergência
vai para o trace (`loop.entities`). Deixar o palpite vetar uma resolução por
nome seria dar ao modelo, na hora de discordar, uma autoridade sobre identidade
que acabamos de dizer que ele não tem.

### Ambiguidade é pergunta, e os dois códigos não se confundem

| Código | O que aconteceu | O que a pessoa faz |
|---|---|---|
| `AMBIGUOUS_ENTITY` | dois cadastros com o mesmo nome | escolhe |
| `NORMALIZATION_FAILED` | nenhum cadastro com esse nome | confere o nome |
| `UNSUPPORTED_VALUE` | tipo de entidade que o sistema não resolve | nada — vira `UNSUPPORTED`, não pergunta |

O índice único `(org_id, entity_type, mkt.norm(alias))` é a regra, e não a
otimização: é ele que transforma apelido em chave natural em vez de palpite.
Sem ele a resolução teria de escolher entre dois candidatos, e escolher é o que
o §13 proíbe.

Tipo desconhecido é **fail-closed**: `connection` — que é em qual conta se
publica — para o loop em vez de atravessar sem verificação. Um tipo novo que
ninguém lembrou de classificar vira erro visível, não um id não conferido
chegando ao compilador.

### O prompt do resolver mudou (versão 2)

Ele agora pede `raw` e `canonical_id: null` explicitamente. Enquanto pedia o
id, o modelo o inventava. `prompts.lock.json` guarda as duas versões.

### Cinco evals novos, e o que cada um trava

`COPILOT-GOLD-005` (nome digitado sem acento resolve — impossível antes),
`COPILOT-GOLD-006` (apelido), `COPILOT-ADV-006` (uuid inventado não vira alvo),
`COPILOT-ADV-007` (homônimos viram pergunta, não a primeira linha do índice),
`COPILOT-ADV-008` (o palpite não redireciona um nome resolvido). Mais
`CONTENT-ADV-006`, para a entidade intrusa que saiu do `CONTENT-ADV-003` — com
ela lá, aquele caso passava por um motivo diferente do que o título afirma.

---

---

## 15. A linha *Safety* do trace, e o que ela deliberadamente não faz

A §30 lista o que todo run precisa deixar registrado. *Versions* fechou na 0013,
*Performance* na 0007/0013. *Safety* — sinais de injeção, redação de PII, e o
que a policy decidiu — era a que faltava.

### A defesa continua sendo estrutural; o que faltava era o registro

Isto precisa ficar dito antes de qualquer outra coisa, porque a leitura
preguiçosa de `packages/runtime/src/safety.mjs` — "temos detecção de injeção" —
é o caminho para alguém afrouxar a defesa de verdade achando que há uma rede
embaixo.

A defesa mora em dois lugares, e **nenhum deles depende de reconhecer o
ataque**:

1. `assembleContext` — texto de usuário entra na sexta camada, nunca na de
   sistema.
2. O compiler — os argumentos de toda chamada nascem de código determinístico a
   partir de entidades verificadas.

É por isso que elas funcionam contra ataques que ninguém previu. O problema é
que são silenciosas: se um dia falharem, nada no banco diz que alguém tentou. O
`COPILOT-ADV-001` prova que uma injeção conhecida não vira instrução — uma vez,
em teste, contra um texto que nós mesmos escrevemos. Produção não tem eval.

### Registra, não bloqueia

Um regex que bloqueia é um regex que autoriza. Quem bloqueia neste sistema é a
policy, que é dado tipado, escopado, priorizado e revisável por migration.

E o custo do contrário seria imediato: *"ignore o rascunho anterior e comece de
novo"* é pedido legítimo de quem escreve marketing e casa com qualquer padrão
razoável de override. Há teste para cada uma das duas metades — o padrão pega o
ataque, **e** não pega o pedido honesto que se parece com ele. Sem a segunda, a
lista cresce até virar ruído, e trace ruidoso é trace que ninguém lê.

Cinco técnicas, nomeadas pela técnica e não pelo texto: `INSTRUCTION_OVERRIDE`,
`ROLE_IMPERSONATION`, `PROMPT_EXFILTRATION`, `AUTHORITY_CLAIM`,
`AUTONOMY_ESCALATION`. Varridos: o texto do usuário, o material recuperado (o
vetor de dentro — um Brand Brain cuja `identity` diga "ignore as instruções
anteriores" entra em todo run daquela marca, e quem o editou tem papel
MARKETING) e a página buscada pelo `brand.extract_from_url`.

O sinal da página sai pelo tracer e não pela coluna do run: aquele código roda
dentro do adapter, atrás do Capability Gateway, e devolvê-lo pelo output
exigiria abrir o `BrandExtraction`, que é `additionalProperties: false`
justamente para o modelo não escrever campo que ninguém pediu. O `trace_id` liga
os dois.

### PII: a 0012 declarou, e ninguém aplicava

`mkt.source_contracts.carries_pii` existia desde a 0012, e o caveat da fonte
`UPLOADED_FILE` dizia, com todas as letras: *"é a que recebe documento sem
passar por nenhum filtro nosso"*. A declaração estava certa e o filtro não
existia — o texto ia inteiro para o contexto do modelo.

Agora a fatia de uma fonte marcada com PII passa por redação **antes** de entrar
na camada `governed`. O lugar é o retrieval, e não a montagem do prompt: quem
sabe se a fonte carrega PII é o contrato dela, e o contrato é lido ali.

O marcador fica visível (`[CPF]`) em vez de o trecho sumir — um buraco silencioso
faz o modelo inventar o que estava ali. E quando a redação muda o texto, o hash
da evidência é recalculado: um hash do original descreveria um texto que nunca
entrou em lugar nenhum.

**A limitação é declarada, e não um bug a consertar:** a redação é por formato,
então pega CPF, CNPJ, e-mail, telefone e CEP. Não pega nome de pessoa, que não
tem forma. Fingir que pega seria pior que não pegar, porque alguém confiaria.

### A coluna que não entrou, e por que isso importa

*Policy blocks* quase virou um contador. Não virou: o loop para no primeiro
bloqueio, então o contador só poderia valer 0 ou 1 — e `respondability =
'POLICY_BLOCKED'` já diz exatamente isso, na mesma linha. Seria a mesma verdade
escrita duas vezes, que é o anti-pattern do §47.

O que a policy de fato **não** deixava no trace era *qual regra decidiu*.
`evaluate()` devolve `policy_versions` desde a Fase 0, o contrato
`RespondabilityResult` exige o campo, e nada nunca o gravou. Num incidente a
pergunta é "que regra barrou isso, na versão de qual dia", e re-derivar pelo
escopo é adivinhar. Isso também fecha a metade que faltava da §32 no trace.

### Nulo e zero não são a mesma coisa

Vale para as três colunas, e é o que os testes protegem: **nulo diz "não cheguei
a olhar"; zero diz "olhei e não havia"**. Um run que parou antes do plano não é
um run que a policy aprovou.

### Um defeito que apareceu no caminho

A resolução de entidade (§14) trocava `intent.entities` pela lista verificada
**só para o compilador**. O retrieval continuava lendo a do modelo — e é ele
quem escolhe qual Brand Brain entra no contexto. No caso em que as duas
discordam, que é exatamente o que o §14 existe para detectar, o agente pensaria
com a marca A e escreveria na marca B, sem erro nenhum no caminho. Corrigido, com
teste que falha se alguém voltar atrás.

---

---

## 16. O repositório que o Lovable criou, e o que veio dele

O front-end foi desenhado no Lovable com o pedido de sincronizar com este
repositório. O Lovable não sincronizou: criou um repositório novo,
`olga-ai-lab/marketplace-sync`, com um app TanStack Start + Vite — framework
diferente do `apps/web`, que é Next.js e é onde vivem as dez rotas de API.

Dois repositórios para um produto viram duas verdades sobre como ele funciona,
e a que ninguém mantém é a que alguém acaba lendo. Então o desenho veio para cá.

### A cópia foi literal, e isso não é sorte

`src/mktos/` — doze telas, `logic.ts` de 831 linhas, `store.tsx`, `css.tsx` — é
**React puro**: só `react` e imports relativos. Nenhum TanStack, nenhum shadcn,
nenhum Next. Coube em `apps/web/mktos/` sem uma linha de reescrita; só entrou o
`"use client"` de cada entrada.

O `components/ui` do shadcn que o Lovable gerou (47 arquivos) **não veio**:
nenhuma tela o importa.

### Ele mora em `/prototipo`, e não em `/`

Tudo ali é **dado de mentira**, escrito à mão em `logic.ts`. Nada chama API, lê
banco ou passa pelo Capability Gateway; os botões mudam estado em memória e o
"publicado" da tela nunca saiu para lugar nenhum.

Uma tela que parece o produto e não é o produto é a coisa mais perigosa que este
repositório pode conter — é o mesmo defeito da coluna vazia, do eval que aprova
o caminho errado e do kill switch que grava sem bloquear. Por isso: rota
separada, faixa fixa no topo dizendo o que é, e link de navegação rotulado
"Protótipo".

### O mapa do que existe

`apps/web/mktos/README.md` tem a tabela tela a tela. O resumo:

| | Telas |
|---|---|
| **completo** | Aprovações, Marca, Conteúdo — as três já têm tela real |
| **parcial** | Hoje, Calendário, Agenda, Agentes, Config |
| **nada** | Desempenho, Jornadas, Carteira, Newsletter |

Quatro telas desenham coisas que não existem em lugar nenhum do backend — não há
métrica de post, entidade de campanha, audiência nem newsletter. Transformar
qualquer uma em produto começa por uma migration e uma capability, não por
copiar o JSX.

### Os dois repositórios ficam, e isso não é para consertar

Foi a primeira conclusão, e estava errada. Dois fatos do repositório do Lovable
mudam a resposta:

1. `.lovable/project.json` declara `template: tanstack_start_ts_current` — ele
   **monta um app inteiro na raiz** a partir de um template fixo. Não sabe
   escrever dentro de `apps/web/` de um monorepo que já existe; apontá-lo para o
   `mkt_v2` faria com que tentasse ser dono do `package.json` da raiz.
2. O `README` gerado diz: *"Push to `main` on GitHub and your changes sync back
   into Lovable"* — a sincronia é de **mão dupla**. O repositório é um canal
   vivo, não um export.

Ou seja: `marketplace-sync` é a **prancheta**, e precisa continuar viva para o
Lovable continuar servindo para desenhar. O erro não foi ter dois repositórios;
foi esperar que o Lovable soubesse escrever num monorepo.

```
Lovable  →  marketplace-sync (main)  →  npm run sync:prototipo  →  apps/web/mktos/
```

### A regra que impede os dois de brigarem

| | Quem manda | Onde se mexe |
|---|---|---|
| **Layout e visual** | Lovable | desenha lá, sincroniza para cá |
| **Ligação com dados e API** | `mkt_v2` | `apps/web/app/<rota>/page.tsx` — nunca no Lovable |

É por isso que `apps/web/mktos/` é cópia literal. Tudo o que liga tela a banco
mora fora dela, e por isso sobrevive a toda sincronização.

`scripts/sync-prototipo.mjs` mantém um `.sync.json` com o hash de cada arquivo
copiado, e **para** se algum tiver sido editado à mão, em vez de apagar o
trabalho da pessoa em silêncio. Mesmo mecanismo do `prompts.lock.json`, e
verificado nos dois sentidos: edição local barra a sincronização; mudança vinda
do Lovable entra e é registrada.

**Não apague `marketplace-sync`.** Ele é o editor, não um repositório órfão.

### Um defeito encontrado no caminho: o build de produção estava quebrado

Rodar `npm run build:web` para conferir o protótipo revelou que ele **já
falhava**, e não por causa desta mudança:

```
Failed to collect page data for /api/agent
TypeError: The "path" argument must be of type string... Received an instance of URL
```

`prompts.mjs` lia `prompts.lock.json` com
`readFileSync(new URL("../prompts.lock.json", import.meta.url))`. Funciona no
`node --test` e quebra no webpack, que reescreve `import.meta.url`. A rota
principal do produto não empacotava.

Ninguém tinha visto porque **`npm test` não rodava `next build`** — o typecheck
passa, e o defeito só aparece ao empacotar. Eu escrevi "build do web limpo" nas
verificações anteriores deste documento sem ter rodado o comando. Estava errado.

Duas correções: o lock entra por `import ... with { type: "json" }`, que é
estaticamente analisável; e **`npm run build:web` passou a fazer parte do
`npm test`**, para o próximo defeito deste tipo cair no teste e não no deploy.

---

---

## 17. Vercel, o protótipo como modelo visual, e um 500 que não aconteceu

### Onde o produto roda (ADR-0012)

O Lovable hospeda em **Cloudflare Workers** — o `vite.config.ts` dele diz
`nitro (build-only using cloudflare as a default target)` e o `src/server.ts`
exporta `fetch(request, env, ctx)`. Três coisas do `mkt_v2` não rodam lá:
`pg.Pool` (socket TCP), o carregamento de schemas (`node:fs`) e a defesa de
SSRF do `web-fetch` (`node:dns` + `node:net`).

O terceiro é o que decide: a "solução" preguiçosa é remover a checagem, e aí o
`brand.extract_from_url` vira proxy para a rede interna. **O produto vai para a
Vercel; o Lovable continua hospedando o protótipo.**

Nota de plano: a conta está em **Hobby**, que tem limite de tempo de função. Um
run de agente chama o modelo três vezes. É I/O, não CPU, mas o limite é de
parede — `/api/agent` é a rota a observar.

### O protótipo virou o modelo visual

`tokens.css` foi reescrito com a paleta do protótipo, medida **por frequência
de uso**, não escolhida: `#0E353D` (196 ocorrências), `#8AA6AD` (144),
`#5A7A82` (77), `#0FC2C0` (77), `#E3EDEF` (60). Os **nomes** dos tokens não
mudaram — nenhum componente foi tocado, e o diff mostra só cor. Entraram Inter
e Sora, as duas fontes do protótipo.

`apps/web/test/tokens.test.mjs` faz a paleta valer:

- todo `mkt.content_state` tem regra de chip — **achou `CANCELLED`**, que existe
  no enum desde a 0002 e nunca teve regra: renderizava chip sem cor, texto solto
  na lista. Ninguém viu porque cancelar conteúdo é raro, e raro é o que só
  aparece quebrado na frente de um cliente;
- todo `lifecycle_status` e todo `channel` também;
- nenhuma regra órfã apontando para estado que não existe;
- **nenhum hex fora do `:root`** — achou dois soltos no `app.css`, que eram a
  primeira linha de uma segunda paleta.

### O 500 que não aconteceu

Antes de deployar, abri o `.nft.json` do `/api/agent` para conferir o que entra
no bundle:

```
schemas rastreados: 0
```

`packages/contracts/src/index.mjs` lia os 34 JSON Schemas com `readdirSync` +
`readFileSync`. O rastreador do Next segue `import`, não caminho montado em
tempo de execução — então **o build passa** (roda com o repositório em disco) e
a primeira requisição em produção quebra. Em *qualquer* rota, porque
`assertValid` está em todas. Deploy verde, 500 imediato.

A correção: `npm run contracts:generate` passou a emitir também
`generated/schemas.mjs`, um barril com 34 imports estáticos. O CI já recusava
diff não commitado em `generated/`, então um schema novo que ninguém regenerou
quebra no pull request. Depois: **34 schemas no bundle**.

### A regra, escrita para não haver terceira vez

Foi a segunda vez: `prompts.mjs` lia o lock (§16), `contracts` lia os schemas.
`apps/web/test/bundle.test.mjs` varre `packages/*/src`, `apps/worker/src` e
`apps/web/lib` e recusa qualquer leitura de disco — importe de `node:fs`,
`readFileSync`, `readdirSync`, `createReadStream`.

Ele tira comentários antes de procurar. Sem isso, acusaria os próprios arquivos
que **explicam** o defeito corrigido — e um teste que proíbe descrever o
problema apaga a razão de a correção existir.

`node:dns` e `node:net` continuam permitidos: não leem arquivo, existem no
runtime Node da Vercel, e são a defesa de SSRF.

---

*Última verificação: 28/08/2026. 618 testes, 37 evals (16 golden, 21
adversariais), 10/10 no Gate G0, 10/10 verificáveis no G1, typecheck limpo,
build do web verificado de verdade (dentro do `npm test`), 16 migrations, árvore limpa, tudo empurrado para
`claude/novo-modulo-marketing-5l992o`.*

*O schema `mkt_v2` está com 9 das 16 migrations. Faltam duas aplicações, nesta
ordem: `packages/db/dist/mkt_v2_0010-0011-0012-0013-0014.sql` e depois
`packages/db/dist/mkt_v2_0015-0016.sql`.*

*Na Fase 1 sobrou **uma** pendência, e ela não é código: a submissão do app na
Meta (ADR-0008). Enquanto ela não sair, o produto roda inteiro com
`META_ADAPTER=fake` — e o onboarding de marca, que não passa pela Meta, roda de
verdade.*
