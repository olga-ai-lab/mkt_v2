/**
 * Entity Resolution — quem transforma "a Corretora Ipê" num id deixa de ser o
 * modelo.
 *
 * ── O buraco que este arquivo fecha ────────────────────────────────────────
 *
 * `olga://io/entity-resolution` existe desde a Fase 0, com métodos e reason
 * codes, e nada o implementava. Um `grep` pelo nome do contrato no código não
 * devolvia uma linha fora do próprio schema.
 *
 * Na prática, quem preenchia `canonical_id` era o LLM, dentro do
 * IntentResolution. Um modelo não tem como saber um uuid. Então ou ele devolvia
 * `null` — e todo pedido que nomeia uma marca morria em CLARIFICATION_REQUIRED
 * — ou ele inventava um, e a recusa que vinha depois era por acidente, quando
 * o SELECT não achava a linha. Recusar por acidente é recusar às vezes.
 *
 * Os evals não pegavam porque substituem `__BRAND__` pelo id real do fixture
 * antes de rodar. O caminho que eles aprovavam não era o que um cliente
 * percorre.
 *
 * ── A regra da Mestra §13, e o que ela custa ───────────────────────────────
 *
 * "Entity Resolution usa registry/aliases/IDs e não fuzzy matching irrestrito."
 *
 * Aqui só existe igualdade. Igualdade depois de normalizar caixa, acento e
 * espaço — que não é aproximação, é a mesma palavra escrita de outro jeito —
 * e igualdade contra um apelido que alguém registrou. Nenhum limiar, nenhuma
 * distância de edição, nenhum "o mais parecido".
 *
 * O custo é real e é o certo: "criar post para a Corretora Ipe Seguros" não
 * resolve se a marca está cadastrada como "Corretora Ipê". O sistema pergunta.
 * A alternativa — aceitar 0.87 de similaridade — é publicar no perfil do
 * cliente errado uma vez a cada tanto, e ninguém consegue dizer quanto é tanto.
 * Para o caso em que os dois nomes convivem, existe apelido: uma linha que
 * alguém escreveu, com autor e data.
 *
 * ── O que o modelo ainda diz, e o que isso vale ────────────────────────────
 *
 * `canonical_id` vindo do IntentResolution não é mais uma resposta: é um
 * PALPITE, e ele passa por verificação como qualquer entrada não confiável.
 *
 *   raw resolve                            -> vale o que o cadastro diz
 *   raw não resolve, palpite existe no tenant -> vale o palpite, banda MEDIUM
 *   raw não resolve, palpite não existe    -> NORMALIZATION_FAILED
 *
 * A primeira linha vale MESMO QUANDO o palpite discorda, e essa foi uma
 * escolha, não um esquecimento. Deixar o palpite VETAR uma resolução por nome
 * — virando a divergência em pergunta — seria dar ao modelo, na hora de
 * discordar, uma autoridade sobre identidade que acabamos de dizer que ele não
 * tem. Se a palavra dele não vale quando concorda, não passa a valer quando
 * discorda. O palpite só entra onde não há mais nada, e mesmo ali verificado.
 *
 * A divergência não se perde: ela vai para o trace (`loop.entities`), que é
 * onde sinal de confusão do modelo pertence. Um resolver por nome que diverge
 * com frequência é um prompt para consertar, e o dado para descobrir isso fica
 * gravado sem custar uma pergunta a quem está usando o produto.
 *
 * A terceira linha é o que sustenta pronome. "publica isso", "a marca", "esse
 * post" são pedidos legítimos, e o texto deles não resolve nada. Rejeitá-los
 * quebraria a conversa inteira; aceitá-los sem checar deixaria um uuid
 * alucinado virar destino. A trava que sobra é a única que importa: o id tem de
 * existir NESTA organização. O modelo pode errar de entidade; não pode
 * atravessar tenant.
 *
 * ── Ambiguidade é pergunta, não desempate ──────────────────────────────────
 *
 * Duas marcas com o mesmo nome normalizado devolvem AMBIGUOUS_ENTITY com as
 * duas candidatas. Escolher a mais recente, ou a primeira do índice, seria
 * decidir sobre algo que ninguém afirmou — e o `order by` de quem escreveu a
 * consulta viraria regra de negócio.
 *
 * `AMBIGUOUS_ENTITY` e `NORMALIZATION_FAILED` não se confundem, e a diferença
 * é o que a pessoa faz ao ler: ambíguo é "achei várias, qual delas?", e quem
 * recebe escolhe; normalização falha é "não achei nenhuma", e quem recebe
 * confere o nome.
 */

