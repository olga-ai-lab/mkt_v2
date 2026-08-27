# Os agentes do Olga Marketing OS

Quatro agentes. Este arquivo existe porque eles não moram num lugar só, e
alguém que abre o repositório precisa conseguir ver o sistema sem caçar.

**Um agente aqui não é um arquivo de prompt.** É uma linha governada em
`mkt.agent_registry` mais uma camada fina de código. Essa escolha é deliberada
e está explicada em [`docs/AGT-BASE.md`](docs/AGT-BASE.md): missão, capabilities
e reason codes escritos em dois lugares um dia divergem, e a divergência seria a
pior possível — o prompt venceria na prática enquanto o registry venceria na
policy, e o agente agiria por uma regra sendo julgado por outra.

---

## O quadro

| Agente | Status | Modos | Autonomia | Capabilities |
|---|---|---|---|---|
| **AGT-MKT-COPILOT** | `ACTIVE` | read, simulate | A1 → A2 | `brand.read`, `evidence.read`, `quality.precheck` |
| **AGT-MKT-BRAND** | `CANDIDATE` | read, write | A2 → A2 | `brand.extract_from_url`, `brand.propose_version`, `brand.read` |
| **AGT-MKT-CONTENT** | `CANDIDATE` | read, write | A2 → A3 | `brand.read`, `evidence.read`, `content.create_draft`, `content.create_variant`, `quality.precheck`, `publishing.schedule` |
| **AGT-MKT-COMPLIANCE** | `CANDIDATE` | read, simulate | A1 → A2 | `brand.read`, `evidence.read`, `compliance.review` |

**Só o COPILOT está ACTIVE, e ele só lê.** Nenhum agente escreve em produção
hoje. Promover um que escreve é ato de governança com migration própria — a
migration 0009 derruba a transação se um agente com capability de escrita
estiver ACTIVE, e diz por quê.

Agente `CANDIDATE` não é agente quebrado: ele roda com `internal: true`, que
`apps/web/app/api/agent/route.ts` só permite para `OWNER`. Dá para exercitar;
não dá para servir usuário.

A promoção de cada um está no [`docs/ROADMAP.md`](docs/ROADMAP.md), bloco B,
marcada como **[proposto]** — é decisão de governança, não minha.

---

## O que cada um é

### AGT-MKT-COPILOT — a porta de entrada
Interpreta o pedido, mantém contexto, escolhe o especialista e explica o próximo
passo. Não cria, não agenda, não publica.

- **Erro mais caro:** agir quando deveria ter perguntado, mandando o pedido para
  o especialista errado.
- **Na dúvida:** pergunta. Um pedido mal roteado custa uma rodada inteira de
  trabalho do especialista errado.

### AGT-MKT-BRAND — o Brand Brain
Lê o site do cliente e propõe a versão do Brand Brain. **Só propõe:** a promoção
para `ACTIVE` é sempre humana, e isso está declarado no `deviates_from_base` do
próprio registry. A porta `proposeBrandVersion` escreve `CANDIDATE` como
literal — não existe argumento que a faça escrever `ACTIVE`.

- **Erro mais caro:** registrar como fato da marca algo que o site não sustenta,
  porque todo conteúdo gerado depois herda o erro.
- **Na dúvida:** deixa o campo vazio e marca a fonte como insuficiente. Um Brand
  Brain com lacuna é corrigível; um com afirmação errada contamina tudo que vem
  depois e ninguém percebe a origem.

### AGT-MKT-CONTENT — o texto
Cria o master content e as variantes por canal, alinhados ao Brand Brain, à
evidence e ao objetivo. Agenda; **não publica** — `publishing.publish` não está
no charter de agente nenhum, porque publicar é consequência de decisão humana de
agendar, e quem executa é o workflow durável.

- **Erro mais caro:** publicar uma afirmação sobre cobertura, preço ou prazo que
  a evidência não sustenta.
- **Na dúvida:** escreve sem a afirmação. Texto mais fraco se conserta na
  revisão; claim sem evidência publicado no perfil do cliente vira problema de
  compliance dele, não seu.

### AGT-MKT-COMPLIANCE — o freio
Verifica claims contra o Brand Brain, a lista de proibições e os disclaimers.
Verifica e **relata** — quem bloqueia é a policy, com fatos tipados.

- **Erro mais caro:** deixar passar um claim que não deveria passar. O falso
  negativo custa mais que o falso positivo.
- **Na dúvida:** marca para revisão humana. Barrar conteúdo bom atrasa uma
  publicação; liberar conteúdo errado não tem desfazer depois que foi ao ar.

---

## Onde cada parte de um agente mora

