# `mktos/` — o protótipo de telas, e o que dele existe de verdade

Doze telas desenhadas no Lovable. Elas moram aqui, e não num repositório
separado, porque dois repositórios para um produto viram duas verdades sobre
como ele funciona — e a que ninguém mantém é a que alguém acaba lendo.

**Tudo aqui é dado de mentira.** `logic.ts` tem 831 linhas de estado escrito à
mão. Nenhum arquivo desta pasta chama uma API, lê o banco ou passa pelo
Capability Gateway. Os botões mudam estado em memória; o "publicado" da tela
nunca saiu para lugar nenhum. Servido em `/prototipo`, com faixa fixa no topo.

## O mapa

O que esta tabela responde é a única pergunta que importa ao olhar o protótipo:
**esta tela desenha algo que existe, ou algo que ainda não foi construído?**

| Tela | Backend | O que já existe |
|---|---|---|
| `TelaAprovacoes` | **completo** | `approval.request`, fila, decisão vinculada à versão, aprovação externa; tela real em `/approvals` |
| `TelaMarca` | **completo** | `brand.extract_from_url`, `brand.propose_version`, ativação, edição de candidata; tela real em `/brands/[id]/brain` |
| `TelaConteudo` | **completo** | `content.create_draft`, `content.create_variant`, `quality.ai_review`, `compliance.review`; tela real em `/content` |
| `TelaHoje` | **parcial** | `/` já mostra as contagens reais e os bloqueios (canal sem conexão, marca sem Brand Brain). O resto da tela — foco do dia, linha do tempo dos agentes — não tem fonte |
| `TelaCalendario` | **parcial** | `publishing.schedule` e o workflow durável existem; falta a leitura agregada por dia |
| `TelaAgenda` | **parcial** | pauta é conteúdo em `DRAFT`; não há entidade de "pauta" separada |
| `TelaAgentes` | **parcial** | `agent_registry`, personas versionadas, contenção e trace existem; **não há tela** — hoje se opera por SQL e pelo runbook |
| `TelaConfig` | **parcial** | contenção tem API (`/api/containment`); conexão de canal depende do app review da Meta (ADR-0008) |
| `TelaDesempenho` | **nada** | não há métrica de post. `action_receipts` guarda o `external_id`, e ninguém lê desempenho de volta do provider |
| `TelaJornadas` | **nada** | não existe entidade de campanha nem de jornada. Nenhuma capability, nenhuma tabela |
| `TelaCarteira` | **nada** | não existe audiência, lista nem segmento. `CONSENT_MISSING` existe como reason code, e não há o que dar consentimento |
| `TelaNewsletter` | **nada** | não existe. É a tela maior do protótipo (264 linhas) e a que menos tem chão |

Quatro telas desenham coisas que não existem em nenhum lugar do backend. Isso
não é crítica ao desenho — protótipo serve para isso. É o aviso de que
transformar qualquer uma delas em produto começa por uma migration e uma
capability, não por copiar o JSX.

## Portar uma tela para o produto

O código é React puro: sem TanStack, sem shadcn, sem Next. Só `react` e
imports relativos. Foi por isso que ele coube neste repositório sem reescrita —
e é por isso que portar uma tela é trabalho de trocar `useMktos()` por dados de
verdade, não de reescrever layout.

O caminho, na ordem:

1. Confira na tabela acima se há backend. Se a linha diz **nada**, o trabalho
   começa em `packages/db/migrations/` e no `capability_registry`.
2. Crie a página em `apps/web/app/<rota>/page.tsx` como Server Component,
   lendo pelas portas (`@/lib/db`), como fazem `/approvals` e `/content`.
3. Traga o JSX da tela e substitua o que vinha de `useMktos()`.
4. Todo estado que muda o banco passa por rota de API, e toda rota de API passa
   pelo Capability Gateway. O protótipo chama `logic.ts` direto; o produto não
   pode.

## O fluxo com o Lovable

**Os dois repositórios continuam existindo, e isso não é para consertar.**

O Lovable monta um app inteiro na *raiz* do repositório, a partir de um template
fixo (`.lovable/project.json` diz qual: `tanstack_start_ts_current`). Ele não
sabe escrever dentro de `apps/web/` de um monorepo que já existe — apontá-lo
para o `mkt_v2` faria com que tentasse ser dono do `package.json` da raiz.

E a sincronia dele é de **mão dupla**: o que se empurra para `main` lá volta a
aparecer no editor. Então `olga-ai-lab/marketplace-sync` não é sobra de um
acidente — é a prancheta, e precisa continuar viva para o Lovable continuar
servindo para desenhar.

```
Lovable  →  marketplace-sync (main)  →  npm run sync:prototipo  →  apps/web/mktos/
 desenha        prancheta                    um comando               a cópia
```

### A regra que impede os dois de brigarem

Cada lado é dono de uma coisa, e só de uma:

| | Quem manda | Onde se mexe |
|---|---|---|
| **Layout e visual** | Lovable | desenha lá, sincroniza para cá |
| **Ligação com dados e API** | `mkt_v2` | `apps/web/app/<rota>/page.tsx` — **nunca** no Lovable |

É por isso que esta pasta é cópia **literal** e ninguém a edita à mão. Tudo o
que liga tela a banco mora fora daqui, e por isso sobrevive a toda
sincronização.

`.sync.json` é o que faz essa regra valer em vez de ser um combinado: guarda o
hash de cada arquivo copiado, e a sincronização **para** se algum tiver sido
editado à mão — em vez de apagar o trabalho da pessoa em silêncio. Mesmo
mecanismo do `prompts.lock.json`.

```sh
npm run sync:prototipo          # traz o que mudou no Lovable
npm run sync:prototipo -- --check   # só diz se há diferença
```

O projeto no editor é `lovable.dev/projects/5d440991-abfa-4268-a359-e4a995f7904e`.
