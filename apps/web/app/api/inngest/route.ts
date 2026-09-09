/**
 * Endpoint durável do Inngest.
 *
 * O motor chama esta rota para executar cada passo do workflow. Sem ela, as
 * funcoes existiam e ninguem as servia — que era o estado ate agora.
 *
 * Handler fino como os outros: toda a montagem mora em
 * apps/worker/src/composition.mjs, que roda em teste sem HTTP.
 */
import { serve } from "inngest/next";
import { createInngestClient } from "@olga/worker/client";
import { createWorkerApp } from "@olga/worker/composition";
import { pool } from "@/lib/db";

export const runtime = "nodejs";

const inngest = createInngestClient();
const { functions } = createWorkerApp({ pool, inngest });

/**
 * `serveOrigin` existe por causa do proxy do Railway (ADR-0012).
 *
 * Atrás dele o Next não adivinha o host externo, e o Inngest registra a URL que
 * o processo acha que tem. Errar isso não dá erro em lugar nenhum: o registro
 * acontece, o deploy fica verde, e o workflow durável simplesmente nunca é
 * chamado — as publicações ficam agendadas para sempre.
 *
 * Ausente, o Inngest volta a deduzir sozinho, que é o certo em desenvolvimento.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  serveOrigin: process.env.INNGEST_SERVE_ORIGIN,
});
