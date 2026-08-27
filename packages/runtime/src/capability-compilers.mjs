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
    "content.create_draft": ({ entities, context, tenant, agent }) => {
      const brand_id = exigirEntidade(entities, "brand", "marca");
      return {
        brand_id,
        workspace_id: tenant.workspace_id,
        channel: valorEntidade(entities, "channel"),
        objective: valorEntidade(entities, "objective"),
        brand_brain_version_id: context?.brand_brain_version_id ?? null,
        // Quem escreveu fica gravado na versão. Não é telemetria: é o que
        // permite recolher o que um agente produziu quando ele se revela
        // errado, sem ter de adivinhar pelo horário.
        agent_id: agent?.agent_id ?? null,
        agent_version: agent?.version ?? null,
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

    // Mesma compilação do precheck, e é isso mesmo: as duas conferem o mesmo
    // conteúdo. O que muda é o que cada uma faz com o laudo, e isso é decisão
    // da capability, não do compilador.
    "quality.ai_review": ({ entities }) => ({
      content_version_id: exigirEntidade(entities, "content_version", "conteúdo"),
    }),

    "compliance.review": ({ entities }) => ({
      content_version_id: exigirEntidade(entities, "content_version", "conteúdo"),
    }),
  };
}

/**
 * Compiladores das capabilities internas restantes.
 *
 * Cinco capabilities do registry não tinham compilador: sem ele o loop recusa
 * o passo com "ainda não sei executar" — recusa correta, mas que deixava
 * AGT-MKT-BRAND sem nenhuma escrita e AGT-MKT-CONTENT sem variante nem
 * agendamento. Um agente com charter que ele não consegue exercer.
 *
 * `channel.connect` está aqui por simetria e falha sempre, de propósito: ver o
 * comentário no próprio builder.
 *
 * @param {{ publishing?: { findDestination: Function } }} ports
 */
