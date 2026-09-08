-- =====================================================================
-- 0014_model_spend_capability.sql  |  Sob qual capability o dinheiro saiu.
--
-- `mkt.model_spend` registra gasto por run e por task class desde a 0007. Com
-- isso da para responder "quanto custou aquela execucao" e nao da para
-- responder "quanto custa gerar um post" — que e a pergunta que alguem faz
-- antes de mandar gerar quarenta.
--
-- Isto entra ANTES da geracao em lote de proposito. Um lote sem esta coluna
-- produz uma fatura que ninguem consegue decompor, e o pedido de decompor
-- chega depois de a fatura existir.
--
-- ── Nulo e informacao, e nao lacuna ─────────────────────────────────────
--
-- Tres chamadas de modelo por run nao acontecem sob capability nenhuma: o
-- resolver, o planner e o responder sao o loop pensando. Elas ficam com
-- capability_id nulo, e e assim que se separa "custo de pensar" de "custo de
-- produzir".
--
-- Por isso a coluna aceita nulo, e por isso ela NAO tem foreign key para
-- capability_registry: a chave la e (capability_id, version), e prender o
-- ledger de gasto a uma linha de registry impediria despublicar uma capability
-- sem antes reescrever o historico financeiro. Gasto registrado nao se
-- reescreve — a RLS desta tabela ja diz isso.
-- =====================================================================

alter table mkt.model_spend add column capability_id text;

comment on column mkt.model_spend.capability_id is
  'Sob qual capability o gasto aconteceu. Nulo para as chamadas do proprio loop (resolver, planner, responder), que nao rodam sob capability nenhuma — e essa distincao e o que separa custo de pensar de custo de produzir.';

-- A pergunta que a coluna existe para responder e sempre "quanto custou esta
-- capability neste workspace", entao o indice e por esse par.
create index on mkt.model_spend (workspace_id, capability_id, occurred_at desc);
