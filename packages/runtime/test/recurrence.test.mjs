/**
 * A cadencia tem um caso de borda por tipo, e cada um merece um nome.
 *
 * Escrito em UTC de ponta a ponta: `at_hour_utc` diz o nome, e um teste que
 * usasse hora local passaria ou falharia conforme a maquina.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { proximaOcorrencia, RecurrenceError, CADENCIAS } from "../src/recurrence.mjs";

const em = (iso) => new Date(iso);
const iso = (d) => d.toISOString();

// 2026-09-09 e uma QUARTA-FEIRA (getUTCDay() === 3).
const QUARTA_10H = "2026-09-09T10:00:00.000Z";

test("DAILY antes da hora vence hoje", () => {
  assert.equal(iso(proximaOcorrencia({ cadence: "DAILY", at_hour_utc: 14 }, em(QUARTA_10H))),
    "2026-09-09T14:00:00.000Z");
});

test("DAILY depois da hora vence amanha", () => {
  assert.equal(iso(proximaOcorrencia({ cadence: "DAILY", at_hour_utc: 8 }, em(QUARTA_10H))),
    "2026-09-10T08:00:00.000Z");
});

test("rodar exatamente na hora do vencimento produz a PROXIMA, nunca a mesma", () => {
  // O caso que faria o agendador reprocessar o mesmo slot em laco enquanto
  // aquele minuto durasse. E por isso que a comparacao e `<=` e nao `<`.
  const agora = "2026-09-09T10:00:00.000Z";
  assert.equal(iso(proximaOcorrencia({ cadence: "DAILY", at_hour_utc: 10 }, em(agora))),
    "2026-09-10T10:00:00.000Z");
});

test("WEEKLY no mesmo dia, antes da hora, vence hoje", () => {
  // Quarta = 3.
  assert.equal(
    iso(proximaOcorrencia({ cadence: "WEEKLY", at_hour_utc: 15, at_weekday: 3 }, em(QUARTA_10H))),
    "2026-09-09T15:00:00.000Z");
});

test("WEEKLY no mesmo dia, hora ja passada, pula uma semana inteira", () => {
  assert.equal(
    iso(proximaOcorrencia({ cadence: "WEEKLY", at_hour_utc: 9, at_weekday: 3 }, em(QUARTA_10H))),
    "2026-09-16T09:00:00.000Z");
});

test("WEEKLY para um dia ja passado na semana vai para a semana seguinte", () => {
  // Segunda (1) vista de uma quarta: proxima segunda, 14/09.
  assert.equal(
    iso(proximaOcorrencia({ cadence: "WEEKLY", at_hour_utc: 9, at_weekday: 1 }, em(QUARTA_10H))),
    "2026-09-14T09:00:00.000Z");
});

test("MONTHLY antes do dia vence neste mes", () => {
  assert.equal(
    iso(proximaOcorrencia({ cadence: "MONTHLY", at_hour_utc: 9, at_monthday: 20 }, em(QUARTA_10H))),
    "2026-09-20T09:00:00.000Z");
});

test("MONTHLY depois do dia vence no mes seguinte", () => {
  assert.equal(
    iso(proximaOcorrencia({ cadence: "MONTHLY", at_hour_utc: 9, at_monthday: 2 }, em(QUARTA_10H))),
    "2026-10-02T09:00:00.000Z");
});

test("MONTHLY dia 28 existe em fevereiro, inclusive fora de bissexto", () => {
  // O motivo de a constraint parar em 28: um slot no dia 31 sumiria em
  // fevereiro, e "meu post de todo dia 31 nao saiu" e um bug que so aparece
  // em producao, em meses especificos.
  assert.equal(
    iso(proximaOcorrencia({ cadence: "MONTHLY", at_hour_utc: 9, at_monthday: 28 },
                          em("2027-02-01T00:00:00.000Z"))),
    "2027-02-28T09:00:00.000Z");
});

test("MONTHLY que vira o ano", () => {
  assert.equal(
    iso(proximaOcorrencia({ cadence: "MONTHLY", at_hour_utc: 9, at_monthday: 5 },
                          em("2026-12-31T23:00:00.000Z"))),
    "2027-01-05T09:00:00.000Z");
});

test("a ocorrencia e sempre estritamente futura, em qualquer cadencia", () => {
  // A propriedade que impede laco no agendador, verificada de uma vez em vez
  // de depender de eu ter lembrado de todos os casos acima.
  const agora = em(QUARTA_10H);
  const regras = [
    ...Array.from({ length: 24 }, (_, h) => ({ cadence: "DAILY", at_hour_utc: h })),
    ...Array.from({ length: 7 }, (_, d) => ({ cadence: "WEEKLY", at_hour_utc: 10, at_weekday: d })),
    ...Array.from({ length: 28 }, (_, i) => ({ cadence: "MONTHLY", at_hour_utc: 10, at_monthday: i + 1 })),
  ];
  for (const r of regras) {
    assert.ok(proximaOcorrencia(r, agora).getTime() > agora.getTime(),
      `${JSON.stringify(r)} produziu ocorrencia no passado ou no presente`);
  }
});

test("regra malformada e recusada, e nao vira uma data qualquer", () => {
  const ruins = [
    { cadence: "HOURLY", at_hour_utc: 9 },
    { cadence: "DAILY", at_hour_utc: 24 },
    { cadence: "DAILY", at_hour_utc: -1 },
    { cadence: "DAILY" },
    { cadence: "WEEKLY", at_hour_utc: 9 },
    { cadence: "WEEKLY", at_hour_utc: 9, at_weekday: 7 },
    { cadence: "MONTHLY", at_hour_utc: 9 },
    { cadence: "MONTHLY", at_hour_utc: 9, at_monthday: 31 },
    undefined,
  ];
  for (const r of ruins) {
    assert.throws(() => proximaOcorrencia(r, em(QUARTA_10H)),
      (e) => e instanceof RecurrenceError && e.reason_code === "SCHEMA_VALIDATION_FAILED",
      `${JSON.stringify(r)} deveria ser recusada`);
  }
});

test("as cadencias declaradas batem com as que a migration 0015 aceita", () => {
  assert.deepEqual(CADENCIAS, ["DAILY", "WEEKLY", "MONTHLY"]);
});
