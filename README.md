# Olga Marketing OS

Implementação das **Fases 0 (Fundação)**, **1 (Walking skeleton)** e do primeiro
bloco da **Fase 2 (Brand Brain)** do plano MKT-17.

O esqueleto anda de ponta a ponta: pedir aprovação → aprovar → agendar → outbox
→ workflow → gateway → adapter → publicado, provado contra Postgres em
`packages/db/test/pipeline.test.mjs`.

E o onboarding de uma marca também: ler o site cadastrado → conferir o que a
página sustenta → propor uma versão candidata → uma pessoa ativar, em
`packages/db/test/brand-onboarding.test.mjs` e
`packages/db/test/brand-activation.test.mjs`.

E a cadeia editorial: rascunho → revisão de IA → revisão humana → aprovado, em
`packages/db/test/ai-review.test.mjs`.

> O LLM interpreta; os contratos decidem; o código calcula; as ferramentas
> executam; a evidência sustenta.

Este repositório existe para transformar esse princípio em algo que quebra
quando alguém o contraria. Um schema JSON validado em CI é mais normativo que
um PDF aprovado.

---

## O que já está de pé

| Peça | O que faz | Prova |
|---|---|---|
| `packages/contracts` | JSON Schema dos 16 contratos de I/O, dos 5 registries e dos enums fechados. Tipos TS gerados | 15 testes |
| `packages/policy` | Policy engine determinístico: invariantes de código + regras como dado, default deny | 19 testes |
| `packages/gateway` | Capability Gateway com os 8 passos do MKT-09B §10, e os adapters: meta_graph, web_fetch, brand_extract e internal | 111 testes |
| `packages/db` | 16 migrations, 32 tabelas, RLS forçada, state machine no banco | 235 testes |
| `packages/runtime` | Model Gateway, Agent Runtime, loop de agente, retrieval, redator, extrator, persona, contenção e governança de Brand Brain | 142 testes |
| `apps/worker` | Workflow durável de publicação, replay-safe | 25 testes |
| `apps/web` | Home, login, conteúdo, fila de aprovação, revisão e edição de Brand Brain. Tokens do MKT-06A e microcopy de todo reason code | 24 testes |
| `docs/adr` | 11 ADRs fechando o que o MKT-09B deixava OPEN | — |
| `docs/AGT-BASE.md` | O contrato comum que os 13 pacotes repetiam | — |

**618 testes e 37 evals de agente** (16 golden, 21 adversariais). `npm run gate:g0` e `npm run gate:g1`
verificam os critérios de cada gate executando cada um deles — e o G1 nunca se
declara fechado sozinho, porque o que falta nele não é código.

## As três decisões que este código materializa

**1. A0–A4 existe.** O MKT-17 apontou que os níveis de autonomia — o diferencial
de confiança declarado no MKT-01 — apareciam em cinco documentos e não estavam
definidos em nenhum. Agora estão em `packages/contracts/enums/autonomy.json`,
com semântica por nível e exigências de plataforma. Um teste garante que só A3 e
A4 produzem efeito externo e que ambos exigem idempotência e receipt.

**2. Policy é dado, não prompt nem código.** Duas camadas: invariantes
hard-coded que nada configurável afrouxa, e `mkt.rule_policies` avaliadas por
prioridade. **Policy só restringe.** Nenhuma linha de banco concede mais
autonomia que o teto de risco. Capability de escrita sem policy ACTIVE é negada.

**3. Fallback de modelo nunca é silencioso.** O MKT-09B §8 exige isso e é fácil
de violar sem perceber. Se o primário cai, o resultado volta com
`fallback_used` e o motivo. Em decisão material, o fallback só acontece com
autorização explícita — caso contrário a chamada falha, porque trocar de modelo
sem avisar numa decisão que importa é pior que falhar.

O orçamento é verificado **antes** da chamada, não na conta do fim do mês. E
workspace sem orçamento configurado devolve `NULL`, não zero: um significa "sem
teto definido", o outro "teto atingido". Confundir os dois deixa o produto
gastar às cegas — há teste para isso.

