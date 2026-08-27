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

## Sobre o Lovable

O editor continua servindo para desenhar (o projeto é
`lovable.dev/projects/5d440991-abfa-4268-a359-e4a995f7904e`). O que não pode
continuar é ele publicando num repositório próprio: `olga-ai-lab/marketplace-sync`
nasceu de um pedido de sincronizar com este repositório que o Lovable não
atendeu. Quem desenhar lá traz o resultado para cá — esta pasta é o destino, e
a cópia é literal, porque o código não depende do framework dele.
