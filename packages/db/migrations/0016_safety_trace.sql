-- =====================================================================
-- 0016_safety_trace.sql  |  A linha Safety do trace, que nao existia.
--
-- ── O que a Mestra pede ─────────────────────────────────────────────────
--
-- §30 lista o que todo run tem de deixar registrado, e uma das linhas e
-- *Safety*: policy blocks, sinais de injecao e redacao de PII. As outras
-- linhas foram preenchidas na 0013 (Versions) e na 0007/0013 (Performance).
-- Esta ficou.
--
-- ── Por que isso nao e telemetria opcional ──────────────────────────────
--
-- A defesa contra injecao neste sistema e ESTRUTURAL: o texto do usuario entra
-- na sexta camada de contexto, nunca na de sistema, e os argumentos de toda
-- chamada nascem no compiler e nao no modelo. Isso e forte, e e a coisa certa.
--
-- Mas e silenciosa. Se um dia ela falhar, nada no banco diz que alguem tentou.
-- O `COPILOT-ADV-001` prova que uma injecao conhecida nao vira instrucao — e
-- prova isso em teste, uma vez, contra um texto que nos mesmos escrevemos.
-- Producao nao tem eval.
--
-- Entao entram tres colunas, e elas registram; nao bloqueiam. Um regex que
-- bloqueia e um regex que autoriza, e "o LLM interpreta, os contratos decidem"
-- vale tambem para as heuristicas: quem bloqueia e a policy, que e dado tipado
-- e revisavel.
--
-- ── PII: a 0012 declarou e ninguem aplicou ──────────────────────────────
--
-- `mkt.source_contracts.carries_pii` existe desde a 0012. O caveat do
-- UPLOADED_FILE diz, com todas as letras, "e a que recebe documento sem passar
-- por nenhum filtro nosso". A declaracao estava certa e o filtro nao existia:
-- o texto de uma evidence dessa fonte ia inteiro para o contexto do modelo.
--
-- `pii_redacted` conta o que foi apagado antes de o texto sair daqui. Zero e
-- diferente de nulo: zero diz "olhei e nao havia"; nulo diz "nao olhei".
--
-- ── A coluna que NAO entra, e por que ───────────────────────────────────
--
-- "Policy blocks" quase virou um contador aqui. Nao virou, e a razao vale mais
-- que a coluna: o loop PARA no primeiro bloqueio, entao o contador so poderia
-- valer 0 ou 1 — e `respondability = 'POLICY_BLOCKED'` ja diz exatamente isso,
-- na mesma linha. Seria a mesma verdade escrita duas vezes, que e o
-- anti-pattern do §47 e o jeito de um dia as duas discordarem.
--
-- O que a policy de fato NAO deixava no trace era QUAL regra decidiu.
-- `evaluate()` devolve `policy_versions` — policy_id e version de cada policy
-- aplicada —, o contrato RespondabilityResult exige o campo desde a Fase 0, e
-- nada nunca o gravou. Num incidente a pergunta e "que regra barrou isso, na
-- versao de qual dia", e ate aqui a resposta era re-derivar pelo escopo.
--
-- Isso tambem fecha a metade que faltava da §32 no trace: versoes de rules.
--
-- ── Para reverter ───────────────────────────────────────────────────────
--
--   alter table mkt.agent_runs
--     drop column policy_versions, drop column injection_signals,
--     drop column pii_redacted;
-- =====================================================================

alter table mkt.agent_runs
  add column policy_versions   jsonb,
  add column injection_signals text[],
  add column pii_redacted      integer;

comment on column mkt.agent_runs.policy_versions is
  'Qual regra decidiu este run, e em que versao: [{policy_id, version}]. Vem do `policy_versions` que evaluate() ja devolvia e que ninguem gravava. Nulo = o run parou antes de haver passo para avaliar; array vazio = avaliou e nenhuma policy casou (leitura segue sem policy explicita; escrita nesse caso e NO_ACTIVE_POLICY). A diferenca importa: um run que nunca chegou a policy nao e um run que a policy aprovou.';

comment on column mkt.agent_runs.injection_signals is
  'Padroes de tentativa de injecao encontrados no texto NAO confiavel deste run. Registra, nao bloqueia: um regex que bloqueia e um regex que autoriza, e quem autoriza aqui e a policy. Serve para responder "isso ja tinha acontecido antes?" depois de um incidente — pergunta que hoje nao tem resposta.';

comment on column mkt.agent_runs.pii_redacted is
  'Quantos trechos de PII foram apagados antes de o texto entrar no contexto do modelo. Zero e diferente de nulo: zero diz "olhei e nao havia", nulo diz "nao olhei".';

-- "Isso ja tinha acontecido antes?" respondida por indice, e nao por scan da
-- tabela inteira de runs.
create index agent_runs_sinais
  on mkt.agent_runs (org_id, started_at desc)
  where injection_signals is not null and cardinality(injection_signals) > 0;

do $$
declare n integer;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'mkt' and table_name = 'agent_runs'
     and column_name in ('policy_versions','injection_signals','pii_redacted');
  if n <> 3 then
    raise exception 'a linha Safety do trace nao ficou completa (% de 3 colunas)', n;
  end if;
end $$;