export function createInternalCompilers({ publishing } = {}) {
  return {
    /**
     * Extração do site. A URL não vem do modelo: vem do cadastro da marca.
     *
     * Isso não é preciosismo — `brand.extract_from_url` sai para a rede pelo
     * adapter web_fetch, e uma URL escolhida pelo modelo a partir de texto do
     * usuário é exatamente o vetor que a defesa de SSRF daquele adapter existe
     * para conter. Melhor não deixar chegar lá.
     */
    "brand.extract_from_url": async ({ entities, context, tenant }) => {
      const brand_id = exigirEntidade(entities, "brand", "marca");
      const url = context?.brand?.website_url ?? context?.website_url ?? null;
      if (!url) {
        throw new CompileError("NORMALIZATION_FAILED",
          "esta marca não tem site cadastrado para eu ler");
      }
      return { brand_id, url: String(url), workspace_id: tenant.workspace_id };
    },

    /**
     * Proposta de Brand Brain.
     *
     * O conteúdo proposto vem do passo anterior — a extração — e chega em
     * `context.produced`, que é onde o loop deixa a saída de cada passo já
     * validada contra o `output_schema_ref` da capability que a produziu.
     *
     * Escrito assim de propósito, e não lendo um `context.proposta` que
     * qualquer um poderia preencher: a chave é o capability_id, então o que
     * alimenta esta proposta só pode ter saído de brand.extract_from_url,
     * executada neste mesmo run, pelo gateway, sob contrato.
     *
     * `status` não é argumento: a porta escreve CANDIDATE literal, porque
     * promover para ACTIVE é ato humano (o próprio AGT-MKT-BRAND declara isso
     * em deviates_from_base).
     */
    "brand.propose_version": ({ entities, context }) => {
      const brand_id = exigirEntidade(entities, "brand", "marca");
      const p = context?.produced?.["brand.extract_from_url"] ?? null;
      if (!p) {
        throw new CompileError("EVIDENCE_INSUFFICIENT",
          "não tenho o que propor: falta a extração que sustenta a versão");
      }
      // A proposta carrega a marca de onde saiu, e ela tem de ser a mesma que
      // o pedido resolveu. Sem esta linha, um plano com duas marcas escreveria
      // numa o que foi lido do site da outra — e ninguém veria, porque as duas
      // etapas teriam funcionado.
      if (p.brand_id != null && String(p.brand_id) !== String(brand_id)) {
        throw new CompileError("AMBIGUOUS_ENTITY",
          "a extração que tenho é de outra marca");
      }
      // Uma versão sem procedência é uma versão que ninguém consegue auditar
      // depois. O contrato da extração já exige source_refs; aqui a exigência
      // se repete porque este é o último ponto antes de virar linha de banco.
      if (!Array.isArray(p.source_refs) || p.source_refs.length === 0) {
        throw new CompileError("EVIDENCE_INSUFFICIENT",
          "essa extração não diz de onde veio, e versão de marca sem fonte não entra");
      }
      return {
        brand_id,
        identity: p.identity ?? {}, tone: p.tone ?? {},
        claims_allowed: p.claims_allowed ?? [], prohibitions: p.prohibitions ?? [],
        disclaimers: p.disclaimers ?? [], source_refs: p.source_refs,
      };
    },

    /**
     * Conexão de canal — sempre recusa, e é isso que deve fazer.
     *
     * Conectar uma conta é consentimento: passa por OAuth, no navegador de uma
     * pessoa, e termina com um token que vai para o vault. Nada disso cabe num
     * passo de agente. O compilador existe para que a recusa seja NOMEADA —
     * "isso é ação sua, no painel" — em vez de o loop dizer "não sei executar",
     * que soa como defeito nosso.
     */
    "channel.connect": () => {
      throw new CompileError("CONSENT_MISSING",
        "conectar um canal é ação sua: o consentimento acontece no painel, não por mim");
    },

    /**
     * Variante de canal. O texto nasce na capability; aqui se compila o alvo.
     */
    "content.create_variant": ({ entities }) => {
      const content_version_id = exigirEntidade(entities, "content_version", "conteúdo");
      const channel = valorEntidade(entities, "channel");
      if (!channel) throw new CompileError("AMBIGUOUS_ENTITY", "não sei para qual canal adaptar");
      return { content_version_id, channel: String(channel).toUpperCase() };
    },

    /**
     * Agendamento. Consulta o destino pelo mesmo caminho que a publicação.
     *
     * Agendar é interno e publicar é externo, mas as duas escolhem a MESMA
     * conta e a MESMA variante. Se cada uma resolvesse do seu jeito, existiria
     * a possibilidade de agendar para um destino e publicar em outro.
     */
    "publishing.schedule": async ({ entities, context, tenant }) => {
      if (!publishing?.findDestination) {
        throw new CompileError("SCHEMA_VALIDATION_FAILED",
          "compilador de agendamento exige a porta publishing.findDestination");
      }
      const content_version_id = exigirEntidade(entities, "content_version", "conteúdo");
      const channel = valorEntidade(entities, "channel");
      if (!channel) throw new CompileError("AMBIGUOUS_ENTITY", "não sei em qual canal agendar");

      const destino = await publishing.findDestination(
        tenant.org_id, tenant.workspace_id, content_version_id, channel);
      if (!destino) {
        throw new CompileError("CHANNEL_NOT_CONNECTED",
          `sem destino para agendar em ${channel}: falta variante de canal ou conexão ativa`);
      }

      // A data vem do contexto confiável, nunca de texto solto: "semana que
      // vem" precisa virar timestamp antes de chegar aqui, e quem faz isso é o
      // resolver, com o fuso do workspace.
      const quando = context?.scheduled_at ?? null;
      return {
        content_version_id, channel,
        connection_id: destino.connection_id,
        channel_variant_id: destino.channel_variant_id,
        scheduled_at: quando ? new Date(quando).toISOString() : null,
      };
    },
  };
}

/** Todas as capabilities que o MVP sabe compilar. É este o mapa que a aplicação monta. */
export function createAllCompilers(ports = {}) {
  return {
    ...createReadCompilers(),
    ...createPhase1Compilers(ports),
    ...createInternalCompilers(ports),
  };
}
