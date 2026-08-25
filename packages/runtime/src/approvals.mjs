/**
 * Aprovacao (T4).
 *
 * A regra do MKT-04-05 §6.2 e uma frase curta com consequencia longa:
 * **a decisao e vinculada a versao do conteudo, nao ao conteudo.**
 *
 * O banco ja faz a sua parte. O trigger mkt.invalidate_approval_on_edit()
 * derruba `state` para DRAFT e zera `approved_at` quando o corpo muda depois
 * de aprovado. A tela e esta camada NAO reimplementam isso — elas leem o
 * efeito e recusam publicar. Reimplementar seria criar um segundo lugar onde
 * a mesma regra pode divergir.
 *
 * O que esta camada acrescenta e o que o trigger nao tem como ver: se ESTA
 * aprovacao especifica ainda e a que autoriza o estado atual do conteudo.
 *
 * ── O buraco que o trigger sozinho deixa ────────────────────────────────────
 *
 * Aprovar (10:00) → editar (11:00, o trigger derruba para DRAFT) → revisar e
 * aprovar de novo (12:00). O conteudo volta a APPROVED, e a linha de aprovacao
 * das 10:00 continua com decision='APPROVED' apontando para o mesmo id e a
 * mesma versao. Sem mais nenhuma checagem, aquela aprovacao antiga voltaria a
 * valer — autorizando um texto que o aprovador das 10:00 nunca leu.
 *
 * Por isso a comparacao final: a aprovacao so vale se foi decidida a partir do
 * momento em que o conteudo entrou no estado aprovado em que esta agora.
 * decide() grava a decisao e a transicao de estado na MESMA transacao, entao
 * `now()` e identico nos dois e a comparacao e exata, sem tolerancia.
 */

export const APPROVAL_SUBJECT_TYPE = "content_version";

/** Estados em que uma aprovacao ainda cobre o conteudo. */
const ESTADOS_COBERTOS = new Set(["APPROVED", "SCHEDULED", "PUBLISHING", "PUBLISHED"]);

const ms = (t) => (t == null ? null : new Date(t).getTime());

/**
 * Decide se uma aprovacao autoriza publicar uma versao de conteudo.
 * Funcao pura: recebe as duas linhas, nao toca em banco.
 *
 * @returns {{ valid: boolean, reason_code: string|null, detail: string|null }}
 */
export function evaluateApproval({ approval, content, expected_content_version_id = null }) {
  const nao = (reason_code, detail) => ({ valid: false, reason_code, detail });

  if (!approval) return nao("CONTENT_NOT_APPROVED", "aprovacao inexistente");

  if (approval.subject_type !== APPROVAL_SUBJECT_TYPE) {
    // Nao e "nao aprovado": e um pedido malformado. Confundir os dois esconderia
    // bug de integracao atras de uma mensagem de fluxo editorial.
    return nao("SCHEMA_VALIDATION_FAILED", `subject_type inesperado: ${approval.subject_type}`);
  }

  // A aprovacao apresentada tem de ser a DESTE conteudo. Sem isto, um
  // approval_id valido de outro conteudo publicaria qualquer coisa.
  if (expected_content_version_id != null &&
      String(approval.subject_id) !== String(expected_content_version_id)) {
    return nao("CONTENT_NOT_APPROVED", "a aprovacao e de outro conteudo");
  }

  if (approval.decision !== "APPROVED") {
    return nao("CONTENT_NOT_APPROVED", `decisao atual: ${approval.decision}`);
  }

  if (!content) return nao("CONTENT_NOT_APPROVED", "versao de conteudo inexistente");

  if (String(approval.subject_id) !== String(content.id)) {
    return nao("CONTENT_NOT_APPROVED", "aprovacao aponta para outra versao");
  }

  // Versao nova e linha nova, com id novo — entao esta checagem quase nunca
  // dispara. Ela existe para o "quase": se disparar, alguem reescreveu numero
  // de versao debaixo de uma aprovacao, e publicar seria pior do que recusar.
  if (Number(approval.subject_version) !== Number(content.version)) {
    return nao("CONTENT_NOT_APPROVED",
      `aprovacao e da versao ${approval.subject_version}, o conteudo esta na ${content.version}`);
  }

  // Aqui e onde a edicao pos-aprovacao aparece: o trigger ja derrubou o estado.
  if (!ESTADOS_COBERTOS.has(content.state)) {
    return nao("CONTENT_NOT_APPROVED", `conteudo esta em ${content.state}`);
  }

  if (content.approved_at == null) {
    return nao("CONTENT_NOT_APPROVED", "conteudo sem carimbo de aprovacao");
  }

  // O buraco da reaprovacao, fechado.
  if (approval.decided_at == null || ms(approval.decided_at) < ms(content.approved_at)) {
    return nao("CONTENT_NOT_APPROVED",
      "o conteudo foi aprovado de novo depois desta decisao; vale a aprovacao mais recente");
  }

  return { valid: true, reason_code: null, detail: null };
}

