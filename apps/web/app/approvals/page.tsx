/**
 * Tela de aprovacao (T4).
 *
 * A decisao e vinculada a VERSAO do conteudo, nao ao conteudo. Quem sustenta
 * isso e o banco: o trigger mkt.invalidate_approval_on_edit() derruba o estado
 * para DRAFT e zera approved_at quando o corpo muda depois de aprovado.
 *
 * Esta tela LE esse efeito; nao o reimplementa. Por isso ela mostra o estado e
 * a versao que vieram do banco em vez de calcular validade no cliente — duas
 * copias da mesma regra sao duas chances de divergir.
 */
import { getTrustedContext } from "@/lib/auth";
import { approvalService } from "@/lib/db";
import { headers } from "next/headers";
import { ApprovalQueue } from "./approval-queue";
import messages from "@/messages/reason-codes.pt-BR.json";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Aprovações</h1>
        <p className="muted">Entre na sua conta para ver a fila deste workspace.</p>
      </main>
    );
  }

  const fila = await approvalService.listPending({
    org_id: ctx.org_id,
    workspace_id: ctx.workspace_id,
  });

  const itens = fila.map((p: any) => ({
    approval_id: p.approval.id,
    subject_version: p.approval.subject_version,
    created_at: String(p.approval.created_at),
    motivos: (p.approval.requested_reason_codes ?? []).map((c: string) => ({
      code: c,
      texto: (messages as Record<string, string>)[c] ?? c,
    })),
    content: p.content && {
      id: p.content.id,
      version: p.content.version,
      state: p.content.state,
      risk_tier: p.content.risk_tier,
      master_body: p.content.master_body,
    },
  }));

  return (
    <main className="page">
      <header className="page-head">
        <h1>Aprovações</h1>
        <p className="muted">
          {itens.length === 0
            ? "Nada esperando decisão agora."
            : `${itens.length} ${itens.length === 1 ? "item espera" : "itens esperam"} sua decisão.`}
        </p>
      </header>

      {/*
        O aviso nao e decorativo: e a regra do produto dita para quem decide,
        antes de decidir. Sem ele, a aprovacao que cai depois de uma edicao
        parece defeito em vez de garantia.
      */}
      <p className="callout">
        A decisão vale para <strong>esta versão</strong> do texto. Se o conteúdo for
        editado depois de aprovado, a aprovação cai e o item volta para a fila.
      </p>

      <ApprovalQueue itens={itens} />
    </main>
  );
}
