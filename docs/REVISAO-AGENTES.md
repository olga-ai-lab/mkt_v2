# Revisão dos agentes — estado real, verificado por execução

**Data:** 10/09/2026 · **Método:** leitura do código + execução contra Postgres
real, com o modelo roteirizado. Nada aqui foi afirmado sem rodar.

> O LLM interpreta; os contratos decidem; o código calcula; as ferramentas
> executam; a evidência sustenta.

Esta revisão existe porque a pergunta "os agentes estão prontos para eu testar?"
não se responde com suíte verde. A suíte estava verde — 422 testes, dois gates
10/10, 24 evals — e ainda assim três coisas que a plataforma precisa para
funcionar em produção interna **nunca tinham sido executadas uma vez**.

---

## 1. O que foi verificado, e como

| Verificação | Resultado |
|---|---|
| `npm test` (Postgres ligado) | 422/422 |
| `npm run gate:g0` | 10/10 |
| `npm run gate:g1` | 10/10 verificáveis; falta o post real (ADR-0008) |
| Evals de agente (`npm run evals`) | 24/24 |
| **`npm run smoke:agentes`** (novo) | **9/11 cenários; 2 divergências, que são achados** |

O smoke é novo e é a peça que faltava: os evals medem governança caso a caso,
com fixture próprio. Ninguém tinha montado a corretora de demonstração e
atravessado o produto de ponta a ponta com os quatro agentes. Ver
`scripts/smoke-agentes.mjs`.

---

## 2. O quadro

| Agente | Status | Autonomia | Executa hoje | Onde para |
|---|---|---|---|---|
| **COPILOT** | `ACTIVE` | A1 → A2 | `brand.read`, `evidence.read`, `quality.precheck` | não escreve nada, por charter |
| **BRAND** | `CANDIDATE` | A2 → A2 | site → proposta de Brand Brain (cadeia de 2 passos, verificada) | versão nasce `CANDIDATE`; promover é humano |
| **CONTENT** | `CANDIDATE` | A2 → A3 | rascunho, variante de canal, agendamento | qualquer afirmação material para no gate de compliance |
| **COMPLIANCE** | `CANDIDATE` | A1 → A2 | revisão contra proibições, disclaimers e claims | relata; quem bloqueia é a policy |

Os quatro percorrem o mesmo loop de nove interfaces (`agent-loop.mjs`), e o loop
está inteiro: Resolver → Retrieval → Planner → Respondability → Compiler →
Executor → Validator → Evidence → Responder. Isso foi observado executando, não
lendo: os onze cenários do smoke passam por todas as nove.

**Nenhum agente escreve em produção.** Não é o sistema quebrado: a migration
`0009` derruba a transação se um agente com capability de escrita ficar `ACTIVE`.
Promover cada um é ato de governança, com migration e motivo próprios —
`docs/ROADMAP.md`, bloco B, marcado `[proposto]`.

---

## 3. As camadas — ontológica, canônica, semântica

O `AGT-BASE` promete que o agente recebe "apenas as fatias de ontologia,
canônico, semântico, source e rule necessárias à tarefa". Estado de cada uma:

| Camada | Onde deveria estar | Estado real |
|---|---|---|
| **Rule** | `mkt.rule_policies` | **De pé.** Determinística, default deny, 11 policies semeadas, avaliada antes de toda capability. |
| **Source / evidence** | `mkt.evidence` + `buildEvidence` | **Parcial.** A tabela existe e o Brand Brain grava procedência. Nenhuma capability de conteúdo cria evidence — ver achado 5. |
| **Semântico** | fatias por intenção | **Parcial.** `retrieval.mjs` traz 3 fatias (brand_brain, claims, evidence) escolhidas por intenção, com versão e hash. Não há camada semântica versionada além do Brand Brain. |
| **Canônico** | `olga://io/entity-resolution` | **Ausente na prática.** O contrato existe e diz "resolução determinista de referência para ID canônico". Nenhuma linha do sistema o importa. Quem devolve `canonical_id` hoje é o LLM — ver achado 6. |
| **Ontologia** | — | **Não existe.** Não há registro de tipos de entidade, relações ou vocabulário do domínio de seguros. Os "tipos" de entidade são strings livres que o modelo escolhe (`brand`, `channel`, `content_version`) e que os compiladores procuram por igualdade de string. |

Essa é a resposta direta à pergunta "a parte semântica, ontológica e canônica
está pronta?": **rule está; source e semântico estão pela metade; canônico está
escrito como contrato e não existe como código; ontologia não foi começada.**

---

## 4. Guardrails da Olga — o que sustenta e o que não

Verificado por execução, não por leitura.

