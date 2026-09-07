# ADR-0014 — Supabase Vault como o vault com escrita

- **Status:** ACEITA
- **Data:** 07/09/2026
- **Depende de:** ADR-0005 (segredos), ADR-0008 (primeiro canal)

## Contexto

O invariante do repositório é curto: *segredo nunca no banco de domínio*.
`mkt.connections.secret_ref` guarda a referência; o adapter resolve no vault.

Até aqui existia **uma** implementação dessa porta, `createEnvSecrets`, que lê
variável de ambiente. Ela resolve e não grava — e isso bastou enquanto o único
caminho previsto era um token colado à mão no deploy.

O consentimento no navegador (A3) quebra essa premissa. Um callback de OAuth
recebe o token da Meta **em tempo de execução**, e precisa guardá-lo em algum
lugar antes de gravar a conexão. Sem uma porta de escrita, a saída mais fácil
seria a pior: uma coluna nova em `mkt.connections`, e o invariante viraria uma
questão de disciplina em vez de estrutura.

## Decisão

**Supabase Vault** (`vault.create_secret`, `vault.update_secret`,
`vault.decrypted_secrets`), habilitado por `META_VAULT=supabase`.

O nome do segredo **é** o próprio `secret_ref` (`vault://meta/ig-<id>`). Não
existe tabela de-para: a referência guardada em `connections` é suficiente para
achar o segredo, e duas fontes que precisassem concordar um dia discordariam.

Três consequências fazem parte da decisão:

- **O padrão continua sendo o vault que não grava.** `createEnvSecrets` ganhou
  um `store()` que **recusa**, nomeando o motivo. Um vault escolhido por engano
  deve falhar ao conectar, não guardar o token no lugar errado.
- **A ordem no callback é vault primeiro, conexão depois.** Falha no meio deixa
  um segredo órfão — invisível e sem consequência. A ordem inversa deixaria uma
  conexão `ACTIVE` apontando para um segredo inexistente, e o sintoma apareceria
  na primeira publicação, longe da causa.
- **`revoke` devolve o `secret_ref` antigo** para que quem revoga possa apagar o
  segredo. A linha da conexão fica, marcada `REVOKED`: `publications` aponta para
  ela, e apagá-la levaria junto a resposta para "por onde aquele post saiu".

## Alternativas consideradas

**Coluna cifrada com `pgcrypto` no próprio schema.** Funciona e é menos peça
móvel, mas coloca o material cifrado no banco de domínio junto com a chave a um
`SELECT` de distância de quem tiver a role errada — que é exatamente o que o
invariante existe para evitar.

**Um secret manager externo (AWS/GCP).** Mais robusto e mais operação: uma
credencial nova, uma rede nova e um modo de falha novo, para um produto cujo
banco já é o Supabase. Revisar se o deploy sair do Supabase.

**Deixar o token só em variável de ambiente, com conexão manual.** É o estado
anterior. Não escala para além do primeiro cliente e transforma cada renovação
de token — a cada 60 dias, por conta — num deploy.

## O que esta decisão NÃO resolve

O Supabase Vault **não é exercido pelos testes**: `vault.create_secret` vem da
extensão `supabase_vault`, que não existe no Postgres da CI. O que está provado
é a forma das chamadas, contra um dublê de pool; que a extensão se comporta como
esperado depende de rodar contra o projeto Supabase. Isso está registrado como
um teste com nome próprio em `packages/runtime/test/secrets.test.mjs`, e não
como nota de rodapé.

## Ponto de revisão

Rever quando houver um segundo provider com OAuth (LinkedIn, Fase 3): se o
segundo trouxer requisito que o Vault não atenda — rotação automática, auditoria
de acesso ao segredo — a conversa sobre secret manager externo volta, e aí com
dois casos em vez de um.
