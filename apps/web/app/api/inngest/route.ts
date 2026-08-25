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

export const { GET, POST, PUT } = serve({ client: inngest, functions });