/**
 * Os tipos que TÊM identidade — e portanto passam por verificação.
 *
 * Um tipo fora desta lista não é resolvido nem reportado como resolvido: o
 * contrato exige `method`, e não existe método honesto para "não conferi".
 */
export const TIPOS_COM_ID = new Set(["brand", "content_version", "channel"]);

/**
 * Os tipos que são VALOR, e não referência.
 *
 * `objective` é texto livre que o compilador repassa; não há tabela contra a
 * qual conferi-lo, e exigir uma seria inventar um cadastro de objetivos para
 * ter o que checar.
 *
 * A lista existe para o que NÃO está em nenhuma das duas ser recusado. Um tipo
 * novo — `campaign`, `audience_segment` — cai no default e para o loop com
 * UNSUPPORTED_VALUE, em vez de atravessar sem verificação porque ninguém se
 * lembrou de adicioná-lo aqui. Fail-closed: o esquecimento vira erro visível,
 * não um id não conferido chegando ao compilador.
 */
export const TIPOS_DE_VALOR = new Set(["objective", "audience", "tone", "format"]);

const texto = (v) => String(v ?? "").trim();

/**
 * @param {{ entities: object }} deps
 *   `entities` é a porta de resolução: `byId`, `byNaturalKey` e `byAlias`.
 *   Nenhuma delas escolhe entre candidatos — `byNaturalKey` devolve a lista, e
 *   quem decide o que fazer com duas linhas é este arquivo.
 */