**4. Replay não duplica.** A idempotência não está no workflow; está no
Capability Gateway e numa constraint de unicidade. O workflow pode ser
reexecutado do zero quantas vezes for — o teste faz isso dez vezes e verifica
que o provider foi chamado uma única vez.

## O onboarding de uma marca, e onde ele para de propósito

A Fase 2 começa pela pergunta que decide se o produto serve para alguém novo:
como uma corretora que nunca usou nada disso ganha um Brand Brain sem preencher
formulário? A resposta é ler o site dela. E ler o site de alguém é onde as
coisas costumam dar errado em silêncio.

```
brand.extract_from_url ──> brand.propose_version ──> uma pessoa ativa
   busca + leitura            versão CANDIDATE          versão ACTIVE
```

**Interpretação e permissão não correm no mesmo trilho.** `identity` e `tone`
são síntese: ninguém espera achar a frase na página. Já cada item de
`claims_allowed` autoriza o redator a repetir aquilo depois — então cada um
exige a citação literal que o sustenta, e quem confere a citação contra a página
é código. Item sem lastro não entra, e aparece em `discarded` com o motivo.
Descartar em silêncio seria pior que aceitar: quem revisa precisa saber que
houve invenção, porque isso diz algo sobre a extração inteira.

**Procedência é produzida por código.** O contrato que o modelo responde
(`olga://io/brand-extraction`) não tem campo para `source_refs`, e o
`additionalProperties: false` recusa a tentativa. A fonte sai da busca: URL final
depois dos redirecionamentos, hash do texto lido, hora. É ela que responde, seis
meses depois, de onde aquela versão da marca veio.

**`prohibitions` sai sempre vazia da extração**, e o contrato garante isso com
`maxItems: 0`. Uma página diz o que a marca fala, não o que ela se recusa a
falar. Proibição extraída de site seria invenção com aparência de regra — e é
ela que alimenta o `compliance.review`. Quem preenche é uma pessoa, editando a
candidata antes de ativá-la.

**Editar não muda a versão: cria a próxima.** Uma versão de Brand Brain é o que
autoriza o redator a afirmar cada coisa; mudar uma linha existente trocaria em
silêncio o que o agente pode dizer, sem rastro de que era outra coisa antes. As
`source_refs` são herdadas e nunca regravadas — a pessoa editou o texto, não leu
a página de novo.

**Ativar não é capability, e não vai virar uma.** Quem propõe não pode ser quem
aceita: se o agente que leu a página pudesse ativá-la, a única coisa entre "um
modelo leu um site" e "a marca autoriza estes claims" seria ele mesmo. Em
`/brands/[id]/brain` os dois atos são separados por papel — derivar é de
`MARKETING` ou `OWNER`, ativar é de `OWNER` — e a tela diz o que a versão não
tem antes de alguém assumi-la.

## A revisão de IA, e por que são duas capabilities

A J11 não liga `DRAFT` à revisão humana: `AI_REVIEW` vem antes. E nada movia
`DRAFT` para `AI_REVIEW` — `quality.precheck` era a revisão de IA em intenção,
mas o `side_effect` dela é `none`, e capability que não escreve não muda estado.
Todo conteúdo escrito pelo agente ficava preso, e `approval.request` recusava,
corretamente, por uma etapa que ninguém tinha como cumprir.

A saída não foi trocar o `side_effect` do precheck. `mode: simulate` significa
"calcula um veredito e não produz efeito", e um simulate que escreve é mentira
no lugar onde a policy decide, o gateway roteia e os evals conferem. Então são
duas capabilities sobre a **mesma conferência**, que é uma função só:

| | mode | o que faz |
|---|---|---|
| `quality.precheck` | `simulate` | devolve o laudo, e nada mais |
| `quality.ai_review` | `write` | devolve o mesmo laudo e, quando ele passa, transiciona |

**O laudo que reprova não é falha da capability.** Achar problema é ela
funcionando: devolve `valid: false`, não transiciona, e quem para o loop é o
laudo. Lançar diria "tente de novo em alguns minutos" para um claim sem lastro.

