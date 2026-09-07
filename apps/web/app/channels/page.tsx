/**
 * Canais conectados (A3).
 *
 * Sem conexão ativa nada é publicado — a policy bloqueia com
 * `CHANNEL_NOT_CONNECTED` antes de qualquer chamada externa. Esta tela é onde
 * essa condição deixa de ser um erro no fim do funil e passa a ser algo que
 * uma pessoa resolve.
 *
 * A tela diz a verdade sobre o estado do sistema, inclusive quando ela é
 * inconveniente: se falta configuração da Meta, ou se o app review ainda não
 * saiu, isso aparece aqui em vez de virar um botão que redireciona para um
 * erro da Meta.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import { configMeta } from "@/lib/meta";

export const dynamic = "force-dynamic";

const prazo = (v: unknown) => {
  if (!v) return null;
  const dias = Math.round((new Date(String(v)).getTime() - Date.now()) / 86_400_000);
  if (dias < 0) return "expirado";
  if (dias === 0) return "expira hoje";
  return `expira em ${dias} ${dias === 1 ? "dia" : "dias"}`;
};

export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getTrustedContext({ headers: await headers() });
  const q = await searchParams;

  if (!ctx) {
    return (
      <main className="page">
        <h1>Canais</h1>
        <p className="muted">Entre na sua conta para ver os canais deste workspace.</p>
      </main>
    );
  }

  const conexoes = await ports.content.listConnections(ctx.org_id, ctx.workspace_id);
  const cfg = configMeta();
  const configurado = !("faltando" in cfg);
  const modoReal = process.env.META_ADAPTER === "real";
  const vaultGrava = process.env.META_VAULT === "supabase";

  const resultado = typeof q.resultado === "string" ? q.resultado : null;
  const AVISO: Record<string, string> = {
    conectado: "Canal conectado. As publicações aprovadas já podem sair por ele.",
    cancelado: "Você cancelou na tela da Meta. Nada foi conectado.",
    "sem-conta": "Nenhuma conta do Instagram Business ligada a uma Página foi encontrada. A publicação pelo Instagram exige as duas coisas.",
    erro: "Não foi possível concluir a conexão. Nada foi gravado.",
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>Canais</h1>
        <p className="muted">
          Publicação só sai por canal conectado. Sem conexão ativa, a política
          bloqueia antes de qualquer chamada externa.
        </p>
      </header>

      {resultado && (
        <p className={`callout ${resultado === "conectado" ? "" : "aviso"}`}>
          {AVISO[resultado] ?? "Resultado desconhecido."}
        </p>
      )}

      {conexoes.length === 0 ? (
        <p className="muted">Nenhum canal conectado neste workspace ainda.</p>
      ) : (
        <ul className="fila">
          {conexoes.map((c: any) => (
            <li key={c.id} className="card linha">
              <span className={`chip ${c.status === "ACTIVE" ? "state-approved" : "state-failed"}`}>
                {c.status.toLowerCase()}
              </span>
              <strong>{c.channel}</strong>
              <span className="muted">{c.display_name ?? c.external_account_id}</span>
              {/*
                O prazo do token é a informação mais útil desta linha: o token
                longo da Meta dura 60 dias, e quem não é avisado antes descobre
                pelo post que não saiu.
              */}
              {prazo(c.expires_at) && <span className="muted">{prazo(c.expires_at)}</span>}
            </li>
          ))}
        </ul>
      )}

      <h2>Conectar o Instagram</h2>

      {/*
        Três condições, e cada uma some sozinha quando for resolvida. Listá-las
        aqui é a diferença entre "o botão não funciona" e "falta isto".
      */}
      {!configurado && (
        <p className="callout aviso">
          Falta configuração no ambiente: <code>{(cfg as any).faltando.join(", ")}</code>.
          Sem isso a tela da Meta não abre.
        </p>
      )}

      {!vaultGrava && (
        <p className="callout aviso">
          O vault em uso é somente leitura (variável de ambiente). O consentimento
          no navegador devolve um token em tempo de execução e precisa de um vault
          que grave — defina <code>META_VAULT=supabase</code>. Ver a ADR-0014.
        </p>
      )}

      {!modoReal && (
        <p className="callout aviso">
          O adapter da Meta está em <code>fake</code>: o produto roda de ponta a
          ponta, e nada sai para uma conta real. Trocar para <code>real</code> depende
          do app review da Meta (ADR-0008).
        </p>
      )}

      {ctx.role !== "OWNER" ? (
        <p className="muted">
          Conectar um canal é dar ao produto permissão de publicar em nome do
          cliente. Só um OWNER faz isso.
        </p>
      ) : (
        <p>
          <Link className="btn primario" href="/api/connections/meta/start">
            Conectar conta do Instagram
          </Link>
        </p>
      )}
    </main>
  );
}
