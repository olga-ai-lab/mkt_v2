// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaAgentes() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1180px;display:grid;gap:14px;")} data-screen-label="Agentes">
          <header style={css("display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;")}>
            <div>
              <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Agentes e autonomia</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>O nível diz o que o agente pode fazer sozinho — não o quanto ele acerta. A policy só restringe; nunca concede além do teto de risco.</p>
            </div>
            <span style={css("flex:1;")}></span>
            <HoverEl as="button" style={css(`padding:9px 17px;border:none;border-radius:11px;background:${v.pausaBg};color:#FFFFFF;font-size:12.5px;font-weight:600;cursor:pointer;`)} hoverStyle={css("filter:brightness(1.1);")} onClick={v.togglePausa}>{v.pausaRotulo}</HoverEl>
          </header>
          <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:14px;")}>
            {(v.agentes || []).map((a: any, aIdx: number) => (<Fragment key={a.id ?? aIdx}>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:18px 20px;display:grid;gap:9px;align-content:start;")}>
                <div style={css("display:flex;align-items:center;gap:10px;")}>
                  <span style={css(`width:34px;height:34px;border-radius:11px;background:${a.grad};flex-shrink:0;`)}></span>
                  <div style={css("flex:1;min-width:0;")}>
                    <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:14px;color:#0E353D;")}>{a.n}</strong>
                    <p style={css("margin:1px 0 0;font-size:11px;color:#8AA6AD;")}>{a.runs} · {a.custo}</p>
                  </div>
                  <div style={css("display:grid;gap:3px;justify-items:end;")}>
                    <span style={css("background:#0E353D;color:#FFFFFF;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;font-family:'Sora',Arial,sans-serif;")}>{a.nivel}</span>
                    <span style={css(`background:${a.stBg};color:${a.stCor};padding:1px 8px;border-radius:999px;font-size:9.5px;font-weight:700;`)}>{a.st}</span>
                  </div>
                </div>
                <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.55;")}>{a.d}</p>
              </div>
            </Fragment>))}
          </div>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;")}>
            <h2 style={css("margin:0 0 4px;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Risco define o teto de autonomia</h2>
            <p style={css("margin:0 0 14px;font-size:12.5px;color:#8AA6AD;")}>A0 observa · A1 sugere · A2 rascunha · A3 age com aprovação vinculada à versão · A4 age dentro do envelope e presta contas.</p>
            <div style={css("display:grid;gap:10px;")}>
              {(v.matriz || []).map((m: any, mIdx: number) => (<Fragment key={m.id ?? mIdx}>
                <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap;")}>
                  <span style={css(`background:${m.bg};color:${m.cor};padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;width:74px;text-align:center;`)}>{m.risco}</span>
                  <span style={css("font-size:12.5px;color:#41565D;flex:1;min-width:230px;")}>{m.ex}</span>
                  <strong style={css("font-size:12.5px;color:#0E353D;width:56px;")}>{m.teto}</strong>
                  <span style={css("font-size:11.5px;color:#8AA6AD;width:190px;")}>{m.obs}</span>
                </div>
              </Fragment>))}
            </div>
            <div style={css("border-top:1px solid #F0F5F6;margin-top:14px;padding-top:13px;")}>
              <p style={css("margin:0 0 8px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>NUNCA EM A4</p>
              <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
                {(v.nuncaA4 || []).map((n: any, nIdx: number) => (<Fragment key={n.id ?? nIdx}>
                  <span style={css("background:#FFF0F0;border:1px solid #F5D9D5;border-radius:999px;padding:4px 11px;font-size:11.5px;font-weight:600;color:#C0392B;")}>{n}</span>
                </Fragment>))}
              </div>
            </div>
          </div>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
            <div style={css("padding:16px 20px 10px;")}>
              <h2 style={css("margin:0 0 3px;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Trilha de receipts</h2>
              <p style={css("margin:0;font-size:12.5px;color:#8AA6AD;")}>Toda ação externa gera receipt idempotente: reexecutar o workflow não duplica publicação.</p>
            </div>
            {(v.receipts || []).map((r: any, rIdx: number) => (<Fragment key={r.id ?? rIdx}>
              <div style={css("display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid #F0F5F6;flex-wrap:wrap;")}>
                <span style={css("font-family:Courier,monospace;font-size:12px;color:#0A8583;min-width:120px;")}>{r.id}</span>
                <strong style={css("font-size:12.5px;color:#0E353D;flex:1;min-width:200px;")}>{r.t}</strong>
                <span style={css("font-size:11.5px;color:#8AA6AD;")}>{r.d}</span>
              </div>
            </Fragment>))}
          </div>
        </section>
      </>
  );
}