| O quê | Onde | Por que ali |
|---|---|---|
| Missão, capabilities, reason codes, autonomia, status | `packages/db/migrations/0006_seed_registries.sql` | É dado governado. Mudar exige migration, com revisão e rastro. |
| Promoção para `ACTIVE` | `packages/db/migrations/0009_promote_copilot.sql` | Ato de governança. Uma migration por promoção, com o motivo escrito. |
| Política de incerteza (o delta) | `packages/runtime/src/agent-deltas.mjs` | É a única coisa que não cabe numa coluna: o que o agente faz quando não tem certeza. |
| Casos golden e adversarial | `packages/runtime/evals/AGT-*.json` | Casos como dado. Adicionar um caso é editar JSON, não escrever teste. |
| O loop que todos percorrem | `packages/runtime/src/agent-loop.mjs` | As nove interfaces da Mestra §6. Um loop só, não um por agente. |

O delta **não reescreve** missão nem capabilities: ele lê da linha do registry e
projeta no prompt. Há teste que muda a missão no argumento e confere que o texto
gerado muda junto.

---

## O loop: as nove interfaces

Todo agente percorre a mesma sequência (Documentação Mestra §6). Quatro peças já
existiam antes e foram reaproveitadas, em vez de duplicadas:

```
1. Resolver        LLM: o que a pessoa quer, com entidades resolvidas para ID canônico
2. Retrieval       só a fatia que a intenção pede, com versão e evidência citável
3. Planner         LLM: quais capabilities, em que ordem — em `args_summary`, prosa humana
4. Respondability  policy engine determinístico, default deny
5. Compiler        CÓDIGO: os args reais nascem aqui, nunca do modelo
6. Executor        Capability Gateway, os 8 passos do MKT-09B §10
7. Validator       nunca converte erro em sucesso
8. Evidence        o efeito externo é sua própria evidência (receipt)
9. Responder       LLM: escreve a resposta, só sobre o que a evidência sustenta
```

**A linha que este código existe para ninguém cruzar** está escrita no próprio
schema do TaskPlan:

> `args_summary` — resumo humano. Os args reais são construídos pelo compiler,
> nunca pelo LLM.

O modelo propõe *o quê*. O *como* — id do conteúdo, canal, qual conta publicar —
é montado por código determinístico. Um LLM que escolhe argumentos de uma
chamada externa é um LLM que possui autorização.

---

## As 12 capabilities

| Capability | Modo | Efeito | Adapter | No charter de |
|---|---|---|---|---|
| `brand.read` | read | none | interno | COPILOT, BRAND, CONTENT, COMPLIANCE |
| `evidence.read` | read | none | interno | COPILOT, CONTENT, COMPLIANCE |
| `quality.precheck` | simulate | none | interno | COPILOT, CONTENT |
| `compliance.review` | simulate | none | interno | COMPLIANCE |
| `brand.extract_from_url` | read | internal | `web_fetch` | BRAND |
| `brand.propose_version` | write | internal | interno | BRAND |
| `content.create_draft` | write | internal | interno | CONTENT |
| `content.create_variant` | write | internal | interno | CONTENT |
| `publishing.schedule` | write | internal | interno | CONTENT |
| `approval.request` | write | internal | interno | *ninguém* |
| `channel.connect` | write | **external** | `meta_graph` | *ninguém* |
| `publishing.publish` | write | **external** | `meta_graph` | *ninguém* |

As três sem dono são de propósito. `channel.connect` é consentimento e acontece
no painel, no navegador de uma pessoa. `publishing.publish` é executado pelo
workflow durável depois de um agendamento aprovado. `approval.request` é ação do
app, não passo de agente.

## Evals

Governança, não qualidade de texto. Rodam contra Postgres de verdade: policies,
registries e o Capability Gateway são reais; **só a resposta do modelo é
roteirizada.** Um eval que trouxesse as próprias policies só provaria que
concorda consigo mesmo.

| Agente | golden | adversarial |
|---|---|---|
| AGT-MKT-COPILOT | 3 | 5 |
| AGT-MKT-BRAND | 2 | 3 |
| AGT-MKT-CONTENT | 1 | 4 |
| AGT-MKT-COMPLIANCE | 1 | 2 |

Todo agente `ACTIVE` precisa de eval próprio — há teste que verifica isso.
Promover sem medir é promover no escuro.

Qualidade de texto é outra suíte, estatística, e depende do golden dataset que o
MKT-17 manda construir na Fase 2 com as três corretoras piloto (achado G11).
Misturar as duas produz uma suíte que ninguém confia porque falha por motivo
aleatório.
