/**
 * A traducao das sete camadas de contexto para o corpo da API da Anthropic.
 *
 * Fica em .mjs, e nao dentro do adapter .ts, pelo mesmo motivo de session.mjs:
 * decisao em modulo testavel, adapter fino em cima. E aqui a decisao nao era
 * pequena — era um bug que fazia o agente pensar sem o proprio charter.
 *
 * ── O que quebrou, e por que ninguem viu ──────────────────────────────────
 *
 * assembleContext() monta TRES mensagens com papel "system", nesta ordem:
 * as regras (system), a persona do agente (persona) e o contrato de saida
 * (schemas). O adapter fazia:
 *
 *     system:   messages.find(m => m.role === "system")?.content
 *     messages: messages.filter(m => m.role !== "system")
 *
 * `find` devolve a PRIMEIRA. O `filter` descarta as outras duas. Ou seja, em
 * producao a persona — missao, capabilities, erro mais caro, politica de
 * incerteza, reason codes permitidos — e a instrucao "responda no contrato
 * olga://io/task-plan" nunca chegavam ao modelo.
 *
 * Nao havia teste porque nao havia modulo: a transformacao morava dentro de um
 * adapter que nenhum teste importa. E os evals nao pegam porque o provider
 * roteirizado le TODAS as mensagens para descobrir qual ponta esta chamando —
 * o duble via o que o modelo real nao via.
 *
 * ── Por que juntar, e nao mandar tres blocos de sistema ───────────────────
 *
 * A API aceita `system` como lista de blocos, e seria possivel mandar as tres
 * camadas separadas. Juntar foi a escolha por uma razao: a ordem das sete
 * camadas e o que sustenta a defesa contra injecao (Mestra §11), e um unico
 * texto na ordem declarada preserva isso sem depender de como o provider
 * ordena blocos. Se um dia a separacao render cache por bloco, a mudanca e
 * aqui, com teste, e nao no handler.
 */

/** Separador entre camadas de sistema. Duas quebras: o modelo le como blocos. */
const SEPARADOR = "\n\n";

/**
 * @param {Array<{role: string, content: string}>} messages
 *   as mensagens montadas por assembleContext, na ordem das sete camadas
 * @returns {{ system: string|undefined, messages: Array<{role: string, content: string}> }}
 */
export function toAnthropicPayload(messages = []) {
  const sistema = [];
  const turnos = [];

  for (const m of messages) {
    if (m?.content == null || m.content === "") continue;
    const content = String(m.content);
    if (m.role === "system") sistema.push(content);
    else turnos.push({ role: m.role, content });
  }

  if (turnos.length === 0) {
    // A API recusa um pedido sem turno de usuario, e recusar aqui diz o que
    // aconteceu. Mandar assim mesmo devolveria um 400 que parece falha de
    // provider — e mandaria alguem procurar rede onde o problema e montagem.
    const e = new Error("nenhuma camada de usuario: o pedido so tem sistema");
    e.reason_code = "SCHEMA_VALIDATION_FAILED";
    throw e;
  }

  return {
    system: sistema.length ? sistema.join(SEPARADOR) : undefined,
    messages: turnos,
  };
}
