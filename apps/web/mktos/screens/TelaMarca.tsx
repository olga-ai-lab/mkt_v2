// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaMarca() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1040px;display:grid;gap:14px;")} data-screen-label="Marca">
          <header style={css("display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;")}>
            <div>
              <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Marca</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>O Brand Brain é a régua de tudo que os agentes escrevem. Extraído do site, confirmado por você, versionado.</p>
            </div>
            <span style={css("flex:1;")}></span>
            <HoverEl as="button" style={css("padding:9px 16px;border:1px solid #D4DFE2;border-radius:11px;background:#FFFFFF;color:#0E353D;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={v.abrirOnb}>Refazer extração do site</HoverEl>
          </header>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:22px 24px;display:grid;gap:16px;")}>
            <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;")}>
              <span style={css("background:#EDFCF2;color:#0E8A46;padding:3px 11px;border-radius:999px;font-size:11px;font-weight:700;")}>v1 ATIVA</span>
              <strong style={css("font-size:14px;color:#0E353D;")}>{v.brandNome}</strong>
              <span style={css("font-size:12.5px;color:#8AA6AD;")}>{v.brandUrl} · {v.brandStatus}</span>
            </div>
            <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;")}>
              <div>
                <p style={css("margin:0 0 8px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>TOM DE VOZ</p>
                <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
                  {(v.brandTom || []).map((t: any, tIdx: number) => (<Fragment key={t.id ?? tIdx}>
                    <span style={css("background:#F4F7F8;border:1px solid #E3EDEF;border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:600;color:#0E353D;")}>{t}</span>
                  </Fragment>))}
                </div>
                <p style={css("margin:12px 0 0;font-size:13px;color:#41565D;line-height:1.55;font-style:italic;")}>"{v.brandTagline}"</p>
              </div>
              <div>
                <p style={css("margin:0 0 8px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>PALETA DO SITE</p>
                <div style={css("display:flex;gap:8px;")}>
                  {(v.brandPaleta || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                    <span style={css(`width:34px;height:34px;border-radius:10px;background:${p};border:1px solid #E3EDEF;`)}></span>
                  </Fragment>))}
                </div>
                <p style={css("margin:12px 0 0;font-size:11.5px;color:#8AA6AD;line-height:1.5;")}>Usada nos criativos gerados pelo agente de Conteúdo.</p>
              </div>
            </div>
            <div style={css("border-top:1px solid #F0F5F6;padding-top:16px;")}>
              <p style={css("margin:0 0 10px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>CLAIMS E FONTES</p>
              <div style={css("display:grid;gap:9px;")}>
                {(v.brandClaims || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                  <div style={css("display:flex;gap:10px;align-items:center;flex-wrap:wrap;")}>
                    <span style={css(`color:${c.cor};font-size:13px;font-weight:700;`)}>{c.marca}</span>
                    <strong style={css("font-size:13px;color:#0E353D;flex:1;min-width:200px;")}>{c.t}</strong>
                    <span style={css("font-size:12px;color:#8AA6AD;")}>{c.fonte}</span>
                  </div>
                </Fragment>))}
              </div>
            </div>
            <div style={css("border-top:1px solid #F0F5F6;padding-top:16px;")}>
              <p style={css("margin:0 0 10px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>PALAVRAS PROIBIDAS</p>
              <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
                {(v.brandProibido || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                  <span style={css("background:#FFF0F0;border:1px solid #F5D9D5;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:600;color:#C0392B;")}>{p}</span>
                </Fragment>))}
              </div>
              <p style={css("margin:12px 0 0;font-size:11.5px;color:#8AA6AD;line-height:1.55;")}>Compliance bloqueia qualquer texto com essas expressões, mesmo aprovado por você — a regra vem antes da preferência.</p>
            </div>
          </div>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
            <div style={css("padding:16px 20px 10px;")}><h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Versões</h2></div>
            {(v.brandVersoes || []).map((v: any, vIdx: number) => (<Fragment key={v.id ?? vIdx}>
              <div style={css("display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid #F0F5F6;flex-wrap:wrap;")}>
                <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:13px;color:#0E353D;width:34px;")}>{v.v}</strong>
                <span style={css("font-size:11px;font-weight:700;color:#8AA6AD;width:82px;")}>{v.st}</span>
                <span style={css("font-size:12.5px;color:#41565D;flex:1;min-width:200px;")}>{v.d}</span>
                <span style={css("font-size:11.5px;color:#8AA6AD;")}>{v.q}</span>
              </div>
            </Fragment>))}
          </div>
        </section>
      </>
  );
}