**`AI_REVIEW` não entra sozinho.** O laudo é gravado na mesma transação, em
`mkt.marketing_events`: estado sem evidência é confiança sem lastro.

## Freshness é parte da verdade

"Dado correto e desatualizado pode gerar resposta falsa" (Documentação Mestra
§3). O retrieval carregava um `maxAgeDays = 90` único, aplicado igual ao Brand
Brain, a uma página de site e ao registro da marca no nosso próprio banco.

Cada fonte agora tem contrato em `mkt.source_contracts` (Mestra §7.5), com
autoridade temporal, prazo, qualidade padrão, PII, escopo de permissão e
caveats:

| Fonte | Carimbo que conta | Vence em | Qualidade |
|---|---|---|---|
| `BRAND_BRAIN` | `activated_at` | 180 dias | HIGH |
| `SOURCE_ARTIFACT` | `retrieved_at` | 30 dias | MEDIUM |
| `UPLOADED_FILE` | `retrieved_at` | 365 dias | MEDIUM |
| `DOMAIN_RECORD` | `created_at` | nunca | HIGH |
| `PROVIDER_RESPONSE` | `recorded_at` | nunca | HIGH |

**`max_age_days` nulo é uma afirmação**, não um campo esquecido: aquela fonte
não vence. Um registro nosso não fica velho — fica errado, e errado não se
detecta por idade.

**Fonte sem contrato vence**, com o motivo. É fail-closed: a alternativa deixa
uma fonte nova entrar em produção sem ninguém decidir quando ela envelhece.

**A autoridade temporal nem sempre é o `created_at`.** Um Brand Brain vale a
partir do `activated_at`, porque foi ali que uma pessoa assumiu aquilo como a
marca. Escolher o carimbo errado envelhece a fonte errada.

## Persona e prompt são versionados, e o trace registra as duas versões

"O agente respondeu isso em setembro" fica sem resposta se ninguém sabe com que
persona e que prompts ele respondia em setembro. A Mestra §32 manda versionar as
duas coisas; a §30 manda o trace registrá-las.

**Persona é dado**, em `mkt.agent_personas`, com os oito campos do §9 e versão
própria. `agent-deltas.mjs` não guarda persona: ele a renderiza, e não conhece
nenhum agente pelo nome. Trocar o tom de um agente é uma migration revisável, e
não um commit no meio de um objeto literal.

**Prompt tem lock.** `packages/runtime/prompts.lock.json` guarda o hash de cada
texto e o histórico por versão. `npm run prompts:lock` recusa regravar quando a
versão corrente já está registrada com outros hashes:

```
A versao 1 ja esta registrada com outros hashes.
  mudou: extrator
Suba "version" em prompts.lock.json para 2 e rode de novo.
```

Sem isso, versionar prompt seria um número que alguém lembra de subir — e o que
alguém precisa lembrar de fazer não é uma garantia.

**A linha de Performance do trace vem do ledger.** `runs.finish` agrega
`mkt.model_spend` pelo `agent_run_id` no mesmo UPDATE que fecha o run. Somar por
fora criaria uma segunda contabilidade que um dia discordaria da primeira. Um run
que não chamou modelo fecha com `model` e `cost_cents` nulos, e não zero: zero
diria "consultei e não custou".

## Um nome vira um id por consulta, e não por palpite do modelo

`olga://io/entity-resolution` existia desde a Fase 0 e **nada o implementava**.
Quem preenchia `canonical_id` era o LLM — que não tem como saber um uuid. Ou
devolvia `null`, e todo pedido que nomeava uma marca morria em
`CLARIFICATION_REQUIRED`, ou inventava um, e a recusa vinha por acidente,
quando o `SELECT` do compilador não achava a linha.

O passo entra entre o resolver e o retrieval, e daqui para baixo o loop
trabalha com entidades **verificadas contra o tenant**: `intent.entities` não
chega mais ao compilador. Quatro caminhos, do mais forte para o mais fraco —
o próprio id, o nome cadastrado, o apelido registrado, e por último o palpite
do modelo, aceito só depois de conferido que existe nesta organização.

