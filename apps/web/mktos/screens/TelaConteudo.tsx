// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaConteudo() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1400px;")} data-screen-label="Conteúdo">
          <div style={css("display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px;")}>
            <div>
              <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Conteúdo</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Tudo que existe, na etapa em que está. Clique em qualquer card para ler, decidir ou ver o resultado.</p>
            </div>
            <span style={css("flex:1;")}></span>
            <div style={css("display:flex;gap:7px;")}>
              {(v.abas || []).map((a: any, aIdx: number) => (<Fragment key={a.id ?? aIdx}>
                <HoverEl as="span" style={css(`padding:8px 15px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer;background:${a.bg};color:${a.cor};border:1px solid ${a.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={a.onClick}>{a.t}</HoverEl>
              </Fragment>))}
            </div>
          </div>

          {v.abaEsteira && (<>
            <div style={css("display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;align-items:start;")}>
              {(v.colunas || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                <div style={css("display:grid;gap:9px;align-content:start;")}>
                  <div style={css("padding:0 4px;")}>
                    <div style={css("display:flex;align-items:center;gap:7px;")}>
                      <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:12.5px;font-weight:600;color:#0E353D;")}>{c.rotulo}</strong>
                      <span style={css("min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#E9F1F2;color:#5A7A82;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;")}>{c.n}</span>
                    </div>
                    <p style={css("margin:2px 0 0;font-size:10.5px;color:#8AA6AD;")}>{c.dono}</p>
                  </div>
                  {(c.itens || []).map((i: any, iIdx: number) => (<Fragment key={i.id ?? iIdx}>
                    <HoverEl as="div" style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:14px;overflow:hidden;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;")} onClick={i.onAbrir}>
                      <div style={css(`height:62px;background:${i.grad};padding:9px 11px;display:flex;align-items:flex-end;`)}>
                        <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:11px;font-weight:600;line-height:1.3;color:#FFFFFF;text-wrap:pretty;")}>{i.headline}</p>
                      </div>
                      <div style={css("padding:10px 11px;display:grid;gap:6px;")}>
                        <strong style={css("font-size:12px;color:#0E353D;line-height:1.35;")}>{i.titulo}</strong>
                        <div style={css("display:flex;align-items:center;gap:5px;flex-wrap:wrap;")}>
                          {(i.chips || []).map((ch: any, chIdx: number) => (<Fragment key={ch.id ?? chIdx}>
                            <span style={css(`width:17px;height:17px;border-radius:5px;background:${ch.cor};color:#FFFFFF;font-size:7.5px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;`)}>{ch.sigla}</span>
                          </Fragment>))}
                          <span style={css(`background:${i.riscoBg};color:${i.riscoCor};padding:1px 7px;border-radius:999px;font-size:9.5px;font-weight:700;`)}>{i.riscoRotulo}</span>
                        </div>
                        <span style={css("font-size:10.5px;color:#8AA6AD;")}>{i.quandoTexto} · v{i.versao}</span>
                      </div>
                    </HoverEl>
                  </Fragment>))}
                  {c.vazio && (<>
                    <div style={css("border:1px dashed #D4DFE2;border-radius:14px;padding:18px 12px;text-align:center;")}>
                      <p style={css("margin:0;font-size:11.5px;color:#8AA6AD;line-height:1.5;")}>nada aqui agora</p>
                    </div>
                  </>)}
                </div>
              </Fragment>))}
            </div>
          </>)}

          {v.abaBiblioteca && (<>
            <div style={css("background:#E6F9F9;border:1px solid #BDE8E7;border-radius:16px;padding:14px 20px;margin-bottom:14px;")}>
              <p style={css("margin:0;font-size:13px;color:#0A6462;line-height:1.5;")}>Aprovado uma vez, reusável sempre: republicar conteúdo aprovado é risco baixo e não volta para a fila. Se o texto for editado, o selo cai e ele vira rascunho comum.</p>
            </div>
            <div style={css("display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;")}>
              {(v.biblioteca || []).map((b: any, bIdx: number) => (<Fragment key={b.id ?? bIdx}>
                <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;")}>
                  <div style={css(`aspect-ratio:16/10;background:${b.gradCss};padding:14px 16px;display:flex;flex-direction:column;`)}>
                    <div style={css("display:flex;align-items:center;")}>
                      <span style={css("font-family:'Sora',Arial,sans-serif;font-size:10.5px;font-weight:700;color:rgba(255,255,255,0.88);flex:1;")}>{v.marcaCurta}</span>
                      <span style={css("background:rgba(255,255,255,0.2);color:#FFFFFF;font-size:9.5px;font-weight:700;border-radius:999px;padding:2px 8px;")}>{b.formato}</span>
                    </div>
                    <div style={css("flex:1;")}></div>
                    <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:14px;font-weight:600;line-height:1.3;color:#FFFFFF;text-wrap:pretty;")}>{b.headline}</p>
                  </div>
                  <div style={css("padding:13px 15px;display:grid;gap:7px;flex:1;align-content:start;")}>
                    <div style={css("display:flex;align-items:center;gap:7px;flex-wrap:wrap;")}>
                      <span style={css("background:#EDFCF2;color:#0E8A46;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;")}>PRÉ-APROVADO v{b.v}</span>
                      <span style={css("font-size:11px;color:#8AA6AD;")}>{b.usos} reusos</span>
                    </div>
                    <strong style={css("font-size:12.5px;color:#0E353D;line-height:1.35;")}>{b.titulo}</strong>
                    <span style={css("font-size:11px;color:#8AA6AD;")}>{b.canaisTexto} · desde {b.desde}</span>
                    {b.usado && (<>
                      <p style={css("margin:2px 0 0;font-size:12px;font-weight:600;color:#0E8A46;")}>Agendado para 30/08 sem passar pela fila.</p>
                    </>)}
                    {b.mostraBtn && (<>
                      <HoverEl as="button" style={css("justify-self:start;margin-top:2px;padding:8px 14px;border:none;border-radius:10px;background:#0E353D;color:#FFFFFF;font-size:12px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={b.onUsar}>Reusar agora</HoverEl>
                    </>)}
                  </div>
                </div>
              </Fragment>))}
            </div>
          </>)}
        </section>
      </>
  );
}