/**
 * Servico de aprovacao. As portas entram por injecao, como no resto do runtime,
 * para o fluxo inteiro ser testavel sem HTTP.
 */
/**
 * @param {{ approvals: any, audit?: any, tracer?: any }} deps
 */
export function createApprovalService({ approvals, audit, tracer }) {
  return {
    /** Fila da tela: o que espera decisao neste workspace. */
    async listPending(tenant) {
      return approvals.listPending(tenant.org_id, tenant.workspace_id);
    },

    async get(tenant, approval_id) {
      return approvals.getWithContent(tenant.org_id, approval_id);
    },

    /**
     * Registra a decisao e move o conteudo, numa transacao so.
     *
     * A transicao de estado nao e feita aqui na mao: e delegada ao banco, que
     * tem a state machine em trigger. Se a transicao for ilegal, o banco recusa
     * e a decisao inteira volta atras — nao existe aprovacao registrada sobre
     * conteudo que nao chegou a mudar de estado.
     */
    /**
     * @param {{ tenant: any, approval_id: string, decision: string, actor: any,
     *           comment?: string|null, trace_id?: string|null }} args
     */
    async decide({ tenant, approval_id, decision, actor, comment = null, trace_id = null }) {
      if (decision !== "APPROVED" && decision !== "REJECTED") {
        const e = new Error(`decisao invalida: ${decision}`);
        e.reason_code = "SCHEMA_VALIDATION_FAILED";
        throw e;
      }

      const atual = await approvals.getWithContent(tenant.org_id, approval_id);
      if (!atual?.approval) {
        const e = new Error("aprovacao inexistente");
        e.reason_code = "CONTENT_NOT_APPROVED";
        throw e;
      }
      if (atual.approval.decision !== "PENDING") {
        // Decidir duas vezes nao e erro do usuario: geralmente sao duas abas.
        // Devolvemos o estado atual em vez de sobrescrever a decisao de alguem.
        return { ...atual, already_decided: true };
      }

      const out = await approvals.decide({
        org_id: tenant.org_id, approval_id, decision,
        decided_by: actor.id, comment, trace_id,
      });

      await audit?.record?.({
        org_id: tenant.org_id, workspace_id: tenant.workspace_id,
        actor_type: "user", actor_id: actor.id,
        action: decision === "APPROVED" ? "approval.approved" : "approval.rejected",
        object_type: APPROVAL_SUBJECT_TYPE, object_id: atual.approval.subject_id,
        trace_id,
      });

      tracer?.event?.({ trace_id, event: "approval.decided", approval_id, decision });
      return { ...out, already_decided: false };
    },

    /**
     * Porta que o Capability Gateway chama no passo 3. Assinatura fixada por
     * ele: (approval_id, args) -> boolean.
     */
    /** @param {{ content_version_id?: string|null }} [args] */
    async isApprovalValid(approval_id, args = {}) {
      const linhas = await approvals.getWithContentById(approval_id);
      const { valid } = evaluateApproval({
        ...linhas,
        expected_content_version_id: args.content_version_id ?? null,
      });
      return valid;
    },
  };
}
