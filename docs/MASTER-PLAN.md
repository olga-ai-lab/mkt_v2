# Master Completion Plan

**Fonte única de verdade para terminar o produto.** Substitui o `docs/ROADMAP.md`,
que respondia "o que ainda queremos construir" quando a pergunta certa é **"qual
é a sequência obrigatória para chegar a produção com segurança"**.

Última verificação contra o repositório: **2026-09-11**.

---

## Procedência — como ler cada item

| Marca | Significa |
|---|---|
| **[MKT-17]** | Está no plano de construção entregue pela Olga |
| **[Mestra]** | Está na Documentação Mestra de Engenharia de Agentes V11 |
| **[Olga]** | Decisão de produto que a Olga tomou nesta revisão do plano |
| **[verificado]** | Fato conferido contra o repositório ou a API, com a data acima |
| **[derivado]** | Consequência do código; apareceu depois, não estava no plano |
| **[proposto]** | Inferência minha. Precisa de confirmação antes de virar trabalho |

---

## O estado real, verificado hoje

### Branches e PRs **[verificado]**

| Branch | PR | CI | O que traz |
|---|---|---|---|
| `claude/projeto-superpower-plugin-iyj47t` | — (base) | ✅ `6be0b5a` | agentes, gateway, briefs, prompts de marketing |
| `claude/novo-modulo-marketing-5l992o` | **#3** | ✅ `7da78bf` (02/09) | AI review, source contracts, personas, containment, aliases, safety trace |
| `claude/quirky-fermi-khs24u` | **#4** | ❌ `b6d58d3` | model ids reais, taxonomia de mercado, perfil da empresa |
| `claude/brave-brown-wass2m` | **#6** | ✅ `811fb08` | grants, estratégia rica no perfil |
| `claude/analise-correcao-producao-mz2ke5` | **nenhum** | ❌ `32c5169` | precheck→AI review, **promoção de COMPLIANCE, BRAND e CONTENT** |

### Duas coisas que a revisão do plano não tinha

**1. A colisão de migrations é de quatro vias, e começa em `0010` — não em `0011`.**

```
       base (#5 já mergeado)    PR #3            PR #4              analise-correcao
0010   brand_brain_promocao     brand_extraction  brand_brain_promocao  brand_brain_promocao
0011   content_briefs           ai_review         model_ids_reais       precheck_ai_review
0012   marketing_profile_prompts source_contracts taxonomia_mercado     promote_compliance
0013   seed_marketing_prompts   agent_personas    perfil_da_empresa     promote_brand_content
0014   —                        containment       —                     model_spend_capability
0015   —                        entity_aliases    —                     publication_schedules
0016   —                        safety_trace      —                     —
```

O PR #3 divergiu **antes** da `0010` da base. Ele não tem `brand_brain_promocao`
— tem outra coisa com o mesmo número. Isso não é renumerar: é reconciliar duas
histórias que discordam sobre o que é a migration 10.

**2. Uma branch já promoveu os três agentes.**

`analise-correcao-producao-mz2ke5` tem `0012_promote_compliance` e
`0013_promote_brand_content`. Ela não tem PR aberto e a CI está vermelha — mas o
trabalho existe e está escrito no formato certo, com o motivo junto.

Isso contradiz diretamente a decisão **[Olga]** de não promover ninguém antes do
G2. A branch precisa de uma resolução explícita: ou as promoções esperam o G2 e
ficam de fora da consolidação, ou o G2 é declarado não-obrigatório para o
COMPLIANCE. **Não decido isso.**

### O bloqueio que é seu **[verificado]**

**Não consigo inventariar o `mkt_v2` real.** O conector Supabase desta sessão
alcança 4 projetos e `emumzyejysosywlsridm` não está entre eles — mesma
limitação registrada em `docs/HANDOFF.md` §3. O projeto órfão
(`ogmypcbaqcamguqbhxjo`) tem 4 tabelas vazias em `public`; nada foi aplicado lá.

**Renumerar migration sem saber o que já foi aplicado em produção é escrever uma
sequência que o banco vai recusar.** Este é o primeiro item da Fase 0 e ele
depende de você rodar uma consulta no SQL Editor. A consulta está no fim deste
documento.

---

## As fases

### Fase 0 — Consolidação **[Olga]**

Antes de qualquer código de produto. Hoje não existe uma verdade única do
projeto: existem cinco.

| # | Item | Dono |
|---|---|---|
| 0.1 | **Inventário do `mkt_v2` real**: quais migrations já estão aplicadas | **Olga** — bloqueia todo o resto |
| 0.2 | Escolher a branch canônica | **Olga** |
| 0.3 | Reconciliar as quatro sequências de migration numa só | eu, depois de 0.1 |
| 0.4 | Trazer PR #3, #4 e #6 conscientemente — não merge automático | eu |
| 0.5 | Resolver `analise-correcao`: promoções entram ou esperam o G2? | **Olga** |
| 0.6 | Regenerar contratos (`npm run contracts:generate`) e fechar a CI do #4 | eu |
| 0.7 | Decidir o deploy (ADR-0012 segue como PROPOSTA) | **Olga** |

**Gate de saída:** uma branch, CI verde, uma sequência de migrations, e a
sequência bate com o que está aplicado no `mkt_v2`.

Sobre 0.6: a CI do PR #4 falha exatamente no passo *"Tipos gerados batem com os
schemas"* **[verificado]**. É o mesmo defeito que já apareceu duas vezes neste
projeto — schema muda, `generated/index.d.ts` não é regenerado. O passo existe
para pegar isso, e pegou.

### Fase 1 — Knowledge Foundation **[Olga]**

A inversão de prioridade que a revisão trouxe, e ela está certa: o
conhecimento vem antes dos agentes que o consomem.

