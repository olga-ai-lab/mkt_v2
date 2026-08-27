# Como trabalhar neste repositório

Leia [`AGENTS.md`](AGENTS.md) primeiro — ele mostra o sistema. Este arquivo é
sobre as regras de quem mexe nele.

## O princípio, e o que ele obriga

> O LLM interpreta; os contratos decidem; o código calcula; as ferramentas
> executam; a evidência sustenta.

Cada parte dessa frase tem um lugar no código, e a divisão não é sugestão:

| | Onde | O que NÃO pode fazer |
|---|---|---|
| O LLM interpreta | `agent-stages.mjs`, `composer.mjs` | escolher argumento de chamada, decidir tenant, decidir autonomia |
| Os contratos decidem | `packages/contracts` | ser afrouxado para um teste passar |
| O código calcula | `capability-compilers.mjs`, `adapters/internal.mjs` | delegar ao modelo uma contagem |
| As ferramentas executam | `packages/gateway` | aplicar policy (já foi aplicada antes) |
| A evidência sustenta | receipts, `buildEvidence` | citar id que não existe no pacote |

## Invariantes — nenhum deles é negociável

- **Tenant nunca vem do input do usuário.** Os schemas de `IntentResolution` e
  `TaskPlan` *exigem* um campo `tenant`, ou seja, o modelo devolve um. Ele é
  sobrescrito pelo contexto confiável depois do parse. O schema obriga o campo a
  existir; nós obrigamos ele a estar certo.
- **Efeito externo só pelo Capability Gateway.** Sem exceção, sem atalho.
- **Policy só restringe.** Nenhuma linha de banco concede mais autonomia que o
  teto de risco da capability.
- **Não afrouxe invariante para o teste passar.** Se o teste e o invariante
  discordam, um dos dois está errado — descubra qual antes de mudar qualquer
  coisa.
- **Segredo nunca no banco de domínio.** `mkt.connections.secret_ref` guarda a
  referência; o adapter resolve no vault. Token de provider nunca entra em
  prompt, evidence ou trace.
- **Reason code novo entra só por PR** em `packages/contracts/enums/reason-codes.json`.
  O enum é fechado.
- **Nunca aplique nada no schema `mkt`** do projeto Supabase. O alvo é `mkt_v2`,
  sempre. `mkt` e `rh` têm dados que não são nossos. Ver `docs/HANDOFF.md` §3.

## O padrão de erro que mais custou aqui

Várias vezes neste projeto o problema não foi falta de teste — foi **falta de
alguém montar**. Código desenhado, testado contra dublê, e nunca executado de
verdade:

- A CI existia e nunca tinha rodado (disparava só em `main`, que estava vazia).
- `registerFunctions()` estava escrita e testada; ninguém a chamava.
- A porta de banco do worker existia **apenas nos testes**, com dublê completo.
- `adapters["internal"]` não existia no mapa — 9 das 12 capabilities caíam nele.
- `output_schema_ref` estava no registry desde a migration 0004 e nada o lia.

O dublê é o vilão recorrente: ele responde bonito para um caminho que ninguém
montou. Quando registramos um `createFakeMetaAdapter` no lugar do adapter
interno, ele não escondeu só aquele caminho — escondeu também a checagem que
julgava aquele caminho.

**Contramedidas que existem por causa disso, e que você não deve remover:**
`conferirSuperficie()` e `conferirPortasInternas()` derrubam o boot com o nome
do que falta; o `next build` e o `typecheck` estão na CI; os evals rodam contra
Postgres de verdade; e há teste comparando a lista do `capability_registry` com
a dos handlers.

## Antes de dizer que terminou

```bash
npm test              # 419 testes: contracts, policy, gateway, runtime, worker, web, db + typecheck
npm run gate:g0       # 10 critérios do Gate G0, executados
npm run gate:g1       # 10 critérios verificáveis do Gate G1
```

Os testes de banco precisam de Postgres: `export TEST_DATABASE_URL=...`. Sem
ele, os critérios que dependem de banco aparecem como não verificados — não como
aprovados.

**O gate G1 nunca se declara fechado sozinho.** Ele termina dizendo o que falta
e que não é código: um post real numa conta real, dependendo do app review da
Meta (ADR-0008). Um gate que mostra verde com critério faltando é pior que gate
nenhum, porque cria confiança sem lastro.

## Convenções

- JavaScript ESM, `node --test`, sem framework de teste externo.
- Comentário explica **por que**, não o quê. Se a decisão tem uma alternativa
  óbvia que foi recusada, escreva qual e por quê.
- Migration é imutável depois de aplicada. Corrigir é uma migration nova.
- Toda decisão de arquitetura vira ADR em `docs/adr/`. ADR registra decisão
  **tomada** — se ninguém decidiu, o status é `PROPOSTA`, não `ACEITA`.

## Mapa rápido

```
packages/contracts   schemas JSON + enums fechados + tipos TS gerados
packages/policy      policy engine determinístico, default deny
packages/gateway     Capability Gateway (8 passos) + adapters
packages/runtime     Model Gateway, agent loop, compiladores, retrieval, evals
packages/db          migrations, RLS, state machine em trigger
apps/worker          workflow durável de publicação, relay do outbox
apps/web             Next.js: telas e rotas de API
docs/adr             12 ADRs
docs/ROADMAP.md      o que falta, com a procedencia de cada item
docs/HANDOFF.md      estado, acessos e o que falta, por dono
```
