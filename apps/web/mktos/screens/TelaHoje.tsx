// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaHoje() {
  const v = useMktos();
  return (
    <>
        <section style={css("display:grid;gap:16px;max-width:1180px;")} data-screen-label="Hoje">
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;")}>
            <div style={css("display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:16px;")}>
              <div>
                <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>A esteira de hoje</h1>
                <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Da pauta ao publicado. Clique em qualquer etapa para trabalhar nela.</p>
              </div>
              <span style={css("flex:1;")}></span>
              <p style={css("margin:0;font-size:12.5px;color:#8AA6AD;")}>Quinta, 27 de agosto de 2026</p>
            </div>
            <div style={css("display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;")}>
              {(v.esteira || []).map((e: any, eIdx: number) => (<Fragment key={e.id ?? eIdx}>
                <HoverEl as="div" style={css(`cursor:pointer;border:1px solid ${e.borda};background:${e.bg};border-radius:13px;padding:12px 13px;display:grid;gap:6px;align-content:start;`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={e.onClick}>
                  <div style={css("display:flex;align-items:center;gap:6px;")}>
                    <span style={css("font-size:9.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.07em;")}>{e.passo}</span>
                    {e.foco && (<>
                      <span style={css("width:6px;height:6px;border-radius:50%;background:#F0B429;animation:om-pulse 2s ease-in-out infinite;")}></span>
                    </>)}
                  </div>
                  <strong style={css(`font-family:'Sora',Arial,sans-serif;font-size:22px;font-weight:700;color:${e.numCor};line-height:1;`)}>{e.n}</strong>
                  <span style={css("font-size:11.5px;font-weight:600;color:#41565D;line-height:1.35;")}>{e.rotulo}</span>
                  <span style={css("font-size:10.5px;color:#8AA6AD;line-height:1.35;")}>{e.dono}</span>
                </HoverEl>
              </Fragment>))}
            </div>
          </div>

          <div style={css("display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:16px;align-items:start;")}>
            <div style={css("display:grid;gap:16px;")}>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
                <div style={css("padding:18px 22px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;")}>
                  <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Precisa de você</h2>
                  <span style={css("background:#FFF8E1;color:#9A6B00;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;")}>{v.nPendente}</span>
                  <span style={css("flex:1;")}></span>
                  <HoverEl as="span" style={css("font-size:12px;font-weight:600;color:#0A8583;cursor:pointer;")} hoverStyle={css("color:#0FC2C0;")} onClick={v.irAprovacoes}>Abrir fila completa →</HoverEl>
                </div>
                {(v.pendencias || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                  <div style={css("display:flex;align-items:center;gap:13px;padding:13px 22px;border-top:1px solid #F0F5F6;flex-wrap:wrap;")}>
                    <span style={css(`width:34px;height:34px;border-radius:10px;background:${p.iconeBg};display:flex;align-items:center;justify-content:center;flex-shrink:0;`)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={p.iconeCor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={p.icone} /></svg>
                    </span>
                    <div style={css("flex:1;min-width:180px;")}>
                      <div style={css("display:flex;align-items:center;gap:7px;flex-wrap:wrap;")}>
                        <strong style={css("font-size:13.5px;color:#0E353D;")}>{p.titulo}</strong>
                        <span style={css(`background:${p.riscoBg};color:${p.riscoCor};padding:1px 8px;border-radius:999px;font-size:10px;font-weight:700;`)}>{p.riscoRotulo}</span>
                      </div>
                      <p style={css("margin:3px 0 0;font-size:12px;color:#5A7A82;line-height:1.45;")}>{p.motivo}</p>
                    </div>
                    <HoverEl as="button" style={css("padding:8px 15px;border:1px solid #D4DFE2;border-radius:10px;background:#FFFFFF;color:#0E353D;font-size:12.5px;font-weight:600;cursor:pointer;flex-shrink:0;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={p.onAbrir}>{p.cta}</HoverEl>
                  </div>
                </Fragment>))}
                {v.semPendencia && (<>
                  <div style={css("padding:26px 22px 30px;border-top:1px solid #F0F5F6;text-align:center;")}>
                    <p style={css("margin:0 0 4px;font-family:'Sora',Arial,sans-serif;font-size:14px;font-weight:600;color:#0E8A46;")}>Fila limpa.</p>
                    <p style={css("margin:0;font-size:12.5px;color:#5A7A82;")}>Os agentes seguem trabalhando — o próximo rascunho aparece aqui.</p>
                  </div>
                </>)}
              </div>

              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
                <div style={css("padding:18px 22px 12px;display:flex;align-items:center;gap:10px;")}>
                  <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Próximas publicações</h2>
                  <span style={css("flex:1;")}></span>
                  <HoverEl as="span" style={css("font-size:12px;font-weight:600;color:#0A8583;cursor:pointer;")} hoverStyle={css("color:#0FC2C0;")} onClick={v.irCalendario}>Calendário →</HoverEl>
                </div>
                {(v.proximas || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                  <HoverEl as="div" style={css("display:flex;align-items:center;gap:12px;padding:12px 22px;border-top:1px solid #F0F5F6;cursor:pointer;flex-wrap:wrap;")} hoverStyle={css("background:#F8FBFB;")} onClick={p.onAbrir}>
                    <span style={css("font-family:'Sora',Arial,sans-serif;font-size:12px;font-weight:700;color:#0A8583;width:92px;flex-shrink:0;")}>{p.quando}</span>
                    <strong style={css("font-size:13px;color:#0E353D;flex:1;min-width:160px;")}>{p.titulo}</strong>
                    <div style={css("display:flex;gap:4px;")}>
                      {(p.chips || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                        <span style={css(`width:20px;height:20px;border-radius:6px;background:${c.cor};color:#FFFFFF;font-size:8.5px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;`)}>{c.sigla}</span>
                      </Fragment>))}
                    </div>
                    <span style={css("font-size:11.5px;color:#8AA6AD;width:86px;text-align:right;")}>{p.origem}</span>
                  </HoverEl>
                </Fragment>))}
                {v.semProximas && (<>
                  <div style={css("padding:22px;border-top:1px solid #F0F5F6;")}>
                    <p style={css("margin:0;font-size:12.5px;color:#5A7A82;")}>Nada agendado. Aprove um item da fila para ocupar o calendário.</p>
                  </div>
                </>)}
              </div>
            </div>

            <div style={css("display:grid;gap:16px;")}>
              <div style={css("background:#0E353D;border-radius:18px;padding:20px 22px;color:#FFFFFF;")}>
                <p style={css("margin:0 0 3px;font-size:10.5px;font-weight:700;letter-spacing:0.09em;color:#7FBFC4;")}>PRÓXIMO PASSO SUGERIDO</p>
                <p style={css("margin:0 0 12px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;line-height:1.35;")}>{v.focoTitulo}</p>
                <p style={css("margin:0 0 15px;font-size:12.5px;color:#B7D3D7;line-height:1.55;")}>{v.focoTexto}</p>
                <HoverEl as="button" style={css("padding:9px 17px;border:none;border-radius:11px;background:#0FC2C0;color:#04302F;font-size:12.5px;font-weight:700;cursor:pointer;")} hoverStyle={css("filter:brightness(1.08);")} onClick={v.focoAcao}>{v.focoCta}</HoverEl>
              </div>

              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:18px 22px;")}>
                <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:12px;")}>
                  <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Agentes trabalhando</h2>
                  <span style={css("flex:1;")}></span>
                  <HoverEl as="span" style={css("font-size:12px;font-weight:600;color:#0A8583;cursor:pointer;")} hoverStyle={css("color:#0FC2C0;")} onClick={v.irAgentes}>Governança →</HoverEl>
                </div>
                <div style={css("display:grid;gap:13px;")}>
                  {(v.atividade || []).map((a: any, aIdx: number) => (<Fragment key={a.id ?? aIdx}>
                    <div style={css("display:flex;gap:10px;")}>
                      <span style={css(`width:7px;height:7px;border-radius:50%;background:${a.cor};margin-top:5px;flex-shrink:0;`)}></span>
                      <div style={css("min-width:0;")}>
                        <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}><strong style={css("color:#0E353D;")}>{a.agente}</strong> {a.acao}</p>
                        <p style={css("margin:2px 0 0;font-size:11px;color:#8AA6AD;")}>{a.hora}</p>
                      </div>
                    </div>
                  </Fragment>))}
                </div>
              </div>

              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:18px 22px;")}>
                <div style={css("display:flex;align-items:baseline;gap:8px;margin-bottom:10px;")}>
                  <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Últimos 30 dias</h2>
                  <span style={css("flex:1;")}></span>
                  <HoverEl as="span" style={css("font-size:12px;font-weight:600;color:#0A8583;cursor:pointer;")} hoverStyle={css("color:#0FC2C0;")} onClick={v.irDesempenho}>Desempenho →</HoverEl>
                </div>
                <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:12px;")}>
                  <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:20px;color:#0E353D;")}>{v.kpiAlcance}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>pessoas alcançadas</p></div>
                  <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:20px;color:#0E353D;")}>{v.kpiConversas}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>conversas abertas</p></div>
                  <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:20px;color:#0E353D;")}>{v.kpiPublicados}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>posts publicados</p></div>
                  <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:20px;color:#0E353D;")}>{v.kpiCusto}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>custo de IA no mês</p></div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </>
  );
}
