-- =====================================================================
-- 0014_grants_marketing_profile.sql
--
-- 0012 criou marketing_profiles, prompt_templates e marketing_modules
-- com RLS e policy — mas RLS restringe LINHA, não decide se o papel pode
-- tentar a operacao. Sem GRANT de tabela, authenticated recebe
-- "permission denied" antes mesmo da policy ser avaliada, e a mensagem
-- não menciona RLS nem tenant: parece bug de infraestrutura.
--
-- As outras tabelas do schema nunca precisaram de GRANT explicito numa
-- migration porque saíram todas de uma configuracao unica, feita na
-- criacao do projeto Supabase (fora do controle de versao). As tres
-- tabelas desta migration nasceram depois, por migration comum, e essa
-- concessao original não as alcança — nenhuma migration daqui em diante
-- vai alcançar sozinha. Comparar contra `contents` (grava, mesmo padrao
-- de authenticated com SELECT+INSERT+UPDATE) e `agent_registry` (so
-- leitura, mesmo padrao de prompt_templates/marketing_modules) foi o
-- que revelou a lacuna: a tabela existia, a policy existia, e mesmo assim
-- nada conseguia gravar.
-- =====================================================================

-- marketing_profiles: o tenant escreve de verdade, como em contents/approvals.
grant select, insert, update on mkt.marketing_profiles to authenticated;

-- prompt_templates e marketing_modules: globais, so leitura para o tenant —
-- mesmo padrao de agent_registry/capability_registry. A escrita e so por
-- quem aplica migration (dono do schema), nunca pelo app.
grant select on mkt.prompt_templates to authenticated;
grant select on mkt.marketing_modules to authenticated;

-- service_role (usado por clienteAdmin() e por tudo que roda com bypass de
-- RLS) tinha privilegio total nas 30 tabelas originais da mesma configuracao
-- unica acima. As tres tabelas novas ficaram de fora dela tambem.
grant select, insert, update, delete, truncate, references, trigger
  on mkt.marketing_profiles, mkt.prompt_templates, mkt.marketing_modules
  to service_role;
