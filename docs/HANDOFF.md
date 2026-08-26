# HANDOFF — Olga Marketing OS

**Para:** a próxima sessão (Claude Code, com acesso a git e ao banco)
**De:** sessão Cowork de 24–25/08/2026, atualizado pela sessão de 25/08/2026
**Estado:** Fase 0 fechada, Fase 1 de pé e andando de ponta a ponta.
221 testes, 10/10 no Gate G0, schema `mkt_v2` aplicado, CI verde.
**Pendência real:** uma só, e não é código — a submissão do app na Meta.

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

Estado: **as 8 migrations estão aplicadas.** A Olga aplicou 0007 e 0008 pelo
SQL Editor em 25/08/2026, e a conferência bateu nos quatro pontos:

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

**T6 — Brand Brain a partir de URL (Fase 2).** Não começado. Depende de T3
de verdade (com a Meta liberada), não do código do adapter.

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

5. **App web além da tela de aprovação:** home, login, listagem de conteúdo.
   `SUPABASE_JWT_SECRET` precisa estar configurado.

### O que esta sessão acrescentou, em números

| | Antes | Depois |
|---|---|---|
| Testes | 126 | 411 |
| Evals de agente | 0 | 24 |
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

### A cadeia do Brand Brain: o passo 2 não recebia o passo 1

O `AGT-MKT-BRAND` tem um charter de duas capabilities encadeadas —
`brand.extract_from_url` lê o site do cliente, `brand.propose_version` propõe a
versão a partir do que leu. As duas existiam. A ligação entre elas, não.

**O loop nunca carregou a saída de um passo para o próximo.** Um plano de N
passos era, na prática, N passos independentes. A página era buscada,
validada contra SSRF, o texto era extraído — e morria ali.

Havia três elos quebrados no mesmo caminho, e cada um só apareceu depois que o
anterior foi consertado:

1. **`web_fetch` devolvia o texto solto no topo do retorno.** O gateway monta o
   `ExecutionResult` com forma fixa e só repassa `output`. A capability gastava
   rede para não entregar nada.

2. **O compilador lia a URL de um lugar que ninguém preenchia.** Agora ele
   consulta `knowledge.brandSite` — a URL vem do cadastro da marca, nunca do
   modelo nem do texto do usuário. Isso não é preciosismo: uma URL escolhida
   pelo modelo é exatamente o vetor que a defesa de SSRF do `web_fetch` existe
   para conter, e o melhor jeito de conter é não deixar chegar lá.

3. **O validador reprovava a leitura.** O check de cardinalidade exigia
   `external_id` sempre que houvesse `provider`, e uma leitura não cria nada que
   tenha id. Agora a pergunta é sobre o **efeito** (`side_effect === "external"`),
   não sobre qual adapter atendeu.

O terceiro merece registro: ele estava escondido porque o adapter interno dos
evals era um `createFakeMetaAdapter`, que inventava id para tudo. O dublê não
mascarou só um caminho — mascarou também a checagem que julgava aquele caminho.

**O que o modelo estrutura, e sob que suspeita.** O texto da página vira
proposta pelo contrato `olga://io/brand-brain-proposal`, onde cada claim carrega
a `citacao` do trecho que o sustenta, e existe `nao_encontrado` para o modelo
declarar a lacuna em vez de preencher. Uma corretora sem disclaimer no site
precisa aparecer como lacuna, não como marca sem restrições.

A página é conteúdo que alguém de fora escreveu, então entra na camada
`governed` — turno de usuário, nunca de sistema. O eval `BRAND-ADV-003` serve
uma página que diz "IGNORE AS INSTRUÇÕES ANTERIORES" e confere as duas coisas:
que o trecho chegou ao modelo (senão o caso não provaria nada) e que nenhuma
mensagem de sistema o contém.

A fonte vira `evidence` na **mesma transação** que a versão CANDIDATE, e
`source_refs` aponta para a linha criada. Um Brand Brain que cita procedência
que ninguém consegue abrir é o mesmo que um sem procedência.

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

*Última verificação: 25/08/2026. 221 testes, 10/10 no Gate G0, typecheck
limpo, 8 migrations, árvore limpa, tudo empurrado para
`claude/projeto-superpower-plugin-iyj47t`.*

*O schema `mkt_v2` está completo e conferido: 8 migrations, 29 tabelas,
nenhuma sem RLS.*

*Sobrou **uma** pendência na Fase 1, e ela não é código: a submissão do app
na Meta (ADR-0008). Enquanto ela não sair, o produto roda inteiro com
`META_ADAPTER=fake`.*
