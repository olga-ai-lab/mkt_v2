# Gate G0 — Fundação

> Critério do MKT-17: *CI verde; dois tenants criados; leitura cruzada falha no
> teste; tipos gerados a partir dos schemas; app submetido na Meta.*

Um gate não é um documento aprovado. É comportamento observável. Abaixo, o que
foi verificado e como reproduzir.

## Situação

| Critério | Status | Como verificar |
|---|---|---|
| Contratos machine-readable, com CI que quebra em divergência | ✅ | `npm run test:contracts` — 15 testes |
| Policy engine determinístico com default deny | ✅ | `npm run test:policy` — 19 testes |
| Capability Gateway com os 8 passos do MKT-09B §10 | ✅ | `npm run test:gateway` — 19 testes |
| Migrations aplicam limpo | ✅ | `npm run db:migrate:local` |
| **Isolamento cross-tenant provado** | ✅ | `npm run test:rls` — 18 testes |
| Tipos TS gerados a partir dos schemas | ✅ | `npm run contracts:generate` |
| App submetido na Meta | ⛔ **pendente** | Caminho crítico. Ver ADR-0008 |

## O que os testes de RLS realmente provam

Não verificam que "a RLS está ligada". Eles criam duas corretoras reais, com
usuários reais, conectam como um papel de aplicação que **não** ignora RLS — o
primeiro teste falha de propósito se o papel for superusuário — e então tentam:

- ler a marca do outro tenant pelo id → 0 linhas
- inserir na org do outro tenant → erro 42501
- alterar linha do outro tenant → 0 linhas afetadas
- apagar linha do outro tenant → 0 linhas afetadas

E verificam invariantes que não são de acesso:

- `DRAFT → PUBLISHED` é recusado pelo banco, não só pela aplicação
- editar o corpo depois de aprovado derruba a aprovação automaticamente
- claim material sem evidence viola constraint
- capability de efeito externo sem idempotência viola constraint
- a mesma `idempotency_key` não entra duas vezes
- auditoria e receipts são append-only para a aplicação

## Dois bugs que os testes pegaram

Vale registrar, porque são o tipo de coisa que passa despercebida em revisão:

1. **`RULE ... DO INSTEAD NOTHING` quebra integridade referencial.** A primeira
   versão implementava append-only da auditoria com RULE. O cascade de
   `organizations` passou a falhar com *"referential integrity query gave
   unexpected result"*. Substituído por RLS com policies apenas de SELECT e
   INSERT — a aplicação não altera nem apaga, e o cascade administrativo
   continua funcionando.

2. **`array_length('{}', 1)` devolve NULL, e um CHECK que resolve para NULL
   passa.** A constraint que deveria exigir evidence para claim material era
   decorativa: aceitava array vazio. Corrigida para `cardinality()`.

Uma constraint que silenciosamente não verifica nada é pior que constraint
nenhuma — ela produz confiança injustificada.

## Reproduzir do zero

```bash
npm install
npm run contracts:generate

# Postgres local para os testes de RLS
createdb olga_test
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/olga_test
npm run db:migrate:local
npm test
```
