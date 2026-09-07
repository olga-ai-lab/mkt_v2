/**
 * GET /api/connections/meta/callback — o retorno do consentimento.
 *
 * A Meta redireciona para cá com `code` e `state`. O `state` é a única coisa
 * confiável nesta requisição: ela chega de fora, sem sessão garantida, e o
 * tenant sai da assinatura, nunca de um parâmetro de URL.
 *
 * ── A ordem dos passos, e por que ela é essa ───────────────────────────────
 *
 * O segredo vai para o vault ANTES de a conexão ser gravada. Se a ordem fosse
 * a outra, uma falha no meio deixaria uma conexão ACTIVE apontando para um
 * segredo que não existe — e o sintoma apareceria na primeira publicação, com
 * "credencial não encontrada", longe da causa. Na ordem certa, a falha deixa
 * um segredo órfão no vault: invisível para o produto, e sem consequência.
 */
import { NextRequest, NextResponse } from "next/server";
import { conferirEstado, createMetaOAuth } from "@olga/runtime/meta-oauth";
import { refDeConexao } from "@olga/runtime/secrets";
import { ports } from "@/lib/db";
import { configMeta, vault } from "@/lib/meta";

export const runtime = "nodejs";

/** Volta para a tela de canais com o resultado legível na própria URL. */
const paraCanais = (request: NextRequest, params: Record<string, string>) =>
  NextResponse.redirect(new URL(`/channels?${new URLSearchParams(params)}`, request.nextUrl.origin));

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;

  // A pessoa clicou "cancelar" na tela da Meta. Não é erro: é a resposta dela.
  if (q.get("error")) {
    return paraCanais(request, { resultado: "cancelado" });
  }

  const cfg = configMeta();
  if ("faltando" in cfg) {
    return paraCanais(request, { resultado: "erro", motivo: "PROVIDER_UNAVAILABLE" });
  }

  let tenant;
  try {
    tenant = conferirEstado(q.get("state"), { app_secret: cfg.config.app_secret });
  } catch (e: any) {
    // State inválido é tentativa de escolher em qual workspace a conexão cai.
    // Não distinguimos "assinatura errada" de "expirado" na resposta ao
    // navegador: a diferença só ajudaria quem está tentando.
    return paraCanais(request, { resultado: "erro", motivo: e?.reason_code ?? "TENANT_SCOPE_VIOLATION" });
  }

  const code = q.get("code");
  if (!code) return paraCanais(request, { resultado: "erro", motivo: "SCHEMA_VALIDATION_FAILED" });

  const oauth = createMetaOAuth(cfg.config);

  try {
    const curto = await oauth.trocarCodigo(code);
    const { token: longo, expires_in } = await oauth.trocarPorLongo(curto);
    const contas = await oauth.contasDisponiveis(longo);

    // Só serve conta Business ligada a uma Page: é o que a API de publicação
    // do Instagram exige. Uma conta pessoal na lista viraria uma conexão que
    // aceita conectar e recusa publicar.
    const publicaveis = contas.filter((c: any) => c.instagram_id);
    if (publicaveis.length === 0) {
      return paraCanais(request, { resultado: "sem-conta" });
    }

    const secrets = vault();
    const expira = expires_in
      ? new Date(Date.now() + Number(expires_in) * 1000).toISOString()
      : null;

    let gravadas = 0;
    for (const conta of publicaveis) {
      // O `secret_ref` é derivado da conta, e não da conexão: a linha da
      // conexão ainda não existe na primeira vez, e o nome precisa ser estável
      // entre reconexões para não deixar segredo órfão a cada 60 dias.
      const ref = refDeConexao(`ig-${conta.instagram_id}`);

      // Primeiro o vault. Se ele recusar — o resolvedor por variável de
      // ambiente recusa, e diz por quê — nada é gravado.
      await secrets.store(ref, conta.page_token,
        { descricao: `Instagram ${conta.instagram_username ?? conta.instagram_id}` });

      await ports.connections.upsert({
        org_id: tenant.org_id, workspace_id: tenant.workspace_id,
        channel: "INSTAGRAM", provider: "meta",
        external_account_id: conta.instagram_id,
        display_name: conta.instagram_username ?? conta.page_name,
        secret_ref: ref,
        scopes: ["instagram_basic", "instagram_content_publish"],
        expires_at: expira,
      });
      gravadas += 1;
    }

    await ports.audit.record({
      org_id: tenant.org_id, workspace_id: tenant.workspace_id,
      actor_type: "user", actor_id: tenant.user_id ?? null,
      action: "channel.connected", object_type: "connection",
      decision: "ACTIVE",
      payload: { canal: "INSTAGRAM", contas: gravadas },
    });

    return paraCanais(request, { resultado: "conectado", contas: String(gravadas) });
  } catch (e: any) {
    // O token nunca chega aqui: os erros deste caminho carregam mensagem da
    // Meta ou reason code, e `createMetaOAuth` não ecoa os parâmetros da
    // chamada — que são os que carregam segredo.
    return paraCanais(request, { resultado: "erro", motivo: e?.reason_code ?? "PROVIDER_UNAVAILABLE" });
  }
}