export function createEntityResolver({ entities } = {}) {
  if (!entities?.byId || !entities?.byNaturalKey || !entities?.byAlias) {
    throw new Error(
      "createEntityResolver exige a porta entities com byId, byNaturalKey e byAlias");
  }

  /**
   * Resolve UMA referência. Devolve `{ ok: true, ... }` ou `{ ok: false, reason_code }`.
   *
   * A ordem dos métodos é a da Mestra §13, do mais forte para o mais fraco:
   * o próprio id, o nome cadastrado, o apelido registrado. Só se nenhum dos
   * três disser nada o palpite do modelo entra — e mesmo aí, verificado.
   */
  async function resolverUma(org_id, entity_type, raw, palpite) {
    const t = texto(raw);
    const p = texto(palpite);

    // 1. O texto já é o id. Acontece quando a tela mandou o id no lugar do nome.
    if (t !== "") {
      const direto = await entities.byId(org_id, entity_type, t);
      if (direto) {
        return { ok: true, canonical_id: direto.id, label: direto.label,
                 method: "exact_id", confidence_band: "HIGH" };
      }
    }

    // 2. Nome cadastrado. A lista inteira, porque duas linhas é pergunta.
    if (t !== "") {
      const porNome = await entities.byNaturalKey(org_id, entity_type, t);
      const ids = [...new Set(porNome.map((c) => c.id))];
      if (ids.length > 1) {
        return { ok: false, reason_code: "AMBIGUOUS_ENTITY",
                 candidatas: porNome.slice(0, 5) };
      }
      if (ids.length === 1) {
        return { ok: true, canonical_id: porNome[0].id, label: porNome[0].label,
                 method: "unique_natural_key", confidence_band: "HIGH",
                 divergiu: p !== "" && p !== porNome[0].id };
      }

      // 3. Apelido registrado. Zero ou uma linha: o índice único garante.
      const apelido = await entities.byAlias(org_id, entity_type, t);
      if (apelido) {
        return { ok: true, canonical_id: apelido.id, label: apelido.label,
                 method: "alias", confidence_band: "HIGH",
                 divergiu: p !== "" && p !== apelido.id };
      }
    }

    // 4. O palpite do modelo, verificado contra o tenant.
    if (p !== "") {
      const conferido = await entities.byId(org_id, entity_type, p);
      if (!conferido) {
        // Um uuid que não existe aqui. Pode ser alucinação, pode ser um id de
        // outra organização — e as duas respostas são a mesma: não achei.
        // Dizer "isso é de outro tenant" confirmaria que ele existe.
        return { ok: false, reason_code: "NORMALIZATION_FAILED" };
      }
      // Ou não havia texto, ou ele não resolveu — é pronome ("a marca", "esse
      // post") ou nome errado com id certo. O id foi verificado, e nada além
      // dele foi provado: por isso MEDIUM, e não HIGH como nos três de cima.
      return { ok: true, canonical_id: conferido.id, label: conferido.label,
               method: "exact_id", confidence_band: "MEDIUM" };
    }

    return { ok: false, reason_code: "NORMALIZATION_FAILED" };
  }

  return {
    /**
     * Verifica todas as entidades de um IntentResolution.
     *
     * @param {{ trace_id: string, tenant: object, intent: object }} p
     * @returns {Promise<{ resolution: object, entities: Array, ok: boolean }>}
     *   `resolution` é o artefato `olga://io/entity-resolution`, que o trace
     *   guarda. `entities` é a lista VERIFICADA, no formato que o compilador
     *   consome — e é ela, não a do modelo, que segue no loop.
     *   `divergencias` são as referências em que o palpite do modelo apontava
     *   para outro id: não mudam a decisão, e existem para o trace.
     */
    async resolve({ trace_id, tenant, intent }) {
      const resolved = [];
      const unresolved = [];
      const verificadas = [];
      const divergencias = [];

      for (const e of intent?.entities ?? []) {
        const tipo = texto(e?.type);

        if (TIPOS_DE_VALOR.has(tipo)) {
          // Valor não tem id para conferir. Segue como veio, e NÃO entra em
          // `resolved`: dizer que foi resolvido por `exact_id` seria afirmar
          // uma verificação que não houve.
          verificadas.push({ type: tipo, canonical_id: e.canonical_id ?? null,
                             ...(e.raw == null ? {} : { raw: e.raw }) });
          continue;
        }

        if (!TIPOS_COM_ID.has(tipo)) {
          unresolved.push({ entity_type: tipo || "desconhecido",
                            ...(e?.raw == null ? {} : { raw: String(e.raw) }),
                            reason_code: "UNSUPPORTED_VALUE" });
          continue;
        }

        const r = await resolverUma(tenant.org_id, tipo, e.raw, e.canonical_id);
        if (!r.ok) {
          unresolved.push({ entity_type: tipo,
                            ...(e?.raw == null ? {} : { raw: String(e.raw) }),
                            reason_code: r.reason_code });
          continue;
        }
        resolved.push({ entity_type: tipo, canonical_id: r.canonical_id,
                        method: r.method, confidence_band: r.confidence_band });
        // Não cabe em `resolved` (o contrato fecha as propriedades), e não é
        // resposta: é sinal. Sai pelo trace, junto do resto.
        if (r.divergiu) divergencias.push({ entity_type: tipo, raw: e.raw ?? null,
                                            resolvido: r.canonical_id,
                                            palpite: String(e.canonical_id) });
        // `raw` continua sendo o que a pessoa escreveu, e não o rótulo do
        // banco: é o que a resposta cita de volta para ela reconhecer.
        verificadas.push({ type: tipo, canonical_id: r.canonical_id,
                           ...(e.raw == null ? {} : { raw: String(e.raw) }) });
      }

      const resolution = {
        trace_id,
        tenant: { org_id: tenant.org_id, workspace_id: tenant.workspace_id },
        resolved,
        ...(unresolved.length ? { unresolved } : {}),
      };
      return { resolution, entities: verificadas, divergencias,
               ok: unresolved.length === 0 };
    },
  };
}
