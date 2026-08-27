/**
 * Entity Resolution sem banco: as decisões, isoladas da consulta.
 *
 * O teste contra Postgres (packages/db/test/entity-resolution.test.mjs) prova
 * que as consultas encontram o que existe. Este prova o que se faz com o que
 * foi encontrado — e as duas perguntas são diferentes: um SELECT correto com
 * um desempate errado publica na marca errada com o banco impecável.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createEntityResolver } from "../src/entity-resolver.mjs";
import { assertValid } from "@olga/contracts";

const ORG = "11111111-1111-4111-8111-111111111111";
const WS = "22222222-2222-4222-8222-222222222222";
const IPE = "33333333-3333-4333-8333-333333333333";
const OUTRA = "44444444-4444-4444-8444-444444444444";
const tenant = { org_id: ORG, workspace_id: WS };

/**
 * Uma porta de mentira com um cadastro de mentira — e a mesma disciplina do
 * de verdade: comparação normalizada, e a lista inteira quando há mais de um.
 */
function porta({ marcas = [], apelidos = {} } = {}) {
  const norm = (t) => String(t ?? "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();
  const chamadas = [];
  return {
    chamadas,
    async byId(org_id, tipo, id) {
      chamadas.push(["byId", tipo, id, org_id]);
      if (org_id !== ORG) return null;
      const m = marcas.find((x) => x.id === id);
      return m ? { id: m.id, label: m.name } : null;
    },
    async byNaturalKey(org_id, tipo, raw) {
      chamadas.push(["byNaturalKey", tipo, raw, org_id]);
      return marcas.filter((x) => norm(x.name) === norm(raw))
        .map((x) => ({ id: x.id, label: x.name }));
    },
    async byAlias(org_id, tipo, raw) {
      chamadas.push(["byAlias", tipo, raw, org_id]);
      const id = apelidos[norm(raw)];
      return id ? { id, label: raw } : null;
    },
  };
}

const CADASTRO = {
  marcas: [{ id: IPE, name: "Corretora Ipê Seguros" },
           { id: OUTRA, name: "Outra Marca" }],
  apelidos: { ci: IPE },
};

const resolver = (p) => createEntityResolver({ entities: p });
const intent = (...entities) => ({ intent: "EXPLAIN", entities });
const rodar = (p, ...ents) =>
  resolver(p).resolve({ trace_id: "tr", tenant, intent: intent(...ents) });

// ── Os três métodos, e o que cada um significa ──────────────────────────────

test("nome cadastrado resolve, e o acento nao atrapalha", async () => {
  // Normalizar só de um lado é o jeito de nunca encontrar nada: quem digita
  // "Ipe" está escrevendo a mesma palavra que "Ipê", e igualdade depois de
  // normalizar não é aproximação.
  const r = await rodar(porta(CADASTRO),
    { type: "brand", canonical_id: null, raw: "corretora ipe seguros" });

  assert.equal(r.ok, true);
  assert.deepEqual(r.resolution.resolved, [{
    entity_type: "brand", canonical_id: IPE,
    method: "unique_natural_key", confidence_band: "HIGH" }]);
  assertValid("olga://io/entity-resolution", r.resolution);
});

test("o texto que ja e o id resolve por exact_id, sem consultar nome", async () => {
  const p = porta(CADASTRO);
  const r = await rodar(p, { type: "brand", canonical_id: null, raw: IPE });

  assert.equal(r.resolution.resolved[0].method, "exact_id");
  assert.ok(!p.chamadas.some((c) => c[0] === "byNaturalKey"),
    "achou pelo id; procurar pelo nome depois disso seria consulta a toa");
});

test("apelido registrado resolve, e e o unico caminho que nao e igualdade de nome", async () => {
  const r = await rodar(porta(CADASTRO), { type: "brand", canonical_id: null, raw: "CI" });
  assert.equal(r.resolution.resolved[0].canonical_id, IPE);
  assert.equal(r.resolution.resolved[0].method, "alias");
});

test("parecido nao resolve: fuzzy continua proibido", async () => {
  // "Ipe Seguros" não é "Corretora Ipê Seguros". A distância entre os dois é
  // pequena, e é exatamente por isso que aceitar seria perigoso: um limiar que
  // aceita este aceita o próximo, e ninguém consegue dizer qual é o próximo.
  const r = await rodar(porta(CADASTRO), { type: "brand", canonical_id: null, raw: "Ipe Seguros" });
  assert.equal(r.ok, false);
  assert.equal(r.resolution.unresolved[0].reason_code, "NORMALIZATION_FAILED");
});

// ── Ambiguidade é pergunta ──────────────────────────────────────────────────

test("dois com o mesmo nome viram AMBIGUOUS_ENTITY, e nada e escolhido", async () => {
  const p = porta({ marcas: [{ id: IPE, name: "Duplo" }, { id: OUTRA, name: "duplo" }] });
  const r = await rodar(p, { type: "brand", canonical_id: null, raw: "Duplo" });

  assert.equal(r.ok, false);
  assert.equal(r.resolution.unresolved[0].reason_code, "AMBIGUOUS_ENTITY");
  assert.deepEqual(r.resolution.resolved, []);
  assert.deepEqual(r.entities, [], "nada resolvido nao pode chegar ao compilador");
});

test("homonimo nao cai para apelido: escolher continua sendo escolher", async () => {
  const p = porta({ marcas: [{ id: IPE, name: "Duplo" }, { id: OUTRA, name: "Duplo" }],
                    apelidos: { duplo: IPE } });
  const r = await rodar(p, { type: "brand", canonical_id: null, raw: "Duplo" });

  assert.equal(r.resolution.unresolved[0].reason_code, "AMBIGUOUS_ENTITY");
  assert.ok(!p.chamadas.some((c) => c[0] === "byAlias"),
    "usar o apelido como desempate seria decidir o que ninguem afirmou");
});

test("ambiguo e nao-achei sao codigos diferentes porque pedem coisas diferentes", async () => {
  // Ambíguo: quem recebe escolhe. Não achei: quem recebe confere o nome.
  // Trocar um pelo outro manda a pessoa fazer a coisa errada.
  const p = porta({ marcas: [{ id: IPE, name: "Duplo" }, { id: OUTRA, name: "Duplo" }] });
  const r = await rodar(p,
    { type: "brand", canonical_id: null, raw: "Duplo" },
    { type: "content_version", canonical_id: null, raw: "post que nao existe" });

  assert.deepEqual(r.resolution.unresolved.map((u) => u.reason_code),
                   ["AMBIGUOUS_ENTITY", "NORMALIZATION_FAILED"]);
});

// ── O palpite do modelo ─────────────────────────────────────────────────────

test("uuid inventado nao vira alvo: o palpite passa por verificacao", async () => {
  // O defeito que este arquivo existe para fechar. Antes, `canonical_id`
  // não-nulo bastava, e a recusa vinha por acidente — quando vinha.
  const r = await rodar(porta(CADASTRO),
    { type: "brand", canonical_id: "99999999-9999-4999-8999-999999999999", raw: "a marca" });

  assert.equal(r.ok, false);
  assert.equal(r.resolution.unresolved[0].reason_code, "NORMALIZATION_FAILED");
});

test("pronome com id verificado passa, em banda MEDIUM", async () => {
  // "a marca", "esse post": pedidos legítimos cujo texto não resolve nada.
  // Rejeitá-los quebraria a conversa; aceitá-los sem checar deixaria um uuid
  // alucinado virar destino. O id existe neste tenant, e nada além disso foi
  // provado — daí MEDIUM.
  const r = await rodar(porta(CADASTRO), { type: "brand", canonical_id: IPE, raw: "a marca" });

  assert.equal(r.ok, true);
  assert.equal(r.resolution.resolved[0].confidence_band, "MEDIUM");
  assert.equal(r.entities[0].canonical_id, IPE);
});

test("o palpite nao redireciona um nome que o cadastro resolve", async () => {
  const r = await rodar(porta(CADASTRO),
    { type: "brand", canonical_id: OUTRA, raw: "Corretora Ipe Seguros" });

  assert.equal(r.resolution.resolved[0].canonical_id, IPE);
  assert.equal(r.resolution.resolved[0].method, "unique_natural_key");
});

test("a divergencia nao se perde: sai no trace", async () => {
  const r = await rodar(porta(CADASTRO),
    { type: "brand", canonical_id: OUTRA, raw: "Corretora Ipe Seguros" });

  assert.deepEqual(r.divergencias, [{ entity_type: "brand", raw: "Corretora Ipe Seguros",
                                      resolvido: IPE, palpite: OUTRA }]);
});

test("palpite que confere nao vira divergencia", async () => {
  const r = await rodar(porta(CADASTRO),
    { type: "brand", canonical_id: IPE, raw: "Corretora Ipê Seguros" });
  assert.deepEqual(r.divergencias, []);
});

// ── Tipos ───────────────────────────────────────────────────────────────────

test("valor passa sem ser verificado, e sem fingir que foi", async () => {
  // `objective` é texto livre: não há tabela contra a qual conferi-lo, e
  // declará-lo em `resolved` afirmaria um método que não houve.
  const r = await rodar(porta(CADASTRO),
    { type: "objective", canonical_id: "AWARENESS", raw: "awareness" });

  assert.equal(r.ok, true);
  assert.deepEqual(r.resolution.resolved, []);
  assert.equal(r.entities[0].canonical_id, "AWARENESS");
});

test("tipo desconhecido para o loop em vez de atravessar sem verificacao", async () => {
  // Fail-closed. `connection` é o caso perigoso — connection_id é em qual
  // conta se publica —, e um tipo novo que ninguem lembrou de classificar tem
  // de virar erro visivel, e nao um id nao conferido chegando ao compilador.
  const r = await rodar(porta(CADASTRO),
    { type: "connection", canonical_id: OUTRA, raw: "a conta da outra corretora" });

  assert.equal(r.ok, false);
  assert.equal(r.resolution.unresolved[0].reason_code, "UNSUPPORTED_VALUE");
  assert.deepEqual(r.entities, []);
});

test("o tenant sai do contexto confiavel, e nao do que foi pedido", async () => {
  const p = porta(CADASTRO);
  const r = await resolver(p).resolve({
    trace_id: "tr", tenant,
    intent: { intent: "EXPLAIN", tenant: { org_id: "outro", workspace_id: "outro" },
              entities: [{ type: "brand", canonical_id: null, raw: "Outra Marca" }] } });

  assert.deepEqual(r.resolution.tenant, { org_id: ORG, workspace_id: WS });
  // O que importa não é só o que o artefato declara: é contra qual organização
  // a consulta rodou. Um tenant vindo do corpo do pedido é como uma resolução
  // atravessa workspace, e isso é S3 na tabela de severidade da Mestra §B.
  assert.ok(p.chamadas.length > 0);
  assert.ok(p.chamadas.every((c) => c[3] === ORG),
    "toda consulta de resolucao e escopada pela organizacao do contexto confiavel");
  assertValid("olga://io/entity-resolution", r.resolution);
});

test("sem entidade nenhuma, resolve vazio e segue", async () => {
  const r = await rodar(porta(CADASTRO));
  assert.equal(r.ok, true);
  assert.deepEqual(r.resolution.resolved, []);
  assert.equal(r.resolution.unresolved, undefined);
});

test("montar sem a porta falha no boot, e nao no primeiro pedido", async () => {
  assert.throws(() => createEntityResolver({}), /entities/);
  assert.throws(() => createEntityResolver({ entities: { byId: () => {} } }), /entities/);
});
