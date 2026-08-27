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
import { createBrandActivationService } from "@olga/runtime/brand-activation";
import { createContainmentService } from "@olga/runtime/containment";

declare global {
  // eslint-disable-next-line no-var
  var __olgaPool: Pool | undefined;
}

export const pool =
  globalThis.__olgaPool ?? (globalThis.__olgaPool = new Pool({ connectionString: process.env.DATABASE_URL }));

export const ports = createPostgresPorts(pool);

const tracer = { event: (e: unknown) => console.log(JSON.stringify({ ...(e as object), kind: "trace" })) };

export const approvalService = createApprovalService({ approvals: ports.approvals, tracer });

export const brandActivationService = createBrandActivationService({
  authoring: ports.authoring,
  tracer,
});

export const containmentService = createContainmentService({ policies: ports.policies, tracer });
