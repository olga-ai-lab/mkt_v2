-- =====================================================================
-- 0011_precheck_transiciona_ai_review.sql
--   quality.precheck passa a declarar o efeito interno que ele ja deveria ter.
--
-- ── O que estava travado ─────────────────────────────────────────────────
--
-- A state machine da J11 (0002_brand_content.sql) so deixa DRAFT sair para
-- AI_REVIEW ou CANCELLED. E `approval.request` exige AI_REVIEW ou adiante —
-- a propria porta recusa com CONTENT_NOT_APPROVED e diz "falta passar por
-- AI_REVIEW".
--
-- Ninguem fazia essa passagem. Consequencia, medida contra este banco: todo
-- conteudo que um agente cria fica preso em DRAFT para sempre. O caminho de
-- ponta a ponta do pipeline.test.mjs so andava porque o teste posicionava o
-- estado a mao, com um UPDATE. Um teste que prepara o estado que o produto
-- nao sabe alcancar prova o trecho depois dele, e esconde o trecho antes.
--
-- ── Por que a correcao e aqui, e nao no codigo ───────────────────────────
--
-- Porque a regra deste repositorio e que o registry decide e o codigo
-- calcula. `quality.precheck` estava declarada com side_effect 'none', e
-- capability que declara nao mudar estado nao pode mudar estado — se o
-- handler o fizesse assim mesmo, o registry e o codigo passariam a dizer
-- coisas diferentes sobre a mesma capability, que e a divergencia que o
-- AGT-BASE existe para impedir.
--
-- Entao a declaracao vem primeiro, e o handler depois.
--
-- ── O que NAO muda, e por que ────────────────────────────────────────────
--
-- `mode` continua 'simulate'. A tentacao era promove-lo a 'write', porque
-- agora ele escreve — e seria um erro: o gate que para o loop quando um
-- laudo reprova esta em agent-loop.mjs e e ligado ao MODO
--
--     if (cap.mode === "simulate" && saida.output?.valid === false)
--
-- Um precheck em modo 'write' deixaria de ser lido como laudo, e conteudo
-- com claim material sem lastro voltaria a seguir adiante em silencio. O
-- custo de mudar `mode` e maior que o incomodo de um 'simulate' que grava.
--
-- A leitura honesta das duas colunas: `mode` diz que ato e aquele do ponto
-- de vista do agente — ele simula, nao decide nada la fora. `side_effect`
-- diz se ha consequencia de estado — e ha uma, interna: registrar que a
-- revisao de IA aconteceu.
--
-- ── O que o handler faz com isso ─────────────────────────────────────────
--
-- Move DRAFT -> AI_REVIEW **somente quando o laudo passa**. Laudo com
-- reason code nao promove nada e continua parando o loop em QUALITY_BLOCKED.
-- Conteudo que ja saiu de DRAFT nao volta: revisao de IA reexecutada sobre
-- conteudo aprovado nao rebaixa o que um humano ja decidiu.
--
-- ── Para reverter ────────────────────────────────────────────────────────
--
--   update mkt.capability_registry set side_effect = 'none'
--    where capability_id = 'quality.precheck' and version = 1;
--
--   (e reverter markAiReviewed no adapter interno, senao o codigo passa a
--    escrever o que o registry nao declara)
-- =====================================================================

update mkt.capability_registry
   set side_effect = 'internal'
 where capability_id = 'quality.precheck'
   and version = 1;

-- A migration nao pode passar em silencio se a linha nao existir: seria uma
-- promessa de efeito sobre uma capability que ninguem serve.
do $$
begin
  if not exists (
    select 1 from mkt.capability_registry
     where capability_id = 'quality.precheck' and version = 1
       and side_effect = 'internal' and mode = 'simulate'
  ) then
    raise exception 'quality.precheck v1 nao ficou como simulate/internal. O adapter interno depende dessa declaracao.';
  end if;
end $$;

-- A constraint external_requires_idempotency continua valendo e nao e tocada:
-- 'internal' nao exige chave de idempotencia porque nao ha efeito la fora
-- para deduplicar. A repeticao aqui e um UPDATE para o mesmo estado.
