# AGT-BASE — Contrato comum de plataforma para todo agente Olga

> Fecha o achado **G5** do MKT-17. No MKT-09, a frase de arquitetura, o bloco
> de runtime, o de rollout e as cinco stories do pacote 06 aparecem **13 vezes
> idênticas** — uma por agente. Este documento carrega tudo isso uma vez. Cada
> agente passa a ter apenas o seu delta, e a divergência entre agentes fica
> visível em vez de escondida em texto repetido.

## Regra de precedência

O que vale para um agente é, nesta ordem: (1) este AGT-BASE, (2) o campo
`deviates_from_base` da sua `AgentDefinition`. Um agente que precisa divergir
declara a divergência ali — em uma linha, revisável. Nada de reescrever o pacote.

## 01 — Arquitetura (comum a todos)

| Aspecto | Contrato |
|---|---|
| Entrada | Trusted session context + refs canônicas de entidade + refs de objeto/versão + input do usuário ou evento |
| Knowledge slices | Apenas as fatias de ontologia, canônico, semântico, source e rule necessárias à tarefa |
| Authority | O LLM interpreta e propõe; a policy autoriza; o compiler constrói args; a capability executa |
| Tenant | `org_id` e `workspace_id` ligados fora do LLM e revalidados no servidor. Cross-tenant é fail closed |
| State | Estado de conversa e de tarefa é separado da verdade de domínio. Versão ACTIVE nunca é alterada por contexto conversacional |

## 03 — Runtime (comum a todos)

1. Resolver usuário ou evento para entidades canônicas e ambiguidades.
2. Recuperar contexto governado e o subconjunto de source e evidence.
3. Produzir saída tipada; validar schema **e** regra de negócio.
4. Passar pelo Respondability/Policy Gate **antes** de qualquer capability.
5. Compiler determinístico monta os args de qualquer execução física.
6. Validar resultado → montar EvidencePackage → explicação fundamentada → trace de auditoria.

**Retry**: apenas erro estrutural ou transitório classificado. Falha persistente
vai para estado seguro ou `HANDOFF_HUMAN`.

**Idempotência**: obrigatória para toda capability de escrita repetível. A chave
nunca é criada apenas a partir de texto livre do LLM — vem do
`idempotency_key_template` declarado no registry.

## 04 — Confiança e QA (comum a todos)

| Dimensão | Gate |
|---|---|
| Golden | Suíte por agente, definida no seu delta |
| Adversarial | Prompt injection pedindo bypass de policy; cross-tenant; tool output injection |
| Grounding | Claim material sem evidence = zero. Sempre |
| Security | Injection, cross-tenant, capability não autorizada, minimização de PII |
| Respondability | Casos de executável, clarify, unsupported, policy, quality e approval |
| Regression | Mudança de prompt, modelo, schema ou policy exige a suíte relacionada antes da promoção |

## 05 — Implementação e operação (comum a todos)

- **Registry**: `AgentDefinition` com id, versão, status, capabilities, policies, model profile e owner.
- **Trace**: agent e versão, modelo e prompt, versões de canônico/semântico/rule/source, reason codes, evidence, custo e latência.
- **Rollout**: offline → shadow → interno A1/A2 → piloto → A3 apenas se elegível. A4 só após o gate G3.
- **Rollback**: feature flag por agente e versão; voltar para a última ACTIVE preservando audit e receipts.
- **Incidente**: kill switch das capabilities de escrita; degradar para read/suggest quando for seguro.

## 06 — Definition of Done (comum a todos)

Nenhuma regra crítica apenas em prompt · schemas validados · tenant e policy
aplicados · escopo de capability estreito · evidence e grounding quando material ·
evals passando · trace reproduz a execução · rollback e kill switch existentes ·
docs e versões atualizados na mesma mudança.

## O que fica no delta de cada agente

Só isto, e nada mais:

1. **Charter** — missão, usuários, erro mais caro, modos, autonomia baseline e máxima.
2. **Contratos** — schemas primários, capabilities, reason codes, evidence.
3. **Casos de teste específicos** — golden e adversarial próprios do domínio.
4. **`deviates_from_base`** — lista explícita de onde este agente foge da base. Vazia significa que segue a base.

Os quatro agentes do MVP estão em `mkt.agent_registry`, semeados pela migration
`0006`. A definição é dado consultável, não prosa.
