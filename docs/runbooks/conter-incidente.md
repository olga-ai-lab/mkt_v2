# Runbook — conter um incidente

**Quando usar:** o agente fez algo que não devia, e você precisa que ele pare
**agora**. Post duplicado, texto errado no perfil de um cliente, claim que não
se sustenta no ar, suspeita de vazamento entre workspaces.

**Quem executa:** `OWNER` do workspace. Não é acidente que seja só ele — conter
é decisão com custo, e levantar também.

**Quanto demora:** uma chamada. A policy é lida a cada run, sem cache, então a
contenção vale no run seguinte. Não precisa de deploy, não precisa de migration.

---

## 1. Contenha primeiro. Investigue depois.

A ordem importa. Enquanto você lê logs, o agente continua rodando.

### Parar toda escrita do workspace

É o botão mais largo, e o certo quando você ainda não sabe o que aconteceu.
Leitura continua funcionando — o agente segue explicando o que já existe,
que é do que você precisa para investigar.

```bash
curl -X POST "$OLGA_URL/api/containment" \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"action":"kill_writes",
       "reason":"incidente 2026-08-27: post duplicado na conta do cliente X"}'
```

### Parar um agente

Quando você sabe qual agente é, e ele não pode nem ler.

```bash
-d '{"action":"kill_agent","agent_id":"AGT-MKT-CONTENT","reason":"..."}'
```

### Degradar um agente em vez de desligá-lo

Baixa o teto de autonomia para `A1`: o agente continua interpretando e
explicando, e não executa nada. É o que fazer quando o problema é o que ele
**faz**, não o que ele **diz**.

```bash
-d '{"action":"degrade_agent","agent_id":"AGT-MKT-CONTENT","reason":"..."}'
```

### Parar uma capability

Quando o problema é uma ação específica — o adapter de um provider, por
exemplo — e não o agente que a chamou.

```bash
-d '{"action":"kill_capability","capability_id":"publishing.publish","reason":"..."}'
```

> **O motivo é obrigatório e tem mínimo de 10 caracteres.** Não é burocracia:
> uma linha que bloqueia sem dizer por quê vira, duas semanas depois, uma linha
> que ninguém sabe se pode remover — e alguém remove.

---

## 2. Confira que parou

```bash
curl "$OLGA_URL/api/containment" -H "authorization: Bearer $TOKEN"
```

Devolve o que está contido, por quem e desde quando. Se a contenção que você
acabou de aplicar não estiver aí, ela não aconteceu.

No banco, a mesma resposta:

```sql
select policy_id, effect, scope, max_autonomy, reason, created_by, created_at
  from mkt.rule_policies
 where org_id = :org and status = 'ACTIVE' and created_by is not null
 order by created_at desc;
```

---

## 3. Investigue com o trace

Todo run deixa uma linha em `mkt.agent_runs` com as versões que valiam:

```sql
select trace_id, agent_id, agent_version, persona_version, prompt_version,
       model, respondability, reason_codes, cost_cents, started_at
  from mkt.agent_runs
 where org_id = :org and started_at > now() - interval '2 hours'
 order by started_at desc;
```

`persona_version` e `prompt_version` são o que permite reproduzir: elas dizem
com que persona e com que conjunto de prompts aquele run falou. Os textos do
conjunto estão em `packages/runtime/prompts.lock.json`, por versão.

O efeito externo, se houve, está em `mkt.action_receipts` — com provider,
`external_id` e `idempotency_key`.

---

## 4. Classifique (Mestra §34)

Conhecimento, dado, policy, LLM, compiler, tool, integração, segurança ou UX.

A classificação decide onde a correção vai: **corrija a fonte normativa, não o
prompt sintomático.** Se a regra estava errada, ela está numa migration ou num
contrato — não numa frase do prompt.

| Severidade | O que é | Resposta |
|---|---|---|
| S0 | cosmético | registrar |
| S1 | resposta subótima, sem risco material | corrigir + eval de regressão |
| S2 | resposta material incorreta, ou capability degradada | bloquear/rollback parcial |
| S3 | segurança, cross-tenant, ação indevida | **disable imediato** + este runbook |

---

## 5. Rollback, quando for versão

Se a causa foi uma versão nova de agente, volte para a última `ACTIVE`:

```sql
begin;
update mkt.agent_registry set status = 'DEPRECATED'
 where agent_id = :agente and version = :versao_ruim;
update mkt.agent_registry set status = 'ACTIVE'
 where agent_id = :agente and version = :versao_boa;
commit;
```

A porta serve a versão `ACTIVE` e usa a maior versão só como desempate — então
marcar a ruim como `DEPRECATED` basta para o rollback valer. Audit e receipts
ficam onde estão: rollback não apaga histórico.

O índice `agent_registry_one_active` recusa duas `ACTIVE` ao mesmo tempo, então
a transação acima falha em vez de deixar o sistema ambíguo.

---

## 6. Levante a contenção — com motivo

```bash
-d '{"action":"lift","policy_id":"KILL_ALL_WRITES",
     "reason":"causa corrigida na migration 00XX e post duplicado removido"}'
```

Levantar **não apaga** a policy: marca como `BLOCKED` e guarda o motivo. "Houve
contenção entre terça e quinta" é exatamente o que se pergunta depois.

`expires_at`, quando preenchido, **não** levanta nada sozinho. Uma contenção que
some por conta própria é uma contenção em que ninguém confia — o campo serve
para esta lista cobrar a revisão de você.

---

## 7. Antes de fechar

- [ ] Fonte normativa corrigida (migration, contrato ou policy — não o prompt).
- [ ] **Eval de regressão** que falharia se isto voltasse. Sem ele, o incidente
      volta e ninguém percebe até o cliente ver.
- [ ] ADR, se a correção mudou uma decisão de arquitetura.
- [ ] Contenção levantada, com motivo.
