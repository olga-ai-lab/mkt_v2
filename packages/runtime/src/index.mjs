/**
 * O barril do runtime.
 *
 * Ninguem importa daqui hoje — todo consumidor usa o subpath
 * (`@olga/runtime/agent-loop`), que e mais explicito sobre o acoplamento.
 * Por isso este arquivo carregou por semanas um `AGENTS_COM_DELTA` que
 * deixou de existir quando agent-deltas virou um renderizador de persona: a
 * primeira pessoa a escrever `from "@olga/runtime"` receberia um SyntaxError
 * no boot, sem nenhuma pista de que o defeito era antigo.
 *
 * O teste em test/index.test.mjs importa o barril inteiro justamente para
 * essa divergencia aparecer aqui, e nao no dia em que alguem precisar dele.
 */
export { createModelGateway, ModelError, estimateCostCents } from "./model-gateway.mjs";
export { createAgentRuntime } from "./agent-runtime.mjs";
export { createApprovalService, evaluateApproval, APPROVAL_SUBJECT_TYPE } from "./approvals.mjs";
export { createAgentLoop, createCompiler, validateResult, buildEvidence, LoopError } from "./agent-loop.mjs";
export { assembleContext, CONTEXT_LAYERS, createLlmResolver, createLlmPlanner, createLlmResponder } from "./agent-stages.mjs";
export { createPhase1Compilers, createReadCompilers, createInternalCompilers, createAllCompilers, CompileError } from "./capability-compilers.mjs";
export { deltaFor, uncertaintyPolicy, personaVersionOf, PERSONA_PADRAO } from "./agent-deltas.mjs";
export { createRetrieval } from "./retrieval.mjs";
export { createComposer, LIMITE_POR_CANAL } from "./composer.mjs";
export { createBrandExtractor } from "./extractor.mjs";
export { createBrandActivationService, lacunasDe, PAPEIS_QUE_ATIVAM,
         PAPEIS_QUE_PROPOEM, BrandActivationError } from "./brand-activation.mjs";
export { createContainmentService, ContainmentError, PAPEIS_QUE_CONTEM } from "./containment.mjs";
export { createEntityResolver, TIPOS_COM_ID, TIPOS_DE_VALOR } from "./entity-resolver.mjs";
export { sinaisDeInjecao, redigir, redigirProfundo, PADROES, PII } from "./safety.mjs";
