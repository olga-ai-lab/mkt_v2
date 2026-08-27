// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaJornadas() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1180px;")} data-screen-label="Campanhas e jornadas">
          <div style={css("display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:16px;")}>
            <div>
              <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Campanhas e jornadas</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Campanha tem começo e fim; jornada roda sozinha por evento. Nas duas, a audiência vem da carteira e só entra quem tem consent.</p>
            </div>
            <span style={css("flex:1;")}></span>
            <div style={css("display:flex;gap:7px;")}>
              {(v.abasPlan || []).map((a: any, aIdx: number) => (<Fragment key={a.id ?? aIdx}>
                <HoverEl as="span" style={css(`padding:8px 15px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer;background:${a.bg};color:${a.cor};border:1px solid ${a.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={a.onClick}>{a.t}</HoverEl>
              </Fragment>))}
            </div>
          </div>

          {v.abaCampanhas && (<>
            <div style={css("display:grid;grid-template-columns:minmax(190px,250px) minmax(0,1fr);gap:14px;align-items:start;")}>
              <div style={css("display:grid;gap:8px;")}>
                {(v.campanhas || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                  <HoverEl as="div" style={css(`background:${c.selBg};border:1px solid ${c.selBorda};border-radius:14px;padding:13px 15px;cursor:pointer;display:grid;gap:5px;`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={c.onSel}>
                    <div style={css("display:flex;align-items:center;gap:7px;")}>
                      <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:13px;color:#0E353D;flex:1;line-height:1.3;")}>{c.nome}</strong>
                      <span style={css(`background:${c.stBg};color:${c.stCor};padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:700;`)}>{c.st}</span>
                    </div>
                    <span style={css("font-size:11px;color:#8AA6AD;")}>{c.obj} · {c.periodo}</span>
                    <span style={css("font-size:11.5px;color:#5A7A82;")}>{c.resumo}</span>
                  </HoverEl>
                </Fragment>))}
              </div>
              <div style={css("min-width:0;background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:22px 24px;display:grid;gap:16px;align-content:start;")}>
                <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;")}>
                  <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:17px;font-weight:600;color:#0E353D;")}>{v.camp.nome}</h2>
                  <span style={css(`background:${v.camp.stBg};color:${v.camp.stCor};padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;`)}>{v.camp.st}</span>
                  <span style={css("flex:1;")}></span>
                  <div style={css("display:flex;gap:4px;")}>
                    {(v.camp.canaisChips || []).map((ch: any, chIdx: number) => (<Fragment key={ch.id ?? chIdx}>
                      <span style={css(`width:22px;height:22px;border-radius:7px;background:${ch.cor};color:#FFFFFF;font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;`)}>{ch.sigla}</span>
                    </Fragment>))}
                  </div>
                </div>
                <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;")}>
                  <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:12px 14px;")}><p style={css("margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>OBJETIVO</p><p style={css("margin:0;font-size:12.5px;color:#41565D;")}>{v.camp.obj}</p></div>
                  <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:12px 14px;")}><p style={css("margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>PERÍODO</p><p style={css("margin:0;font-size:12.5px;color:#41565D;")}>{v.camp.periodo}</p></div>
                  <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:12px 14px;")}><p style={css("margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>AUDIÊNCIA</p><p style={css("margin:0;font-size:12.5px;color:#41565D;")}>{v.camp.aud} · {v.camp.pessoasTexto}</p></div>
                  <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:12px 14px;")}><p style={css("margin:0 0 3px;font-size:10px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>INVESTIMENTO</p><p style={css("margin:0;font-size:12.5px;color:#41565D;")}>{v.camp.orc}</p></div>
                </div>
                <div>
                  <p style={css("margin:0 0 9px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>CONTEÚDOS DA CAMPANHA</p>
                  <div style={css("display:grid;gap:7px;")}>
                    {(v.camp.itens || []).map((it: any, itIdx: number) => (<Fragment key={it.id ?? itIdx}>
                      <div style={css("display:flex;gap:9px;align-items:center;padding:9px 13px;border:1px solid #E9F1F2;border-radius:11px;")}>
                        <span style={css("width:6px;height:6px;border-radius:50%;background:#0FC2C0;flex-shrink:0;")}></span>
                        <span style={css("font-size:12.5px;color:#41565D;")}>{it}</span>
                      </div>
                    </Fragment>))}
                  </div>
                </div>
                {v.camp.temRes && (<>
                  <div>
                    <p style={css("margin:0 0 9px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>DO ALCANCE À APÓLICE</p>
                    <div style={css("display:grid;gap:8px;")}>
                      {(v.camp.funil || []).map((f: any, fIdx: number) => (<Fragment key={f.id ?? fIdx}>
                        <div style={css("display:flex;align-items:center;gap:12px;")}>
                          <span style={css("font-size:12px;color:#5A7A82;width:96px;flex-shrink:0;")}>{f.t}</span>
                          <div style={css("flex:1;height:22px;border-radius:7px;background:#F4F7F8;overflow:hidden;")}><div style={css(`height:100%;width:${f.barra};background:linear-gradient(90deg,#0E353D,#0FC2C0);`)}></div></div>
                          <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:13px;color:#0E353D;width:56px;text-align:right;")}>{f.v}</strong>
                        </div>
                      </Fragment>))}
                    </div>
                  </div>
                </>)}
                {v.camp.semRes && (<>
                  <p style={css("margin:0;font-size:12.5px;color:#8AA6AD;background:#F8FBFB;border:1px dashed #D4DFE2;border-radius:12px;padding:14px;")}>Sem resultado ainda — a campanha começa a medir quando a primeira peça for publicada.</p>
                </>)}
                <div style={css("border-top:1px solid #F0F5F6;padding-top:14px;")}>
                  <p style={css("margin:0 0 9px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>REGRAS DE PROTEÇÃO</p>
                  <div style={css("display:grid;gap:6px;")}>
                    {(v.camp.guard || []).map((g: any, gIdx: number) => (<Fragment key={g.id ?? gIdx}>
                      <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>— {g}</p>
                    </Fragment>))}
                  </div>
                  <p style={css("margin:11px 0 0;font-size:12px;color:#8AA6AD;")}>Autonomia da campanha: {v.camp.auton}</p>
                </div>
              </div>
            </div>
          </>)}

          {v.abaJornadas && (<>
          <div style={css("display:grid;grid-template-columns:minmax(190px,238px) minmax(0,1fr);gap:14px;align-items:start;")}>
            <div style={css("display:grid;gap:8px;")}>
              {(v.jornadas || []).map((j: any, jIdx: number) => (<Fragment key={j.id ?? jIdx}>
                <HoverEl as="div" style={css(`background:${j.selBg};border:1px solid ${j.selBorda};border-radius:14px;padding:13px 15px;cursor:pointer;display:grid;gap:5px;`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={j.onSel}>
                  <div style={css("display:flex;align-items:center;gap:7px;")}>
                    <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:13.5px;color:#0E353D;flex:1;")}>{j.nome}</strong>
                    <span style={css(`background:${j.stBg};color:${j.stCor};padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:700;`)}>{j.stRotulo}</span>
                  </div>
                  <span style={css("font-size:11.5px;color:#8AA6AD;")}>{j.sub}</span>
                </HoverEl>
              </Fragment>))}
            </div>
            <div style={css("min-width:0;background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:22px 24px;display:grid;gap:16px;align-content:start;")}>
              <div style={css("display:flex;align-items:center;gap:10px;flex-wrap:wrap;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:17px;font-weight:600;color:#0E353D;")}>{v.jSel.nome}</h2>
                <span style={css(`background:${v.jSel.stBg};color:${v.jSel.stCor};padding:3px 10px;border-radius:999px;font-size:10.5px;font-weight:700;`)}>{v.jSel.stRotulo}</span>
                <span style={css("flex:1;")}></span>
                <HoverEl as="button" style={css(`padding:9px 16px;border:1px solid ${v.jSel.btnBorda};border-radius:11px;background:${v.jSel.btnBg};color:${v.jSel.btnCor};font-size:12.5px;font-weight:600;cursor:pointer;`)} hoverStyle={css("filter:brightness(1.06);")} onClick={v.jSel.onToggle}>{v.jSel.btn}</HoverEl>
              </div>
              <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;")}>
                <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:13px 15px;")}><p style={css("margin:0 0 3px;font-size:10.5px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>GATILHO</p><p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>{v.jSel.trigger}</p></div>
                <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:13px 15px;")}><p style={css("margin:0 0 3px;font-size:10.5px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>QUEM ESTÁ DENTRO</p><p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>{v.jSel.inscritosTexto}</p></div>
                <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:13px 15px;")}><p style={css("margin:0 0 3px;font-size:10.5px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>AUTONOMIA</p><p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>{v.jSel.auton}</p></div>
              </div>
              <div>
                <p style={css("margin:0 0 10px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>SEQUÊNCIA</p>
                <div style={css("display:grid;gap:8px;")}>
                  {(v.jSel.passos || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                    <div style={css("display:flex;align-items:center;gap:12px;padding:11px 14px;border:1px solid #E9F1F2;border-radius:12px;flex-wrap:wrap;")}>
                      <span style={css("font-family:'Sora',Arial,sans-serif;font-size:11.5px;font-weight:700;color:#0A8583;width:62px;flex-shrink:0;")}>{p.q}</span>
                      <span style={css("font-size:13px;color:#0E353D;flex:1;min-width:150px;")}>{p.t}</span>
                      <span style={css("display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#5A7A82;")}><span style={css(`width:18px;height:18px;border-radius:6px;background:${p.cor};color:#FFFFFF;font-size:8px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;`)}>{p.sigla}</span>{p.canal}</span>
                    </div>
                  </Fragment>))}
                </div>
              </div>
              <div style={css("border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0 0 9px;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>REGRAS DE PROTEÇÃO</p>
                <div style={css("display:grid;gap:6px;")}>
                  <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>— só entra quem tem consent ativo; sai automaticamente ao pedir descadastro</p>
                  <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>— janela de silêncio: nada entre 21h e 8h, nem em domingo</p>
                  <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>— teto de frequência: 1 mensagem por cliente a cada 7 dias, somando todas as jornadas</p>
                  <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>— supressão automática: sinistro em aberto, inadimplência, disputa jurídica</p>
                  <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>— saída antecipada: se o cliente responder ou renovar, os passos seguintes são cancelados</p>
                </div>
              </div>
              <p style={css("margin:0;font-size:12px;color:#8AA6AD;line-height:1.6;border-top:1px solid #F0F5F6;padding-top:14px;")}>Jornada em A4 só roda dentro de envelope declarado (canal, volume, risco), com kill switch e cada envio auditável até a versão da regra.</p>
            </div>
          </div>
          </>)}
        </section>
      </>
  );
}
