// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaNewsletter() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1180px;display:grid;gap:14px;")} data-screen-label="Newsletter">
          <header>
            <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Newsletter</h1>
            <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Edição semanal montada a partir de conteúdo já aprovado. Só vai para quem deu opt-in — e cada edição passa pela sua fila.</p>
          </header>
          <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:16px 18px;")}><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:24px;color:#0E353D;")}>{v.nlBase}</strong><p style={css("margin:3px 0 0;font-size:12.5px;color:#5A7A82;")}>assinantes com opt-in</p></div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:16px 18px;")}><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:24px;color:#0E353D;")}>{v.nlAbertura}</strong><p style={css("margin:3px 0 0;font-size:12.5px;color:#5A7A82;")}>abertura média</p></div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:16px 18px;")}><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:24px;color:#0E353D;")}>{v.nlCliques}</strong><p style={css("margin:3px 0 0;font-size:12.5px;color:#5A7A82;")}>cliques por edição</p></div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:16px 18px;")}><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:24px;color:#0E353D;")}>{v.nlDesinscr}</strong><p style={css("margin:3px 0 0;font-size:12.5px;color:#5A7A82;")}>descadastro (limite 0,5%)</p></div>
          </div>
          <div style={css("display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:14px;align-items:start;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:13px;align-content:start;")}>
              <div>
                <h2 style={css("margin:0 0 3px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Montar a edição #21</h2>
                <p style={css("margin:0;font-size:12.5px;color:#8AA6AD;")}>A lista abaixo é o conteúdo real do sistema. Só o que já está aprovado ou publicado pode entrar — o resto aparece travado com o motivo.</p>
              </div>
              <div style={css("display:grid;gap:8px;max-height:330px;overflow-y:auto;")}>
                {(v.nlBlocos || []).map((b: any, bIdx: number) => (<Fragment key={b.id ?? bIdx}>
                  <HoverEl as="div" style={css("display:flex;gap:11px;align-items:flex-start;padding:11px 13px;border:1px solid #E9F1F2;border-radius:12px;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;")} onClick={b.onToggle}>
                    <span style={css(`width:19px;height:19px;border-radius:6px;border:1.5px solid ${b.checkBorda};background:${b.checkBg};color:${b.checkCor};font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;`)}>{b.check}</span>
                    <div style={css("min-width:0;flex:1;")}>
                      <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap;")}>
                        {b.sel && (<>
                          <span style={css("font-family:'Sora',Arial,sans-serif;font-size:10.5px;font-weight:700;color:#0A8583;")}>{b.ordem}</span>
                        </>)}
                        <strong style={css(`font-size:12.5px;color:${b.tCor};`)}>{b.t}</strong>
                        <span style={css("background:#F4F7F8;color:#5A7A82;padding:1px 8px;border-radius:999px;font-size:10px;font-weight:600;")}>{b.vertical}</span>
                      </div>
                      <p style={css("margin:3px 0 0;font-size:11.5px;color:#8AA6AD;line-height:1.45;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;")}>{b.snippet}</p>
                      <p style={css("margin:2px 0 0;font-size:11px;color:#8AA6AD;")}>{b.o}</p>
                    </div>
                    {b.sel && (<>
                      <div style={css("display:grid;gap:3px;flex-shrink:0;")}>
                        <HoverEl as="span" style={css("width:22px;height:18px;border:1px solid #D4DFE2;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#5A7A82;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={b.onSubir}>▲</HoverEl>
                        <HoverEl as="span" style={css("width:22px;height:18px;border:1px solid #D4DFE2;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#5A7A82;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={b.onDescer}>▼</HoverEl>
                      </div>
                    </>)}
                  </HoverEl>
                </Fragment>))}
              </div>
              <div style={css("display:flex;gap:9px;align-items:center;flex-wrap:wrap;")}>
                <HoverEl as="button" style={css("padding:10px 17px;border:none;border-radius:11px;background:#0E353D;color:#FFFFFF;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.montarEdicao}>Montar e mandar para a fila</HoverEl>
                <HoverEl as="button" style={css("padding:10px 16px;border:1px solid #D4DFE2;border-radius:11px;background:#FFFFFF;color:#0E353D;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={v.enviarTeste}>Enviar teste</HoverEl>
                <span style={css("font-size:11.5px;color:#8AA6AD;")}>{v.nlCfg.cadencia}</span>
              </div>
              {v.temNlMsg && (<>
                <p style={css("margin:0;font-size:12.5px;font-weight:600;color:#0E8A46;")}>{v.nlMsg}</p>
              </>)}
            </div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:12px;align-content:start;")}>
              <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Listas e consent</h2>
              <div style={css("display:grid;gap:10px;")}>
                {(v.nlSegmentos || []).map((s: any, sIdx: number) => (<Fragment key={s.id ?? sIdx}>
                  <div style={css("display:grid;gap:2px;")}>
                    <div style={css("display:flex;gap:8px;align-items:baseline;")}>
                      <strong style={css("font-size:12.5px;color:#0E353D;flex:1;")}>{s.n}</strong>
                      <span style={css("font-family:'Sora',Arial,sans-serif;font-size:13px;font-weight:600;color:#0E353D;")}>{s.p}</span>
                    </div>
                    <span style={css("font-size:11.5px;color:#8AA6AD;")}>{s.d}</span>
                  </div>
                </Fragment>))}
              </div>
              <p style={css("margin:0;font-size:11.5px;color:#8AA6AD;line-height:1.55;border-top:1px solid #F0F5F6;padding-top:12px;")}>Descadastro é irreversível e vale para todos os canais: sai da newsletter, sai das jornadas. Nenhum agente pode reinscrever.</p>
            </div>
          </div>

          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;")}>
            <h2 style={css("margin:0 0 3px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Modelos</h2>
            <p style={css("margin:0 0 14px;font-size:12.5px;color:#8AA6AD;")}>O modelo define a estrutura do e-mail — a prévia abaixo muda na hora.</p>
            <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;")}>
              {(v.nlModelos || []).map((m: any, mIdx: number) => (<Fragment key={m.id ?? mIdx}>
                <HoverEl as="div" style={css(`border:1px solid ${m.borda};background:${m.bg};border-radius:14px;padding:13px;cursor:pointer;display:grid;gap:9px;align-content:start;`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={m.onClick}>
                  <div style={css("background:#F4F1EA;border:1px solid #E4DFD2;border-radius:9px;padding:8px;display:grid;gap:4px;min-height:78px;align-content:start;")}>
                    {(m.thumb || []).map((t: any, tIdx: number) => (<Fragment key={t.id ?? tIdx}>
                      <div style={css(`height:${t.h}px;width:${t.w};background:${t.c};border-radius:3px;`)}></div>
                    </Fragment>))}
                  </div>
                  <div style={css("display:flex;align-items:center;gap:7px;")}>
                    <strong style={css(`font-family:'Sora',Arial,sans-serif;font-size:13px;color:${m.tCor};flex:1;`)}>{m.t}</strong>
                    {m.temSelo && (<>
                      <span style={css("background:#E6F9F9;color:#0A8583;padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:700;")}>{m.selo}</span>
                    </>)}
                  </div>
                  <p style={css("margin:0;font-size:11.5px;color:#5A7A82;line-height:1.45;")}>{m.d}</p>
                  <p style={css("margin:0;font-size:11px;color:#8AA6AD;line-height:1.45;")}>{m.blocos} · ideal para {m.ideal}</p>
                </HoverEl>
              </Fragment>))}
            </div>
          </div>

          <div style={css("display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:14px;align-items:start;")}>
            <div style={css("min-width:0;background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:12px;align-content:start;")}>
              <div style={css("display:flex;align-items:center;gap:8px;flex-wrap:wrap;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Prévia do e-mail</h2>
                <span style={css("font-size:11.5px;color:#8AA6AD;")}>{v.nlPrevia.n} conteúdos · modelo {v.nlCfg.modelo}</span>
              </div>
              <div style={css("border:1px solid #E3EDEF;border-radius:14px;overflow:hidden;background:#F4F1EA;")}>
                <div style={css("background:#1B3A5C;padding:14px 18px;display:flex;align-items:center;gap:9px;")}>
                  <span style={css("font-family:'Sora',Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;flex:1;")}>{v.nlCfg.remetente}</span>
                  <span style={css("font-size:10.5px;color:#A9C3D6;")}>edição #21</span>
                </div>
                <div style={css("padding:16px 18px;display:grid;gap:12px;")}>
                  <div>
                    <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:700;color:#1B3A5C;line-height:1.3;")}>{v.nlCfg.assunto}</p>
                    <p style={css("margin:3px 0 0;font-size:11.5px;color:#6C7C88;")}>{v.nlCfg.preheader}</p>
                  </div>
                  {v.nlPrevia.temHero && (<>
                    <div style={css("border-radius:11px;overflow:hidden;background:#FFFFFF;border:1px solid #E4DFD2;")}>
                      <div style={css(`height:${v.nlPrevia.heroAlto};background:${v.nlPrevia.heroGrad};`)}></div>
                      <div style={css("padding:12px 14px;")}>
                        <strong style={css("font-size:13px;color:#1B3A5C;line-height:1.35;")}>{v.nlPrevia.heroTitulo}</strong>
                        <p style={css("margin:5px 0 0;font-size:11.5px;color:#5A6672;line-height:1.5;white-space:pre-wrap;")}>{v.nlPrevia.heroTexto}</p>
                        <p style={css("margin:8px 0 0;font-size:11px;font-weight:700;color:#E8A33D;")}>LER MAIS →</p>
                      </div>
                    </div>
                  </>)}
                  {(v.nlPrevia.itens || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                    <div style={css("background:#FFFFFF;border:1px solid #E4DFD2;border-radius:11px;padding:12px 14px;display:flex;gap:10px;")}>
                      {v.nlPrevia.numerada && (<>
                        <span style={css("font-family:'Sora',Arial,sans-serif;font-size:13px;font-weight:700;color:#E8A33D;flex-shrink:0;")}>{p.num}</span>
                      </>)}
                      <div style={css("min-width:0;")}>
                        <span style={css("font-size:9.5px;font-weight:700;color:#2E7D5B;letter-spacing:0.06em;")}>{p.vertical}</span>
                        <strong style={css("display:block;margin-top:3px;font-size:12.5px;color:#1B3A5C;line-height:1.35;")}>{p.titulo}</strong>
                        <p style={css("margin:4px 0 0;font-size:11.5px;color:#5A6672;line-height:1.5;")}>{p.texto}</p>
                      </div>
                    </div>
                  </Fragment>))}
                  {v.nlPrevia.temCta && (<>
                    <div style={css("background:#1B3A5C;border-radius:11px;padding:13px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;")}>
                      <p style={css("margin:0;font-size:11.5px;color:#C9DAE6;line-height:1.45;flex:1;min-width:120px;")}>Dúvida sobre a sua apólice?</p>
                      <span style={css("background:#E8A33D;color:#3A2400;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;")}>{v.nlPrevia.ctaTexto}</span>
                    </div>
                  </>)}
                  {v.nlPrevia.vazia && (<>
                    <p style={css("margin:0;font-size:12px;color:#8AA6AD;background:#FFFFFF;border:1px dashed #D4DFE2;border-radius:11px;padding:16px;text-align:center;")}>Nenhum conteúdo selecionado — marque itens aprovados na lista ao lado.</p>
                  </>)}
                  <div style={css("border-top:1px solid #E4DFD2;padding-top:11px;")}>
                    <p style={css("margin:0;font-size:9.5px;color:#8A9099;line-height:1.6;")}>Horizonte Seguros Corretora Ltda · CNPJ 12.345.678/0001-90 · Av. Paulista 1000, São Paulo/SP<br />Você recebe porque é cliente e autorizou contato. <span style={css("text-decoration:underline;")}>Descadastrar</span> · <span style={css("text-decoration:underline;")}>Política de privacidade</span></p>
                  </div>
                </div>
              </div>
            </div>

            <div style={css("min-width:0;background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:16px;align-content:start;")}>
              <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Configuração</h2>
              <div style={css("display:grid;gap:11px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>ASSUNTO E PREHEADER</p>
                <input style={css("min-width:0;padding:10px 13px;border:1px solid #D4DFE2;border-radius:11px;font-size:12.5px;color:#1A2C31;outline-color:#0FC2C0;")} size="1" value={v.nlCfg.assunto} onChange={v.setNlAssunto} />
                <input style={css("min-width:0;padding:10px 13px;border:1px solid #D4DFE2;border-radius:11px;font-size:12.5px;color:#41565D;outline-color:#0FC2C0;")} size="1" value={v.nlCfg.preheader} onChange={v.setNlPreheader} />
                <span style={css("font-size:11px;color:#8AA6AD;")}>O assunto entra em teste A/B automático com 20% da lista antes do envio geral.</span>
              </div>
              <div style={css("display:grid;gap:11px;border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>REMETENTE</p>
                <input style={css("min-width:0;padding:10px 13px;border:1px solid #D4DFE2;border-radius:11px;font-size:12.5px;color:#1A2C31;outline-color:#0FC2C0;")} size="1" value={v.nlCfg.remetente} onChange={v.setNlRemetente} />
                <div style={css("display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;")}>
                  <input style={css("min-width:0;padding:10px 13px;border:1px solid #D4DFE2;border-radius:11px;font-size:12px;color:#41565D;outline-color:#0FC2C0;")} size="1" value={v.nlCfg.email} onChange={v.setNlEmail} />
                  <input style={css("min-width:0;padding:10px 13px;border:1px solid #D4DFE2;border-radius:11px;font-size:12px;color:#41565D;outline-color:#0FC2C0;")} size="1" value={v.nlCfg.reply} onChange={v.setNlReply} />
                </div>
                <span style={css("font-size:11px;color:#8AA6AD;")}>Domínio verificado com SPF, DKIM e DMARC — sem isso o envio fica bloqueado.</span>
              </div>
              <div style={css("display:grid;gap:9px;border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>O QUE SAI NESTA EDIÇÃO</p>
                <div style={css("display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;")}>
                  <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:11px;padding:10px 12px;")}><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:15px;color:#0E353D;")}>{v.nlEstim.dest}</strong><p style={css("margin:1px 0 0;font-size:11px;color:#8AA6AD;")}>destinatários</p></div>
                  <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:11px;padding:10px 12px;")}><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:15px;color:#0E353D;")}>{v.nlEstim.blocos}</strong><p style={css("margin:1px 0 0;font-size:11px;color:#8AA6AD;")}>{v.nlEstim.leitura}</p></div>
                </div>
                <span style={css("font-size:11px;color:#8AA6AD;")}>{v.nlEstim.reenvio}</span>
              </div>
              <div style={css("display:grid;gap:9px;border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>CADÊNCIA</p>
                <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
                  {(v.nlCadencias || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                    <HoverEl as="span" style={css(`padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;background:${c.bg};color:${c.cor};border:1px solid ${c.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={c.onClick}>{c.t}</HoverEl>
                  </Fragment>))}
                </div>
              </div>
              <div style={css("display:grid;gap:9px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>LISTA DE ENVIO</p>
                <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
                  {(v.nlListas || []).map((l: any, lIdx: number) => (<Fragment key={l.id ?? lIdx}>
                    <HoverEl as="span" style={css(`padding:7px 13px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;background:${l.bg};color:${l.cor};border:1px solid ${l.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={l.onClick}>{l.t}</HoverEl>
                  </Fragment>))}
                </div>
              </div>
              <div style={css("display:grid;gap:10px;border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>AUTOMAÇÃO</p>
                {(v.nlAutoLinhas || []).map((a: any, aIdx: number) => (<Fragment key={a.id ?? aIdx}>
                  <div style={css("display:flex;gap:10px;align-items:flex-start;cursor:pointer;")} onClick={a.onToggle}>
                    <span style={css(`width:18px;height:18px;border-radius:6px;border:1.5px solid ${a.borda};background:${a.bg};color:${a.cor};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;`)}>{a.check}</span>
                    <div style={css("min-width:0;")}>
                      <p style={css("margin:0;font-size:12.5px;font-weight:600;color:#0E353D;")}>{a.t}</p>
                      <p style={css("margin:1px 0 0;font-size:11px;color:#8AA6AD;line-height:1.45;")}>{a.d}</p>
                    </div>
                  </div>
                </Fragment>))}
              </div>
              <div style={css("display:grid;gap:9px;border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>RASTREAMENTO</p>
                <div style={css("display:flex;gap:10px;align-items:center;cursor:pointer;")} onClick={v.toggleUtm}>
                  <span style={css(`width:18px;height:18px;border-radius:6px;border:1.5px solid ${v.nlUtmBorda};background:${v.nlUtmBg};color:${v.nlUtmCor};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;`)}>{v.nlUtmCheck}</span>
                  <span style={css("font-size:12.5px;color:#41565D;")}>UTM automático por edição e por bloco</span>
                </div>
                <div style={css("display:flex;gap:10px;align-items:center;cursor:pointer;")} onClick={v.togglePixel}>
                  <span style={css(`width:18px;height:18px;border-radius:6px;border:1.5px solid ${v.nlPixelBorda};background:${v.nlPixelBg};color:${v.nlPixelCor};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;`)}>{v.nlPixelCheck}</span>
                  <span style={css("font-size:12.5px;color:#41565D;")}>Medir abertura (pixel) e cliques</span>
                </div>
              </div>
              <div style={css("display:grid;gap:9px;border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>RODAPÉ OBRIGATÓRIO</p>
                <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
                  <span style={css("background:#EDFCF2;border:1px solid #BFE9CF;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;color:#0E8A46;")}>✓ CNPJ e endereço</span>
                  <span style={css("background:#EDFCF2;border:1px solid #BFE9CF;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;color:#0E8A46;")}>✓ descadastro em 1 clique</span>
                  <span style={css("background:#EDFCF2;border:1px solid #BFE9CF;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;color:#0E8A46;")}>✓ política de privacidade</span>
                  <span style={css("background:#EDFCF2;border:1px solid #BFE9CF;border-radius:999px;padding:4px 10px;font-size:11px;font-weight:600;color:#0E8A46;")}>✓ motivo do recebimento</span>
                </div>
                <span style={css("font-size:11px;color:#8AA6AD;line-height:1.5;")}>Não é configurável: sem esses elementos, o Gateway recusa o envio.</span>
              </div>
              <div style={css("display:grid;gap:9px;border-top:1px solid #F0F5F6;padding-top:14px;")}>
                <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>TESTE ANTES DE ENVIAR</p>
                <div style={css("display:flex;gap:8px;flex-wrap:wrap;")}>
                  <input style={css("flex:1 1 140px;min-width:0;padding:10px 13px;border:1px solid #D4DFE2;border-radius:11px;font-size:12px;color:#41565D;outline-color:#0FC2C0;")} size="1" value={v.nlCfg.teste} onChange={v.setNlTeste} />
                  <HoverEl as="button" style={css("padding:10px 16px;border:1px solid #D4DFE2;border-radius:11px;background:#FFFFFF;color:#0E353D;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={v.enviarTeste}>Enviar teste</HoverEl>
                </div>
              </div>
            </div>
          </div>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
            <div style={css("padding:16px 20px 10px;")}><h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Edições</h2></div>
            <div style={css("display:grid;grid-template-columns:minmax(0,2fr) .9fr 1fr 1fr .7fr .7fr 92px;gap:8px;padding:0 20px 8px;")}>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>EDIÇÃO</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>STATUS</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>QUANDO</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>ENVIOS</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>ABERT.</span>
              <span style={css("font-size:10.5px;font-weight:700;color:#8AA6AD;letter-spacing:0.06em;")}>CLIQUES</span>
              <span></span>
            </div>
            {(v.nlEdicoes || []).map((e: any, eIdx: number) => (<Fragment key={e.id ?? eIdx}>
              <div style={css("display:grid;grid-template-columns:minmax(0,2fr) .9fr 1fr 1fr .7fr .7fr 92px;gap:8px;padding:12px 20px;border-top:1px solid #F0F5F6;align-items:center;")}>
                <strong style={css("font-size:12.5px;color:#0E353D;min-width:0;")}>{e.n}</strong>
                <span style={css(`justify-self:start;background:${e.stBg};color:${e.stCor};padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;`)}>{e.st}</span>
                <span style={css("font-size:12.5px;color:#5A7A82;")}>{e.quando}</span>
                <span style={css("font-size:12.5px;color:#5A7A82;")}>{e.envios}</span>
                <span style={css("font-size:12.5px;font-weight:600;color:#0E353D;")}>{e.ab}</span>
                <span style={css("font-size:12.5px;color:#41565D;")}>{e.cl}</span>
                <HoverEl as="button" style={css("justify-self:end;padding:6px 11px;border:1px solid #D4DFE2;border-radius:9px;background:#FFFFFF;color:#0E353D;font-size:11.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={e.onDuplicar}>Duplicar</HoverEl>
              </div>
            </Fragment>))}
          </div>
        </section>
      </>
  );
}