| Guardrail | Estado | Evidência |
|---|---|---|
| Tenant nunca vem do input | ✅ | Loop recusa `org_id`/`workspace_id` no corpo; `fixarConfiaveis` sobrescreve o tenant devolvido pelo modelo. Cenário com marca de **outra org**: bloqueado. |
| Efeito externo só pelo Capability Gateway | ✅ | Único caminho; 92 testes. |
| Policy só restringe | ✅ | Nenhuma linha concede acima do teto da capability. |
| Args nascem no compiler, não no modelo | ✅ | `connection_id` e `channel_variant_id` são consultados no banco a partir de (conteúdo, canal). |
| Prompt injection | ✅ | Página hostil entra como turno de usuário; teste afirma que não chega com autoridade de sistema. |
| Segredo fora do banco de domínio | ✅ | `secret_ref` + vault; token nunca em prompt, evidence ou trace. |
| Enum de reason code fechado | ✅ | Delta projeta os códigos da linha do registry; teste impede código órfão. |
| **Contexto de sete camadas chega ao modelo** | ❌ | O provider real descarta duas. **Achado 1.** |
| **Fatos que a policy julga vêm do servidor** | ❌ | Vêm do corpo do request. **Achado 3.** |
| **Claim material sustentado por evidência** | ❌ | Sustentado pela autodeclaração do modelo. **Achados 4 e 5.** |
| **Resolução canônica é cálculo, não interpretação** | ❌ | É o LLM que devolve o id. **Achado 6.** |
| **Trace reproduz a execução** | ❌ | `audit_events` sem escritor; custo e modelo nulos em `agent_runs`. **Achado 7.** |

---

## 5. Achados, em ordem de prioridade

### P0 — impede a plataforma de funcionar de verdade

**1. O provider real descarta duas das sete camadas de contexto.**
`assembleContext` monta `system`, `persona` e `schemas` como três mensagens de
papel `system`. O adapter em `apps/web/lib/providers/anthropic.ts` faz
`messages.find(m => m.role === "system")` — pega **a primeira** — e depois
`messages.filter(m => m.role !== "system")` — **descarta as outras duas**.

Ou seja: em produção, a persona do agente (missão, capabilities, erro mais caro,
política de incerteza, reason codes permitidos) e a instrução de contrato de
saída **nunca chegam ao modelo**. O agente pensa sem o próprio delta.

Executado como prova:

```
montado:  system:REGRA DO SISTEMA | system:PERSONA/DELTA | system:olga://io/task-plan | user:… | user:…
enviado:  system = "REGRA DO SISTEMA"   messages = [user, user]
PERDIDO:  PERSONA/DELTA DO AGENTE, olga://io/task-plan
```

Os testes não pegam porque afirmam sobre as mensagens montadas (`filter(role ===
"system").join`), e os evals não pegam porque o provider roteirizado lê todas as
mensagens. É o padrão de erro que o `CLAUDE.md` descreve: o dublê respondeu
bonito para um caminho que ninguém montou.

*Correção:* concatenar as camadas de sistema na ordem, preservando a fronteira:

```ts
const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
```

**2. Os model IDs do registry não existem.** `mkt.model_routing` roteia para
`"claude-sonnet"` e `"claude-haiku"`. Não são identificadores válidos da API — a
primeira chamada real devolve erro. IDs válidos hoje: `claude-opus-5`,
`claude-sonnet-5`, `claude-haiku-4-5`. Migration é imutável, então a correção é
uma migration nova (`0011`), não uma edição da `0007`.

**3. Os fatos que a policy julga vêm do corpo do pedido.**
`POST /api/agent` faz `facts: body.facts ?? {}`, e esses fatos chegam intactos ao
policy engine. Quem chama escolhe `content_status`, `channel_connected`,
`claim_types` e `workspace_first_publish` — exatamente as entradas das quatro
policies que protegem o produto.

O workflow durável **já faz certo**: `collectPublishFacts` reduz o banco aos
nomes do enum antes de chamar a policy. O caminho do agente não tem esse
coletor. Verificado no cenário 8 do smoke: com `content_status: "APPROVED"`
mentido sobre um conteúdo em `DRAFT`, a policy **passa**; quem recusa é a porta
do banco, uma camada depois. Defesa em profundidade funcionando — e uma primeira
linha ausente.

*Correção:* `collectAgentFacts(tenant, intent)` nas portas, espelhando
`collectPublishFacts`, e o loop ignorando `req.facts` vindo de fora.

### P1 — o produto funciona, mas não faz o que promete

**4. O compliance não lê o texto; lê a etiqueta.** O comentário do
`composer.mjs` diz: *"Se ele mentir na declaração — afirmar cobertura e marcar
como GENERAL — quem pega é o compliance.review, que lê o texto gravado e não a
etiqueta."* O código não faz isso. `complianceReview` compara o corpo com a lista
de proibições e o resto com as **etiquetas** dos claims.

Cenário 10 do smoke: texto `"Cobrimos alagamento em até 24 horas, por R$ 9,90 ao
mês"` com o claim rotulado `GENERAL`. Resultado: `EXECUTABLE`, sem nenhum reason
code. Cobertura, prazo e preço numa frase só, aprovados.

