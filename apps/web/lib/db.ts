/**
 * Pool unico do processo e os servicos montados sobre ele.
 *
 * Next reexecuta modulos em dev a cada recompilacao; sem o cache no
 * globalThis, cada recarga abriria mais um pool e o Postgres acabaria
 * recusando conexao por esgotamento.
 */
import { Pool } from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createApprovalService } from "@olga/runtime/approvals";

declare global {
  // eslint-disable-next-line no-var
  var __olgaPool: Pool | undefined;
}

export const pool =
  globalThis.__olgaPool ?? (globalThis.__olgaPool = new Pool({ connectionString: process.env.DATABASE_URL }));

export const ports = createPostgresPorts(pool);

export const approvalService = createApprovalService({
  approvals: ports.approvals,
  tracer: { event: (e: unknown) => console.log(JSON.stringify({ ...(e as object), kind: "trace" })) },
});
