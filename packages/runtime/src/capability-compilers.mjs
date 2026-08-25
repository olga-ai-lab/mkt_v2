/**
 * Compiladores das capabilities da Fase 1.
 *
 * O MKT-17 nomeia três para a Fase 1: content.create_draft, approval.request
 * e publishing.publish. São elas que ganham compilador aqui.
 *
 * ── O que um compilador é ──────────────────────────────────────────────────
 *
 * Código determinístico que transforma entidades JÁ RESOLVIDAS para ID
 * canônico, mais o contexto confiável da sessão, nos argumentos reais de uma
 * chamada. Nada aqui lê texto do modelo. O plano trouxe `args_summary`, que é
 * prosa para uma pessoa ler; os argumentos nascem neste arquivo.
 *
 * ── Por que publicar consulta o banco ──────────────────────────────────────
 *
 * Para publicar são necessários `connection_id` e `channel_variant_id`. Nenhum
 * dos dois é escolha de quem pediu: são consequência do conteúdo e do canal.
 * Se viessem do modelo, o modelo escolheria em qual conta publicar — e um
 * `connection_id` trocado é um post no perfil do cliente errado.
 *
 * Por isso o compilador resolve os dois a partir de (content_version, canal),
 * e falha quando não existe destino, em vez de completar com o que estiver à
 * mão.
 *
 * ── Entidade faltando é pergunta, não improviso ────────────────────────────
 *
 * Todo builder que não encontra a entidade de que precisa lança
 * AMBIGUOUS_ENTITY. O loop transforma isso em CLARIFICATION_REQUIRED e
 * pergunta. A alternativa — assumir um default — seria decidir sobre algo que
 * ninguém afirmou.
 */

export class CompileError extends Error {
  constructor(reason_code, message) {
    super(message);
    this.reason_code = reason_code;
  }
}

/**
 * Primeira entidade de um tipo, já resolvida para id canônico.
 *
 * Dois motivos diferentes para falhar, e eles não se confundem:
 *
 *   nenhuma entidade daquele tipo   -> NORMALIZATION_FAILED  ("não achei")
 *   existe, mas sem id canônico     -> NORMALIZATION_FAILED  ("achei o texto,
 *                                       não achei o registro")
 *   existe mais de uma candidata    -> AMBIGUOUS_ENTITY      ("qual delas?")
 */
function exigirEntidade(entities, tipo, oQueE) {
  const candidatas = (entities ?? []).filter((e) => e.type === tipo);
  const resolvidas = candidatas.filter((e) => e.canonical_id != null);

  if (resolvidas.length > 1) {
    const ids = [...new Set(resolvidas.map((e) => e.canonical_id))];
    if (ids.length > 1) {
      throw new CompileError("AMBIGUOUS_ENTITY", `mais de um ${oQueE} foi indicado`);
    }
  }
  if (resolvidas.length === 0) {
    throw new CompileError("NORMALIZATION_FAILED", `não encontrei o ${oQueE} indicado`);
  }
  return resolvidas[0].canonical_id;
}

/** Valor simples de uma entidade (canal, por exemplo), sem exigir uuid. */
function valorEntidade(entities, tipo) {
  const achada = (entities ?? []).find((e) => e.type === tipo);
  return achada?.canonical_id ?? achada?.raw ?? null;
}

/**
 * @param {{ publishing: { findDestination: Function } }} ports
 *   Só a porta de destino é exigida: as outras duas capabilities da Fase 1 são
 *   internas e se resolvem com entidades e contexto.
 */
export function createPhase1Compilers({ publishing } = {}) {
  return {
    /**
     * Rascunho de conteúdo. O texto em si é gerado depois, pela capability;
     * o que se compila aqui é o alvo: qual marca, qual objetivo, qual canal.
     */
    "content.create_draft": ({ entities, context, tenant }) => {
      const brand_id = exigirEntidade(entities, "brand", "marca");
      return {
        brand_id,
        workspace_id: tenant.workspace_id,
        channel: valorEntidade(entities, "channel"),
        objective: valorEntidade(entities, "objective"),
        brand_brain_version_id: context?.brand_brain_version_id ?? null,
      };
    },

    /**
     * Pedido de aprovação. Os reason codes vêm da policy que exigiu a
     * aprovação — não de quem está pedindo, e muito menos do modelo: são eles
     * que decidem se o conteúdo vai para revisão de compliance ou para a fila
     * humana comum.
     */
    "approval.request": ({ entities, context }) => ({
      content_version_id: exigirEntidade(entities, "content_version", "conteúdo"),
      reason_codes: context?.reason_codes ?? [],
    }),

    /**
     * Publicação. Consulta o destino em vez de aceitá-lo.
     */
    "publishing.publish": async ({ entities, tenant }) => {
      if (!publishing?.findDestination) {
        throw new CompileError("SCHEMA_VALIDATION_FAILED",
          "compilador de publicação exige a porta publishing.findDestination");
      }
      const content_version_id = exigirEntidade(entities, "content_version", "conteúdo");
      const channel = valorEntidade(entities, "channel");
      if (!channel) throw new CompileError("AMBIGUOUS_ENTITY", "não sei em qual canal publicar");

      const destino = await publishing.findDestination(
        tenant.org_id, tenant.workspace_id, content_version_id, channel);

      if (!destino) {
        // Duas causas possíveis, e as duas são do operador resolver: não há
        // variante para o canal, ou não há conexão ativa nele. Recusar aqui é
        // melhor que deixar a policy bloquear depois com menos informação.
        throw new CompileError("CHANNEL_NOT_CONNECTED",
          `sem destino para publicar em ${channel}: falta variante de canal ou conexão ativa`);
      }

      return {
        channel,
        content_version_id,
        connection_id: destino.connection_id,
        channel_variant_id: destino.channel_variant_id,
      };
    },
  };
}

/**
 * Compiladores das capabilities de LEITURA.
 *
 * O MKT-17 nomeia três capabilities para a Fase 1, e as três são de escrita.
 * Mas dois dos quatro agentes — COPILOT e COMPLIANCE — só têm capabilities de
 * leitura no charter. Sem compilador para elas, os dois seriam agentes que
 * recusam tudo: todo plano cairia em "sem compilador".
 *
 * Elas são separadas das de escrita de propósito. Leitura não produz efeito
 * externo, não emite receipt e não consome idempotência — juntar as duas
 * famílias num mapa só faria parecer que carregam o mesmo risco.
 */
export function createReadCompilers() {
  return {
    "brand.read": ({ entities, tenant }) => ({
      brand_id: exigirEntidade(entities, "brand", "marca"),
      workspace_id: tenant.workspace_id,
    }),

    "evidence.read": ({ entities, tenant }) => ({
      content_version_id: exigirEntidade(entities, "content_version", "conteúdo"),
      workspace_id: tenant.workspace_id,
    }),

    "quality.precheck": ({ entities }) => ({
      content_version_id: exigirEntidade(entities, "content_version", "conteúdo"),
    }),

    "compliance.review": ({ entities }) => ({
      content_version_id: exigirEntidade(entities, "content_version", "conteúdo"),
    }),
  };
}

/** Escrita da Fase 1 mais leitura. É este o mapa que a aplicação monta. */
export function createAllCompilers(ports = {}) {
  return { ...createReadCompilers(), ...createPhase1Compilers(ports) };
}