Fuzzy continua proibido (Mestra §13). Só há igualdade, depois de `mkt.norm`
aplicada nos **dois lados** — caixa, acento e espaço, que não é aproximação e
sim a mesma palavra escrita de outro jeito. "Corretora Ipe Seguros" não resolve
para "Ipê Seguros": o sistema pergunta. Aceitar 0.87 de similaridade é publicar
no perfil errado uma vez a cada tanto, e ninguém consegue dizer quanto é tanto.
Para dois nomes que precisam conviver existe apelido — uma linha que alguém
escreveu, com autor e data, e um índice único que garante que ela nunca aponte
para duas coisas.

Dois cadastros com o mesmo nome viram `AMBIGUOUS_ENTITY` ("achei várias, qual
delas?"); nenhum vira `NORMALIZATION_FAILED` ("não achei"). Os códigos não se
confundem porque pedem coisas diferentes de quem lê.

## A linha *Safety* do trace, e o que ela deliberadamente não faz

A defesa contra injeção neste sistema é **estrutural**, e nenhuma metade dela
depende de reconhecer o ataque: texto de usuário entra na sexta camada de
contexto, nunca na de sistema, e os argumentos de toda chamada nascem no
compiler a partir de entidades verificadas. É por isso que funciona contra
ataques que ninguém previu.

O problema é que é silenciosa. Se um dia falhar, nada no banco diz que alguém
tentou. `packages/runtime/src/safety.mjs` **não é a defesa — é o registro**, e
essa distinção está escrita no topo do arquivo porque a leitura preguiçosa dele
é o caminho para alguém afrouxar a defesa achando que há uma rede embaixo.

Registra e não bloqueia: um regex que bloqueia é um regex que autoriza, e quem
bloqueia aqui é a policy. *"Ignore o rascunho anterior e comece de novo"* é
pedido legítimo de quem escreve marketing — há teste para as duas metades, o
padrão pegar o ataque **e** não pegar o pedido honesto que se parece com ele.

Varridos: o texto do usuário, o material recuperado (o vetor de dentro — um
Brand Brain cuja `identity` diga "ignore as instruções anteriores" entra em todo
run daquela marca) e a página buscada no onboarding.

**PII:** `carries_pii` existia no contrato de fonte desde a 0012, e o caveat do
`UPLOADED_FILE` dizia com todas as letras que era "a que recebe documento sem
passar por nenhum filtro nosso". Agora a fatia de uma fonte marcada com PII é
redigida antes de entrar na camada `governed`. A limitação é declarada: a
redação é por formato — CPF, CNPJ, e-mail, telefone, CEP — e não pega nome de
pessoa, que não tem forma. Fingir que pega seria pior, porque alguém confiaria.

Nas três colunas, **nulo e zero não são a mesma coisa**: nulo diz "não cheguei a
olhar", zero diz "olhei e não havia". Um run que parou antes do plano não é um
run que a policy aprovou.

## Conter um incidente sem esperar um deploy

O kill switch **é uma policy**, e não uma flag nova. O mecanismo já existia:
avaliado deterministicamente, escopado por capability, modo, agente, canal e
risco, com "policy só restringe" como invariante de código. Uma tabela de flags
ao lado seria um segundo lugar capaz de bloquear a mesma coisa.

O que faltava era a operação — durante um incidente ninguém escreve migration:

```bash
curl -X POST "$OLGA_URL/api/containment" -H "authorization: Bearer $TOKEN" \
  -d '{"action":"kill_writes","reason":"incidente: post duplicado na conta X"}'
```

| Ação | O que faz |
|---|---|
| `kill_writes` | para toda escrita do workspace, e deixa a leitura de pé |
| `kill_agent` / `kill_capability` | para um agente ou uma capability |
| `degrade_agent` | baixa o teto para A1 — interpreta e explica, não executa |
| `lift` | levanta, com motivo, marcando BLOCKED em vez de apagar |

A policy é lida a cada run, sem cache: a contenção vale no run seguinte. O
motivo é obrigatório — uma linha que bloqueia sem dizer por quê vira, duas
semanas depois, uma linha que ninguém sabe se pode remover.

`expires_at` **não** levanta nada sozinho. Uma contenção que some por conta
própria é uma contenção em que ninguém confia.

O passo a passo está em [`docs/runbooks/conter-incidente.md`](docs/runbooks/conter-incidente.md).

## O protótipo de telas, e por que ele não está em `/`

`apps/web/mktos/` tem doze telas desenhadas no Lovable, servidas em
`/prototipo`. **Tudo ali é dado de mentira**: nada chama API, lê banco ou passa
pelo Capability Gateway.

Uma tela que parece o produto e não é o produto é a coisa mais perigosa que este
repositório pode conter — mesmo defeito da coluna vazia e do kill switch que
grava sem bloquear. Por isso: rota separada, faixa fixa no topo e link rotulado.

`apps/web/mktos/README.md` diz, tela a tela, o que tem backend atrás. Três estão
completas (Aprovações, Marca, Conteúdo), cinco parciais, e quatro — Desempenho,
Jornadas, Carteira, Newsletter — desenham coisas que não existem em lugar nenhum
do sistema.

O desenho vem do Lovable, que mantém o repositório `marketplace-sync` como
prancheta — ele monta um app na raiz a partir de um template e não sabe escrever
dentro de um monorepo, então os dois repositórios existem de propósito:

```sh
npm run sync:prototipo          # traz o que mudou no Lovable
npm run sync:prototipo -- --check
```

Cada lado é dono de uma coisa: **layout** é do Lovable, **ligação com dados** é
daqui e mora em `apps/web/app/<rota>/page.tsx`. `apps/web/mktos/.sync.json`
guarda o hash de cada arquivo copiado e a sincronização para se algum tiver sido
editado à mão — em vez de apagar o trabalho em silêncio.

## Rodar

```bash
npm install
npm run contracts:generate

createdb olga_test
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/olga_test
npm run db:migrate:local

npm test          # todos os testes, e o typecheck junto
npm run gate:g0   # verificação do Gate G0
npm run gate:g1   # verificação do Gate G1
npm run evals     # evals de governança dos agentes
npm run prompts:lock  # regrava o lock de prompts (recusa sem bump de versão)
```

## Estrutura

```
packages/contracts   schemas, enums, validadores, tipos gerados
packages/policy      engine determinístico de autonomia e policy
packages/gateway     única porta de efeito colateral
packages/db          migrations e testes de isolamento, pipeline e onboarding
apps/web             Next.js — tokens e microcopy
apps/worker          Inngest — workflow durável de publicação
docs/adr             decisões técnicas com ponto de revisão
packages/runtime     model gateway, loop de agente, extrator e ativação de marca
scripts/gate-g0.mjs  verificação executável do gate
```

## Banco

Todo o Marketing OS vive no schema **`mkt`**. Nada em `public`. A migration
`0001` cria o schema, as funções de acesso e o helper `mkt.enable_org_rls()`
por onde passa toda tabela tenant-owned.

Reverter é uma operação: `drop schema mkt cascade`.

Ver `docs/adr/0011-schema-mkt.md` para o porquê.

**Nenhuma tabela do schema fica sem RLS** — e isso é testado, não combinado.
`mkt.processed_events` nasceu sem: não tem `org_id`, então não passou pelo helper
`enable_org_rls()`, e ninguém ligou na mão. No Supabase isso significa tabela
legível e gravável por qualquer um com a anon key. O advisor encontrou depois de
o schema já estar aplicado em banco. A correção pontual está em `0005` e `0008`;
o que impede a repetição é o teste que varre `pg_class` e falha se qualquer
tabela do schema tiver `relrowsecurity = false`. Sem `org_id` não é desculpa:
liga-se a RLS sem policy, e só `service_role` (que tem `BYPASSRLS`) passa.

### Schemas paralelos

Os `.sql` são a fonte única e usam `mkt.` literalmente, para continuarem
executáveis direto no psql. Para materializar a mesma estrutura sob outro nome:

```bash
MKT_SCHEMA=mkt_v2 npm run db:migrate:local
```

O runner reescreve apenas o token `mkt` quando ele aparece como qualificador de
schema — nomes que só contêm "mkt" ficam intactos, e há teste para isso. Cada
schema alternativo é uma cópia completa e independente: enums, funções, policies
e triggers próprios. Um `insert` em um não aparece no outro.

Isso serve para evoluir uma versão sem tocar na que está de pé. **Não é
mecanismo de migração de dados** — copia estrutura, não linhas.

### Aplicar sem CLI

Para um projeto Supabase que você não quer (ou não pode) alcançar por linha de
comando, gere um `.sql` único e cole no SQL Editor:

```bash
MKT_SCHEMA=mkt_v2 npm run db:bundle
# -> packages/db/dist/mkt_v2.sql

# Incremental, para quem já aplicou as anteriores:
MKT_SCHEMA=mkt_v2 MKT_ONLY=0007,0008 npm run db:bundle
```

O bundle roda inteiro dentro de uma transação: ou entra completo, ou não entra
nada. Rodar duas vezes falha no primeiro `create type` e faz rollback — o schema
existente fica exatamente como estava, sem duplicar seed. Testado contra um banco
que já tinha `mkt` e `rh` populados: nenhum dos dois foi tocado.

## O que falta para fechar a Fase 1

**Uma coisa, e ela não é código: submeter o app na Meta.** Caminho crítico,
duas a seis semanas (ADR-0008). Até lá o produto roda inteiro com
`META_ADAPTER=fake` — o adapter falso implementa o mesmo contrato e o gateway
não distingue um do outro. Foi para isso que essa fronteira existe.

Já fechado: schema aplicado (8 migrations, 29 tabelas, nenhuma sem RLS),
adapter real do Meta Graph, tela de aprovação, outbox ligado ao Inngest, e os
produtores que alimentam as duas filas.

O Gate G1 existe e é executável: `npm run gate:g1`, 10/10 nos critérios
verificáveis. Ele **não se declara fechado** — o post real numa conta real
depende da Meta, e o gate diz isso toda vez que roda. Ver `docs/GATE-G1.md`.

### Agentes

Os quatro nascem `CANDIDATE`. O **COPILOT foi promovido para `ACTIVE`** pela
migration `0009`, com o motivo registrado nela: é o único cujo charter é só
leitura, então a promoção não amplia superfície de efeito.

Os outros três seguem `CANDIDATE` — dois deles têm capability de escrita, e
promover cada um é decisão separada, com migration e motivo próprios. Há teste
que derruba a suíte se um agente com escrita aparecer `ACTIVE`, e a `0009`
checa o mesmo no banco.

**Retrieval:** o agente lê o Brand Brain ACTIVE da marca, e só o que a
intenção pede. `CONNECT_CHANNEL` não recebe contexto nenhum, de propósito. O
que vem de lá entra como material na quinta camada de contexto — nunca como
instrução de sistema.

**Evals:** `npm run evals`. Casos em `packages/runtime/evals/<agente>.json`,
rodados contra o banco real — só a resposta do modelo é roteirizada. Eles medem
governança (parou onde devia? recusou o que devia?), não qualidade de texto;
essa depende do golden dataset da Fase 2, com as corretoras piloto.

### O que ainda depende de decisão sua

### O que falta de infraestrutura

3. **App web além da tela de aprovação.** Sem home, sem login, sem listagem de
   conteúdo. `SUPABASE_JWT_SECRET` precisa estar configurado para a sessão
   funcionar.
4. **Brand Brain a partir de URL** — Fase 2, depois da Meta liberada.

O endpoint durável do Inngest já está servido em
`apps/web/app/api/inngest/route.ts`; falta só configurar `INNGEST_EVENT_KEY` e
`INNGEST_SIGNING_KEY` no deploy.

## Rastreabilidade

Toda decisão material aponta para a fonte: MKT-01 a MKT-09B nos comentários das
migrations e dos schemas, MKT-17 nas ADRs. Nenhuma regra crítica vive apenas em
prompt — que é o que a Definition of Done do MKT-SPEC-STANDARD-01 exige.
