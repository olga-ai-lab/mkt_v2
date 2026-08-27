// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaDesempenho() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1180px;display:grid;gap:16px;")} data-screen-label="Desempenho">
          <header style={css("display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;")}>
            <div>
              <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Desempenho</h1>
              <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Últimos {v.periodoAtual}. O que importa aqui não é alcance — é conversa aberta e apólice emitida.</p>
            </div>
            <span style={css("flex:1;")}></span>
            <div style={css("display:flex;gap:6px;")}>
              {(v.periodos || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                <HoverEl as="span" style={css(`padding:7px 14px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer;background:${p.bg};color:${p.cor};border:1px solid ${p.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={p.onClick}>{p.t}</HoverEl>
              </Fragment>))}
            </div>
          </header>
          <div style={css("display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px;align-items:start;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;")}>
              <h2 style={css("margin:0 0 3px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Do alcance à apólice</h2>
              <p style={css("margin:0 0 16px;font-size:12.5px;color:#8AA6AD;")}>Cada etapa é medida com dado real do canal e da carteira — sem estimativa de modelo.</p>
              <div style={css("display:grid;gap:10px;")}>
                {(v.funilGeral || []).map((f: any, fIdx: number) => (<Fragment key={f.id ?? fIdx}>
                  <div style={css("display:grid;gap:4px;")}>
                    <div style={css("display:flex;align-items:baseline;gap:8px;")}>
                      <span style={css("font-size:12.5px;font-weight:600;color:#0E353D;flex:1;")}>{f.t}</span>
                      <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:14px;color:#0E353D;")}>{f.v}</strong>
                    </div>
                    <div style={css("height:20px;border-radius:7px;background:#F4F7F8;overflow:hidden;")}><div style={css(`height:100%;width:${f.barra};background:linear-gradient(90deg,#0E353D,#0FC2C0);`)}></div></div>
                    <span style={css("font-size:11px;color:#8AA6AD;")}>{f.conv}</span>
                  </div>
                </Fragment>))}
              </div>
            </div>
            <div style={css("display:grid;gap:16px;")}>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:12px;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Custo por resultado</h2>
                <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:12px;")}>
                  <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:20px;color:#0E353D;")}>{v.custoConversa}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>por conversa aberta</p></div>
                  <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:20px;color:#0E353D;")}>{v.custoApolice}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>por apólice emitida</p></div>
                </div>
                <p style={css("margin:0;font-size:11.5px;color:#8AA6AD;line-height:1.55;")}>Conta apenas o custo de IA do período — não inclui impulsionamento nem hora do corretor.</p>
              </div>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:10px;")}>
                <div style={css("display:flex;align-items:center;gap:8px;")}>
                  <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Teste A/B do assunto</h2>
                  <span style={css("background:#EDFCF2;color:#0E8A46;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;")}>VENCEU {v.teste.vencedor}</span>
                </div>
                <div style={css("background:#EDFCF2;border:1px solid #BFE9CF;border-radius:11px;padding:11px 13px;")}>
                  <p style={css("margin:0 0 2px;font-size:10px;font-weight:700;color:#0E8A46;letter-spacing:0.06em;")}>VARIANTE A · {v.teste.dif}</p>
                  <p style={css("margin:0;font-size:12.5px;color:#0E353D;")}>{v.teste.a}</p>
                </div>
                <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:11px;padding:11px 13px;")}>
                  <p style={css("margin:0 0 2px;font-size:10px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>VARIANTE B</p>
                  <p style={css("margin:0;font-size:12.5px;color:#41565D;")}>{v.teste.b}</p>
                </div>
                <p style={css("margin:0;font-size:11.5px;color:#8AA6AD;line-height:1.55;")}>{v.teste.obs}</p>
              </div>
            </div>
          </div>
          <div style={css("display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px;align-items:start;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;")}>
              <h2 style={css("margin:0 0 14px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Por vertical de conteúdo</h2>
              <div style={css("display:grid;gap:11px;")}>
                {(v.porVertical || []).map((v: any, vIdx: number) => (<Fragment key={v.id ?? vIdx}>
                  <div style={css("display:grid;gap:4px;")}>
                    <div style={css("display:flex;align-items:baseline;gap:8px;")}>
                      <span style={css("font-size:12.5px;font-weight:600;color:#0E353D;flex:1;")}>{v.v}</span>
                      <span style={css("font-size:11.5px;color:#8AA6AD;")}>{v.posts} posts</span>
                      <span style={css("font-size:12px;color:#41565D;")}>{v.alcance}</span>
                      <strong style={css("font-size:12px;color:#0A8583;width:96px;text-align:right;")}>{v.conv}</strong>
                    </div>
                    <div style={css("height:6px;border-radius:999px;background:#EEF3F4;overflow:hidden;")}><div style={css(`height:100%;width:${v.barra};background:linear-gradient(90deg,#6D5CE7,#0FC2C0);`)}></div></div>
                  </div>
                </Fragment>))}
              </div>
              <p style={css("margin:14px 0 0;font-size:11.5px;color:#8AA6AD;line-height:1.55;")}>Renovação alcança pouco e converte muito: é conteúdo individual, para quem já é cliente.</p>
            </div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;")}>
              <h2 style={css("margin:0 0 12px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Melhores horários</h2>
              <div style={css("display:grid;gap:9px;")}>
                {(v.horarios || []).map((h: any, hIdx: number) => (<Fragment key={h.id ?? hIdx}>
                  <div style={css("display:flex;gap:10px;align-items:baseline;")}>
                    <strong style={css("font-size:12.5px;color:#0E353D;min-width:120px;")}>{h.t}</strong>
                    <span style={css("font-size:12px;color:#5A7A82;flex:1;")}>{h.d}</span>
                  </div>
                </Fragment>))}
              </div>
              <p style={css("margin:14px 0 0;font-size:11.5px;color:#8AA6AD;line-height:1.55;")}>O agente de Conteúdo já usa essas janelas ao propor data na fila de aprovação.</p>
            </div>
          </div>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
            <div style={css("padding:16px 20px 10px;")}><h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Por canal</h2></div>
            <div style={css("display:grid;grid-template-columns:1.4fr 1fr 1fr .8fr 1fr .8fr;gap:8px;padding:0 20px 8px;")}>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>CANAL</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>ALCANCE</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>ENGAJAMENTO</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>CLIQUES</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>CONVERSAS</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>TEND.</span>
            </div>
            {(v.canaisPerf || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
              <div style={css("display:grid;grid-template-columns:1.4fr 1fr 1fr .8fr 1fr .8fr;gap:8px;padding:12px 20px;border-top:1px solid #F0F5F6;align-items:center;")}>
                <span style={css("display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:#0E353D;")}><span style={css(`width:22px;height:22px;border-radius:7px;background:${c.cor};color:#FFFFFF;font-size:9px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;`)}>{c.sigla}</span>{c.canal}</span>
                <span style={css("font-size:13px;color:#41565D;")}>{c.alcance}</span>
                <span style={css("font-size:13px;color:#41565D;")}>{c.eng}</span>
                <span style={css("font-size:13px;color:#41565D;")}>{c.cliques}</span>
                <span style={css("font-size:13px;font-weight:600;color:#0E353D;")}>{c.conversas}</span>
                <span style={css(`font-size:12px;font-weight:600;color:${c.tendCor};`)}>{c.tend}</span>
              </div>
            </Fragment>))}
          </div>
          <div style={css("display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:16px;align-items:start;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
              <div style={css("padding:16px 20px 10px;")}><h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>O que mais funcionou</h2></div>
              {(v.topPosts || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                <HoverEl as="div" style={css("display:flex;gap:12px;align-items:center;padding:12px 20px;border-top:1px solid #F0F5F6;cursor:pointer;")} hoverStyle={css("background:#F8FBFB;")} onClick={p.onAbrir}>
                  <span style={css(`width:46px;height:46px;border-radius:11px;background:${p.grad};flex-shrink:0;`)}></span>
                  <div style={css("min-width:0;flex:1;")}>
                    <strong style={css("font-size:13px;color:#0E353D;")}>{p.titulo}</strong>
                    <p style={css("margin:3px 0 0;font-size:11.5px;color:#8AA6AD;")}>{p.alcanceTexto}</p>
                  </div>
                  <span style={css("font-size:11.5px;color:#8AA6AD;")}>{p.pubRotulo}</span>
                </HoverEl>
              </Fragment>))}
            </div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;")}>
              <div style={css("display:flex;align-items:baseline;gap:10px;margin-bottom:4px;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Custo de IA</h2>
                <span style={css("flex:1;")}></span>
                <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:18px;color:#0E353D;")}>{v.custoTotal}</strong>
              </div>
              <p style={css("margin:0 0 14px;font-size:11.5px;color:#8AA6AD;")}>{v.custoPct} do teto mensal de {v.custoTeto} · alerta em 80%</p>
              <div style={css("display:grid;gap:10px;")}>
                {(v.custos || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                  <div style={css("display:grid;gap:5px;")}>
                    <div style={css("display:flex;align-items:baseline;gap:8px;")}>
                      <span style={css("font-size:12.5px;font-weight:600;color:#0E353D;flex:1;")}>{c.agente}</span>
                      <span style={css("font-size:12.5px;color:#41565D;")}>{c.v}</span>
                      <span style={css("font-size:11px;color:#8AA6AD;width:34px;text-align:right;")}>{c.pct}</span>
                    </div>
                    <div style={css("height:6px;border-radius:999px;background:#EEF3F4;overflow:hidden;")}><div style={css(`height:100%;width:${c.barra};background:linear-gradient(90deg,#0FC2C0,#3A7BDC);`)}></div></div>
                    <span style={css("font-size:10.5px;color:#8AA6AD;")}>{c.runs}</span>
                  </div>
                </Fragment>))}
              </div>
            </div>
          </div>
          <div style={css("display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px;align-items:start;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:9px;")}>
              <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Presença local</h2>
              <div style={css("display:flex;align-items:baseline;gap:10px;")}>
                <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:32px;color:#0E353D;")}>4,6</strong>
                <span style={css("color:#F0B429;font-size:15px;letter-spacing:2px;")}>★★★★★</span>
                <span style={css("font-size:12px;color:#8AA6AD;")}>132 avaliações</span>
              </div>
              <p style={css("margin:0;font-size:12.5px;font-weight:600;color:#0E8A46;")}>+9 no mês — 8 vieram da jornada NPS e avaliações</p>
              <div style={css("border-top:1px solid #F0F5F6;padding-top:11px;display:grid;gap:6px;")}>
                <span style={css("font-size:12.5px;color:#41565D;")}>✓ Perfil do Google conectado e verificado</span>
                <span style={css("font-size:12.5px;color:#41565D;")}>✓ Horários e contato iguais aos do site</span>
                <span style={css("font-size:12.5px;color:#41565D;")}>✓ Publicações do Google saindo da biblioteca</span>
              </div>
            </div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:12px;align-content:start;")}>
              <div style={css("display:flex;align-items:center;gap:8px;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Última avaliação</h2>
                <span style={css("font-size:11.5px;color:#8AA6AD;")}>há 2 dias</span>
              </div>
              <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:13px 15px;")}>
                <div style={css("display:flex;gap:8px;align-items:center;margin-bottom:5px;")}><strong style={css("font-size:12.5px;color:#0E353D;")}>Marcos T.</strong><span style={css("color:#F0B429;font-size:11px;letter-spacing:1px;")}>★★★★★</span></div>
                <p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.55;")}>"Bati o carro numa quinta, na segunda o reparo já estava aprovado. Atendimento que resolve."</p>
              </div>
              <div style={css("border:1px solid #BDE8E7;background:#E6F9F9;border-radius:12px;padding:13px 15px;")}>
                <p style={css("margin:0 0 5px;font-size:10px;font-weight:700;color:#0A8583;letter-spacing:0.06em;")}>RESPOSTA SUGERIDA · TOM DO BRAND BRAIN</p>
                <p style={css("margin:0;font-size:12.5px;color:#0A6462;line-height:1.55;")}>"Que bom ler isso, Marcos! Sinistro resolvido rápido é exatamente o nosso trabalho. Conte com a gente sempre."</p>
              </div>
              {v.repRespondida && (<>
                <p style={css("margin:0;font-size:12.5px;font-weight:600;color:#0E8A46;")}>Resposta publicada e registrada na trilha.</p>
              </>)}
              {v.repBtn && (<>
                <HoverEl as="button" style={css("justify-self:start;padding:9px 16px;border:none;border-radius:11px;background:#0E353D;color:#FFFFFF;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.responder}>Aprovar e publicar resposta</HoverEl>
              </>)}
              <p style={css("margin:0;font-size:11.5px;color:#8AA6AD;line-height:1.55;")}>Resposta a avaliação negativa nunca é automática — sempre passa por você.</p>
            </div>
          </div>
        </section>
      </>
  );
}
