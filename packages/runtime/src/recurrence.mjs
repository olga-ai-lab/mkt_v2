/**
 * Quando o proximo slot vence.
 *
 * Funcao pura, e nao data aritmetica em SQL, porque isto tem um caso de borda
 * por cadencia e cada um merece um teste com nome. Numa expressao SQL eles
 * ficariam invisiveis ate alguem reclamar que o post nao saiu.
 *
 * ── Tudo em UTC, e isso e uma limitacao declarada ──────────────────────────
 *
 * `at_hour_utc` diz o nome. Uma corretora em Sao Paulo que queira publicar as
 * 9h precisa configurar 12. Fuso por workspace e trabalho de verdade —
 * horario de verao, mudanca de regra por pais — e entra quando alguem pedir,
 * com coluna propria. Fingir que a coluna e "hora local" sem ter fuso seria a
 * pior das opcoes: funcionaria por acidente para metade dos clientes.
 */

/** As cadencias que o produto oferece. Fechado de proposito — ver a 0015. */
export const CADENCIAS = ["DAILY", "WEEKLY", "MONTHLY"];

export class RecurrenceError extends Error {
  constructor(message) {
    super(message);
    this.reason_code = "SCHEMA_VALIDATION_FAILED";
  }
}

/**
 * @param {{ cadence: string, at_hour_utc: number,
 *           at_weekday?: number|null, at_monthday?: number|null }} regra
 * @param {Date|string|number} [depoisDe] instante a partir do qual procurar
 * @returns {Date} o proximo vencimento, sempre ESTRITAMENTE depois de `depoisDe`
 */
export function proximaOcorrencia(regra, depoisDe = Date.now()) {
  const { cadence, at_hour_utc, at_weekday, at_monthday } = regra ?? {};

  if (!CADENCIAS.includes(cadence)) {
    throw new RecurrenceError(`cadencia desconhecida: ${cadence}`);
  }
  if (!Number.isInteger(at_hour_utc) || at_hour_utc < 0 || at_hour_utc > 23) {
    throw new RecurrenceError(`at_hour_utc fora de 0..23: ${at_hour_utc}`);
  }

  const base = new Date(depoisDe);
  if (Number.isNaN(base.getTime())) throw new RecurrenceError("instante invalido");

  // Candidato: hoje, na hora pedida. Se ja passou, o laco avanca.
  const c = new Date(Date.UTC(
    base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), at_hour_utc, 0, 0, 0));

  if (cadence === "DAILY") {
    // `<=` e nao `<`: rodar exatamente na hora do vencimento tem de produzir a
    // ocorrencia de amanha. Com `<`, o agendador reprocessaria o mesmo slot em
    // laco enquanto aquele minuto durasse.
    if (c.getTime() <= base.getTime()) c.setUTCDate(c.getUTCDate() + 1);
    return c;
  }

  if (cadence === "WEEKLY") {
    if (!Number.isInteger(at_weekday) || at_weekday < 0 || at_weekday > 6) {
      throw new RecurrenceError(`WEEKLY exige at_weekday em 0..6, veio ${at_weekday}`);
    }
    let avanco = (at_weekday - c.getUTCDay() + 7) % 7;
    // Hoje e o dia, mas a hora ja passou: vai para a proxima semana.
    if (avanco === 0 && c.getTime() <= base.getTime()) avanco = 7;
    c.setUTCDate(c.getUTCDate() + avanco);
    return c;
  }

  if (!Number.isInteger(at_monthday) || at_monthday < 1 || at_monthday > 28) {
    throw new RecurrenceError(`MONTHLY exige at_monthday em 1..28, veio ${at_monthday}`);
  }
  // 1..28 sempre existe em todo mes, entao nao ha o buraco de fevereiro. E por
  // isso que a 0015 recusa 29, 30 e 31 na constraint em vez de "ajustar" para
  // o ultimo dia — ajustar mudaria a data sem avisar o cliente.
  c.setUTCDate(at_monthday);
  if (c.getTime() <= base.getTime()) {
    c.setUTCMonth(c.getUTCMonth() + 1);
    c.setUTCDate(at_monthday);
  }
  return c;
}
