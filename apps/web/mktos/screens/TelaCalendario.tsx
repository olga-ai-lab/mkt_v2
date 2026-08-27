// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaCalendario() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1240px;")} data-screen-label="Calendário">
          <div style={css("display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px;")}>
            <div>
              <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Agosto de 2026</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>{v.nAgendados} agendados · {v.nPublicados} publicados. Clique em um item para abrir, antecipar ou ver métricas.</p>
            </div>
            <span style={css("flex:1;")}></span>
            <div style={css("display:flex;gap:14px;align-items:center;")}>
              <span style={css("display:flex;align-items:center;gap:6px;font-size:12px;color:#5A7A82;")}><span style={css("width:9px;height:9px;border-radius:3px;background:#0A8583;")}></span>agendado</span>
              <span style={css("display:flex;align-items:center;gap:6px;font-size:12px;color:#5A7A82;")}><span style={css("width:9px;height:9px;border-radius:3px;background:#0E8A46;")}></span>publicado</span>
            </div>
          </div>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:16px;")}>
            <div style={css("display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;margin-bottom:6px;")}>
              <p style={css("margin:0;font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;text-align:center;")}>SEG</p>
              <p style={css("margin:0;font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;text-align:center;")}>TER</p>
              <p style={css("margin:0;font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;text-align:center;")}>QUA</p>
              <p style={css("margin:0;font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;text-align:center;")}>QUI</p>
              <p style={css("margin:0;font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;text-align:center;")}>SEX</p>
              <p style={css("margin:0;font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;text-align:center;")}>SÁB</p>
              <p style={css("margin:0;font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;text-align:center;")}>DOM</p>
            </div>
            <div style={css("display:grid;gap:6px;")}>
              {(v.semanas || []).map((w: any, wIdx: number) => (<Fragment key={w.id ?? wIdx}>
                <div style={css("display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px;")}>
                  {(w.dias || []).map((d: any, dIdx: number) => (<Fragment key={d.id ?? dIdx}>
                    <div style={css(`min-height:92px;border:1px solid ${d.borda};background:${d.bg};border-radius:11px;padding:7px 8px;display:grid;gap:4px;align-content:start;`)}>
                      <span style={css("font-size:11px;font-weight:700;color:#8AA6AD;")}>{d.dia}</span>
                      {(d.itens || []).map((it: any, itIdx: number) => (<Fragment key={it.id ?? itIdx}>
                        <HoverEl as="div" style={css(`background:${it.bg};border-radius:7px;padding:5px 7px;cursor:pointer;display:grid;gap:2px;`)} hoverStyle={css("filter:brightness(0.96);")} onClick={it.onClick}>
                          <div style={css("display:flex;align-items:center;gap:4px;")}>
                            <span style={css(`font-size:9px;font-weight:700;color:${it.cor};`)}>{it.sigla}</span>
                            <span style={css(`font-size:9px;color:${it.cor};`)}>{it.hora}</span>
                          </div>
                          <span style={css("font-size:10.5px;font-weight:600;color:#0E353D;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;")}>{it.titulo}</span>
                        </HoverEl>
                      </Fragment>))}
                    </div>
                  </Fragment>))}
                </div>
              </Fragment>))}
            </div>
          </div>
        </section>
      </>
  );
}
