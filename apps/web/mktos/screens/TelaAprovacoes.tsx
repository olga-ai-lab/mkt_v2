// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaAprovacoes() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1180px;")} data-screen-label="Aprovações">
          <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;")}>
            <div>
              <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Fila de aprovação</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Risco alto primeiro. Cada decisão vale para a versão que você leu — se o texto mudar, ela cai.</p>
            </div>
            <span style={css("flex:1;")}></span>
            {v.temLote && (<>
              <HoverEl as="button" style={css("padding:9px 16px;border:1px solid #BDE8E7;border-radius:11px;background:#E6F9F9;color:#0A6462;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#D6F4F3;")} onClick={v.aprovarLote}>Aprovar {v.loteN} de risco baixo em lote</HoverEl>
            </>)}
          </div>

          <div style={css("display:grid;gap:14px;")}>
            {(v.fila || []).map((i: any, iIdx: number) => (<Fragment key={i.id ?? iIdx}>
              <article style={css(`background:#FFFFFF;border:1px solid ${i.cardBorda};border-radius:18px;overflow:hidden;`)}>
                <div style={css("display:flex;gap:0;flex-wrap:wrap;")}>
                  <div style={css(`width:184px;flex-shrink:0;background:${i.grad};padding:16px;display:flex;flex-direction:column;min-height:172px;`)}>
                    <div style={css("display:flex;align-items:center;gap:6px;")}>
                      <span style={css("font-family:'Sora',Arial,sans-serif;font-size:10.5px;font-weight:700;color:rgba(255,255,255,0.9);flex:1;")}>{v.marcaCurta}</span>
                      <span style={css("background:rgba(255,255,255,0.2);color:#FFFFFF;font-size:9.5px;font-weight:700;border-radius:999px;padding:2px 7px;")}>{i.formato}</span>
                    </div>
                    <div style={css("flex:1;")}></div>
                    <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:14px;font-weight:600;line-height:1.32;color:#FFFFFF;text-wrap:pretty;")}>{i.headline}</p>
                  </div>

                  <div style={css("flex:1;min-width:280px;padding:16px 20px;display:grid;gap:11px;align-content:start;")}>
                    <div style={css("display:flex;align-items:center;gap:7px;flex-wrap:wrap;")}>
                      <span style={css(`background:${i.estBg};color:${i.estCor};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;`)}>{i.estRotulo}</span>
                      <span style={css(`background:${i.riscoBg};color:${i.riscoCor};padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;`)}>RISCO {i.riscoRotulo}</span>
                      <span style={css("font-size:11.5px;color:#8AA6AD;")}>v{i.versao} · {i.agente} ({i.auton}) · {i.vertical}</span>
                      {i.temHist && (<>
                        <span style={css("background:#F4F0FE;color:#6D5CE7;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:600;")}>{i.histRotulo}</span>
                      </>)}
                    </div>

                    <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;line-height:1.3;")}>{i.titulo}</strong>

                    <div style={css("display:flex;gap:6px;align-items:center;flex-wrap:wrap;")}>
                      <span style={css("font-size:10px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>VARIANTE</span>
                      {(i.tabs || []).map((t: any, tIdx: number) => (<Fragment key={t.id ?? tIdx}>
                        <HoverEl as="span" style={css(`display:inline-flex;align-items:center;gap:6px;padding:4px 11px 4px 5px;border-radius:999px;font-size:11.5px;font-weight:600;cursor:pointer;background:${t.bg};color:${t.cor};border:1px solid ${t.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={t.onClick}><span style={css(`width:16px;height:16px;border-radius:5px;background:${t.canalCor};color:#FFFFFF;font-size:7.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;`)}>{t.sigla}</span>{t.canal}</HoverEl>
                      </Fragment>))}
                      <span style={css("font-size:11px;color:#8AA6AD;")}>{i.limite}</span>
                    </div>

                    <p style={css("margin:0;font-size:13px;line-height:1.6;color:#41565D;white-space:pre-wrap;background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:12px 14px;max-height:148px;overflow-y:auto;")}>{i.corpoAtivo}</p>

                    <div style={css("display:grid;gap:6px;")}>
                      {(i.motivos || []).map((m: any, mIdx: number) => (<Fragment key={m.id ?? mIdx}>
                        <div style={css("display:flex;gap:8px;align-items:flex-start;")}>
                          <span style={css(`color:${m.cor};font-size:12px;font-weight:700;line-height:1.5;`)}>{m.marca}</span>
                          <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>{m.texto}</p>
                        </div>
                      </Fragment>))}
                    </div>

                    <div style={css("display:flex;gap:7px;align-items:center;flex-wrap:wrap;")}>
                      <span style={css("font-size:10px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>CAMINHO</span>
                      {(i.cadeia || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                        <span style={css(`display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600;background:${c.bg};color:${c.cor};`)}>{c.marca} {c.t}</span>
                      </Fragment>))}
                    </div>

                    {i.temLink && (<>
                      <div style={css("border:1px solid #E2D8F8;background:#F9F7FE;border-radius:11px;padding:10px 13px;display:flex;gap:9px;align-items:center;flex-wrap:wrap;")}>
                        <span style={css("font-size:10px;font-weight:700;color:#7C3AED;letter-spacing:0.05em;")}>LINK PARA O CLIENTE</span>
                        <span style={css("font-family:Courier,monospace;font-size:12px;color:#41565D;flex:1;min-width:170px;")}>{i.link}</span>
                        <span style={css("font-size:11px;color:#8AA6AD;")}>token de uso único · decisão registrada como externa</span>
                      </div>
                    </>)}

                    <div style={css("display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:11px 13px;background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;")}>
                      <span style={css("font-size:10px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>PUBLICAR</span>
                      <input style={css("padding:6px 10px;border:1px solid #D4DFE2;border-radius:9px;font-size:12px;color:#0E353D;background:#FFFFFF;outline-color:#0FC2C0;")} type="datetime-local" value={i.agInput} onChange={i.onAgendar} />
                      <span style={css("font-size:11.5px;color:#8AA6AD;")}>{i.janela}</span>
                    </div>

                    <input style={css(`padding:10px 13px;border:1px solid ${i.comentBorda};border-radius:11px;font-size:12.5px;color:#1A2C31;outline-color:#0FC2C0;`)} value={i.coment} onChange={i.onComent} placeholder="Comentário — obrigatório para pedir ajuste ou recusar" />

                    <div style={css("display:flex;gap:8px;flex-wrap:wrap;")}>
                      <HoverEl as="button" style={css("padding:10px 17px;border:none;border-radius:11px;background:#0E353D;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={i.onAprovar}>Aprovar e agendar {i.agRotulo}</HoverEl>
                      <HoverEl as="button" style={css("padding:10px 16px;border:1px solid #D4DFE2;border-radius:11px;background:#FFFFFF;color:#0E353D;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={i.onAjuste}>Pedir ajuste</HoverEl>
                      <HoverEl as="button" style={css(`padding:10px 16px;border:1px solid #E2D8F8;border-radius:11px;background:#FFFFFF;color:#7C3AED;font-size:13px;font-weight:600;cursor:pointer;opacity:${i.extOp};`)} hoverStyle={css("background:#F9F7FE;")} onClick={i.onExterna} disabled={i.extDesab}>Enviar ao cliente</HoverEl>
                      <HoverEl as="button" style={css("padding:10px 16px;border:1px solid #D4DFE2;border-radius:11px;background:#FFFFFF;color:#5A7A82;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#C0392B;color:#C0392B;")} onClick={i.onRecusar}>Recusar</HoverEl>
                    </div>
                  </div>
                </div>
              </article>
            </Fragment>))}
          </div>

          {v.filaVazia && (<>
            <div style={css("background:#FFFFFF;border:1px dashed #C3D2D6;border-radius:18px;padding:44px 24px;text-align:center;")}>
              <p style={css("margin:0 0 6px;font-family:'Sora',Arial,sans-serif;font-size:16px;font-weight:600;color:#0E353D;")}>Nada esperando por você.</p>
              <p style={css("margin:0 0 16px;font-size:13px;color:#5A7A82;")}>Quando um agente terminar um rascunho, ele aparece aqui com o motivo da revisão.</p>
              <HoverEl as="button" style={css("padding:10px 18px;border:1px solid #D4DFE2;border-radius:11px;background:#FFFFFF;color:#0E353D;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={v.irAgenda}>Planejar novas pautas</HoverEl>
            </div>
          </>)}
        </section>
      </>
  );
}