**5. Nenhum claim material pode ser sustentado — por construção.** O contrato
`olga://io/draft-composition` é `additionalProperties: false` e **não tem campo
`evidence_ids`**; o adapter interno recusa qualquer claim material com
`evidence_ids` vazio. Logo: todo claim material declarado honestamente é
recusado, e o único jeito de o texto passar é a etiqueta mentir (achado 4).

Na prática, o AGT-MKT-CONTENT nunca escreve sobre cobertura, preço ou prazo — que
é metade do marketing de uma corretora. O que falta não é um campo: é o pipeline
de evidence para conteúdo (nenhuma capability cria evidence hoje; só o Brand
Brain grava a sua fonte).

**6. A resolução canônica é feita pelo modelo.** O `IntentResolution` traz
`entities[].canonical_id`, e o loop só confere se é nulo. Nada verifica se o id
existe, se é do tipo certo ou se pertence ao tenant antes de o compilador
montar os args. O contrato `olga://io/entity-resolution`, feito para isso, não é
usado por ninguém.

O escopo por organização segura o pior caso (testado: id de outra org é
recusado), mas a mensagem que sai é `BRAND_BRAIN_NOT_ACTIVE` — indistinguível de
um problema de cadastro. Um id inventado responde a mesma coisa.

**7. O trace não reproduz a execução.** `mkt.audit_events` existe desde a
migration `0004`, tem RLS append-only e teste provando que a aplicação não
consegue reescrever o passado — e **nenhuma linha do sistema escreve nela**.
Depois de 11 execuções de agente no smoke: `audit_events = 0`.

Em `mkt.agent_runs`, as colunas `model`, `prompt_version`, `input_tokens`,
`output_tokens` e `cost_cents` ficam nulas em toda execução. O custo existe em
`mkt.model_spend` por chamada, mas não é atribuído a run nem a agente.

### P2 — arestas que atrapalham operar

**8. Workspace não isola leitura.** As portas `contentVersion`, `claimsFor` e
`evidenceFor` filtram por `org_id`, não por workspace. Cenário 11: sessão do
workspace Principal revisou conteúdo da unidade B. Cross-org está fechado; entre
unidades da mesma corretora, não.

**9. Recusa permanente sai como "tente de novo em alguns minutos".** Quando a
capability falha por motivo definitivo (`CLAIM_UNSUPPORTED`,
`CONTENT_NOT_APPROVED`), o loop devolve `TEMPORARILY_UNAVAILABLE`. Além disso,
`QUALITY_BLOCKED` e `CLARIFICATION_REQUIRED` são gravados como `FAILED` em
`agent_runs` — qualquer métrica de falha nasce contaminada por perguntas
legítimas.

**10. Não há como um humano falar com o agente.** `POST /api/agent` existe e
funciona; nenhuma tela o chama (`/brand`, `/content`, `/approvals`, `/login`).
Testar hoje é `curl` com JWT. E não havia dado de demonstração — é o que o
`scripts/smoke-agentes.mjs` passa a resolver.

---

## 6. Como testar hoje

```bash
export TEST_DATABASE_URL=postgres://…        # Postgres com as 10 migrations
node packages/db/scripts/migrate.mjs         # aplica, se ainda não aplicou
npm test                                     # 422
npm run gate:g0 && npm run gate:g1           # 10/10 cada
npm run evals                                # 24 casos de governança
npm run smoke:agentes                        # os 4 agentes, 11 cenários, ponta a ponta
```

O smoke termina com código 1 enquanto os achados 4 e 8 estiverem abertos, **e
isso é de propósito**: ele declara o que o sistema deveria fazer e reporta a
diferença. Um smoke que se declara verde com um critério faltando cria confiança
sem lastro.

Para exercitar com modelo real, faltam os achados 1 e 2 corrigidos e
`ANTHROPIC_API_KEY` no ambiente — sem a chave, `createWorkerApp` sobe sem
`agentLoop` e a rota responde 503, o que é o desenho certo e está dito no
retorno, não escondido.

---

## 7. O que isso quer dizer para o piloto interno

Os quatro agentes existem, executam e param onde devem parar na maioria dos
casos. O que impede um piloto interno honesto hoje não é maturidade de agente —
é que **o caminho de produção nunca foi percorrido uma vez**: o provider real
descarta contexto, o roteamento aponta para modelos inexistentes, e os fatos que
governam a decisão chegam de quem pede.

Os três são correções pequenas e localizadas. Os achados 4, 5 e 6 são desenho, e
merecem decisão antes de código.

Promover BRAND, CONTENT ou COMPLIANCE para `ACTIVE` continua sendo ato de
governança, com migration e motivo próprios — e nenhum deles deveria ser
promovido antes dos P0 fechados, porque promover é justamente tirar o
`internal: true` que hoje limita o alcance de cada um desses furos ao OWNER.