```
Taxonomia Olga de Seguros → Canonical Registry → Company Profile
→ Sources → Evidence → Agents
```

| # | Item | Estado |
|---|---|---|
| 1.1 | Taxonomia de seguros: produtos/ramos, públicos, tipos de conteúdo, termos e vedações | PR #4, `0012_taxonomia_mercado` |
| 1.2 | Canonical registry e resolução canônica na execução | parcial |
| 1.3 | Company Profile: produtos, seguradoras, público, tom, proibições, evidências, versão | PR #4, `0013_perfil_da_empresa` + tela `/perfil` |
| 1.4 | Fontes: site, LinkedIn, documentos, dados informados | parcial (`web_fetch` existe) |
| 1.5 | **Entrevista guiada para completar as lacunas** | não começado |

A jornada do perfil, como **[Olga]** desenhou:

```
Site · LinkedIn · Documentos · Dados informados
                    ↓
              PROFILE AGENT
                    ↓
       Evidence + Canonical Mapping
                    ↓
                  Gaps
                    ↓
            Entrevista guiada
                    ↓
            CANDIDATE PROFILE
                    ↓
                 Humano
                    ↓
             ACTIVE PROFILE
```

**1.5 é o que falta para a jornada fechar.** O `nao_encontrado` do contrato
`olga://io/brand-brain-proposal` já declara as lacunas; o que não existe é a
entrevista que as preenche.

**Gate de saída:** um perfil ACTIVE completo e rastreável até a fonte.

### Fase 2 — Gate G2: Agent Framework Compliance **[Olga]**

Nenhum agente vira `ACTIVE` sem cumprir os 17 critérios:

```
Charter · Authority · Ontology · Canonical · Semantic · Sources · Rules
Schemas · Capabilities · Evidence · Grounding · Respondability · Evals
Trace · Security · Isolation · Rollback
```

Isto **substitui** a regra anterior (`eval passou → migration → ACTIVE`), que a
revisão corretamente apontou como insuficiente: `ACTIVE` deve significar
aprovado, versionado, testado e apto para produção — não apenas "não produz
efeito externo".

| Agente | Vira ACTIVE quando |
|---|---|
| PROFILE | extrai + evidencia + canonicaliza + declara lacunas + humano promove |
| CONTENT | usa PROFILE ACTIVE + evidence + gera claims sustentados |
| COMPLIANCE | lê o **texto**, detecta e classifica claims por conta própria, aplica policies |
| COPILOT | missão redefinida — assistência e explicação, provavelmente não roteamento |

O critério do COMPLIANCE merece nota: hoje ele **confia na classificação do
claim** que veio gravada, em vez de analisar o texto. Está escrito assim no
código e é uma limitação real, não um bug escondido — mas é exatamente o tipo
de coisa que `ACTIVE` não pode ter.

A sequência de promoção passa a ser:

```
P1/P2 resolvidos → smoke 100% → G2 → shadow → internal → pilot → ACTIVE
```

**Gate de saída:** `npm run gate:g2` verde para o agente em questão.

### Fase 3 — Jornada funcional ponta a ponta **[Olga]**

```
Onboarding → Profile → Conteúdo → Compliance → Aprovação
→ Agenda → Canal → Publicação → Receipt
```

Telas que faltam **[verificado]**: criar conteúdo existe (`/content`, veio do
PR #5), conectar canal não existe, ver o trace de uma execução não existe.

**Gate de saída:** a jornada inteira utilizável pela interface, sem SQL.

### Fase 4 — Qualidade real **[MKT-17, achado G11]**

Golden dataset com as três corretoras piloto: copy, factualidade, estilo,
compliance e regressões. Estatística, não determinística — suíte separada da de
governança, e é por isso que as duas não moram juntas.

**Gate de saída:** thresholds definidos e aprovados.

### Fase 5 — Piloto / Canary **[Olga]**

Corretoras piloto em shadow/A1/A2. Medir erro, custo e qualidade.

**Gate de saída:** indicadores dentro dos limites.

### Fase 6 — Produção **[Olga]**

Meta real, observabilidade, rollback, kill switch, budgets, incidentes,
runbooks.

**Gate de saída:** Gate Production.

### Depois do MVP

LinkedIn, imagens, RSS, performance, jornadas, newsletter, carteira.
**Não bloqueiam o lançamento inicial.**

---

## Dívidas conhecidas, sem fase

| O quê | Por que ainda está aí |
|---|---|
| `agent-runtime.mjs` (152 linhas) não é montado em lugar nenhum | O `agent-loop.mjs` o substituiu. Apagar é limpeza que ninguém autorizou. |
| Check de disclaimers exige *todos* quando há claim material | A lista é de strings soltas. Erra para revisão humana, que é o erro barato. |
| `activated_by` só em `brand_brain_versions` | É a única tabela em que ativar é assumir responsabilidade por algo que o agente escreveu. |

---

## A consulta que destrava a Fase 0

Rode no SQL Editor do projeto **`emumzyejysosywlsridm`**, schema `mkt_v2`, e me
mande o resultado:

```sql
-- 1. O que já está aplicado
select * from mkt_v2.schema_migrations order by 1;

-- 2. Conferência independente: as tabelas que existem
select table_name from information_schema.tables
 where table_schema = 'mkt_v2' order by 1;

-- 3. Alguma tabela sem RLS?
select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'mkt_v2' and c.relkind = 'r' and not c.relrowsecurity;
```

A consulta 2 existe porque a 1 pode mentir: se alguém aplicou SQL pelo editor
sem registrar na tabela de controle, só as tabelas reais contam. Já aconteceu
neste projeto — as migrations 0007 e 0008 foram aplicadas exatamente assim.
