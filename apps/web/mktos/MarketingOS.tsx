"use client";
// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";
import TelaHoje from "@/mktos/screens/TelaHoje";
import TelaAprovacoes from "@/mktos/screens/TelaAprovacoes";
import TelaConteudo from "@/mktos/screens/TelaConteudo";
import TelaCalendario from "@/mktos/screens/TelaCalendario";
import TelaAgenda from "@/mktos/screens/TelaAgenda";
import TelaJornadas from "@/mktos/screens/TelaJornadas";
import TelaNewsletter from "@/mktos/screens/TelaNewsletter";
import TelaDesempenho from "@/mktos/screens/TelaDesempenho";
import TelaCarteira from "@/mktos/screens/TelaCarteira";
import TelaMarca from "@/mktos/screens/TelaMarca";
import TelaAgentes from "@/mktos/screens/TelaAgentes";
import TelaConfig from "@/mktos/screens/TelaConfig";

export default function MarketingOS() {
  const v = useMktos();
  return (
    <>

<div style={css("display:flex;height:100vh;overflow:hidden;background:#F0F7F8;color:#1A2C31;font-family:'Inter',Arial,sans-serif;")}>

  <aside style={css("width:236px;flex-shrink:0;background:#0B1115;background-image:radial-gradient(circle at 0% 100%, rgba(15,194,192,0.16) 0%, rgba(11,17,21,0) 55%);display:flex;flex-direction:column;overflow-y:auto;")}>
    <div style={css("padding:22px 20px 18px;display:flex;align-items:center;gap:9px;")}>
      <span style={css("width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#6D5CE7,#0FC2C0);display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;font-size:13px;font-weight:700;color:#FFFFFF;")}>O</span>
      <div style={css("min-width:0;")}>
        <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:14px;font-weight:600;color:#FFFFFF;line-height:1.2;")}>Marketing OS</p>
        <p style={css("margin:0;font-size:10.5px;color:#7FA2AB;letter-spacing:0.04em;")}>por Olga AI</p>
      </div>
    </div>

    <nav style={css("padding:0 12px 8px;display:grid;gap:16px;")}>
      {(v.grupos || []).map((g: any, gIdx: number) => (<Fragment key={g.id ?? gIdx}>
        <div style={css("display:grid;gap:2px;")}>
          <p style={css("margin:0 8px 6px;font-size:9.5px;font-weight:700;letter-spacing:0.11em;color:#5C7B84;")}>{g.rotulo}</p>
          {(g.itens || []).map((n: any, nIdx: number) => (<Fragment key={n.id ?? nIdx}>
            <HoverEl as="div" style={css(`display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;cursor:pointer;background:${n.bg};`)} hoverStyle={css("background:rgba(255,255,255,0.07);")} onClick={n.onClick}>
              <svg style={css("flex-shrink:0;")} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={n.cor} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={n.icone} /></svg>
              <span style={css(`flex:1;font-size:13px;font-weight:${n.peso};color:${n.cor};`)}>{n.rotulo}</span>
              {n.temBadge && (<>
                <span style={css(`min-width:19px;height:19px;padding:0 6px;border-radius:999px;background:${n.badgeBg};color:${n.badgeCor};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;`)}>{n.badge}</span>
              </>)}
            </HoverEl>
          </Fragment>))}
        </div>
      </Fragment>))}
    </nav>

    <div style={css("flex:1;min-height:14px;")}></div>
    <div style={css("margin:0 12px 14px;padding:13px 14px;border-radius:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);")}>
      <p style={css("margin:0 0 7px;font-size:11px;color:#7FA2AB;line-height:1.5;")}>Autonomia dos agentes hoje</p>
      <div style={css("display:flex;align-items:center;gap:7px;")}>
        <span style={css(`width:7px;height:7px;border-radius:50%;background:${v.statusCor};animation:om-pulse 2.4s ease-in-out infinite;`)}></span>
        <span style={css("font-size:12px;font-weight:600;color:#FFFFFF;")}>{v.statusTexto}</span>
      </div>
      <p style={css("margin:8px 0 0;font-size:11px;color:#7FA2AB;line-height:1.5;")}>Nada publica sem sua decisão acima de risco baixo.</p>
    </div>
  </aside>

  <main style={css("flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;")}>
    <header style={css("flex-shrink:0;background:#FFFFFF;border-bottom:1px solid #E3EDEF;padding:0 26px;height:60px;display:flex;align-items:center;gap:16px;")}>
      <div style={css("flex:1 1 auto;min-width:120px;overflow:hidden;")}>
        <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.09em;color:#8AA6AD;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{v.etapaAtual}</p>
        <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{v.tituloTela}</p>
      </div>
      <div style={css("display:flex;align-items:center;gap:7px;background:#F4F7F8;border:1px solid #E3EDEF;border-radius:10px;padding:7px 12px;flex:0 1 220px;min-width:0;")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8AA6AD" strokeWidth="1.9" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input style={css("border:none;background:transparent;outline:none;font-size:12.5px;color:#1A2C31;width:100%;")} value={v.busca} onChange={v.setBusca} placeholder="Buscar conteúdo, pauta, cliente…" />
      </div>
      <HoverEl as="button" style={css("display:flex;align-items:center;gap:8px;padding:8px 15px;border:none;border-radius:10px;background:linear-gradient(130deg,#6D5CE7 0%,#3A7BDC 60%,#0FC2C0 130%);color:#FFFFFF;font-size:12.5px;font-weight:600;cursor:pointer;flex-shrink:0;")} hoverStyle={css("filter:brightness(1.08);")} onClick={v.abrirCopilot}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5c-1.6 0-3.1-.4-4.4-1.2L3 20l1.2-5.1A8.4 8.4 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5z" /></svg>
        Pedir para a Olga
      </HoverEl>
      <div style={css("display:flex;align-items:center;gap:9px;padding-left:14px;border-left:1px solid #E9F1F2;flex-shrink:0;")}>
        <span style={css("width:30px;height:30px;border-radius:9px;background:#0E353D;color:#FFFFFF;font-size:11.5px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;")}>FA</span>
        <div>
          <p style={css("margin:0;font-size:12px;font-weight:600;color:#0E353D;line-height:1.2;")}>{v.workspace}</p>
          <p style={css("margin:0;font-size:10.5px;color:#8AA6AD;")}>Fernanda · OWNER</p>
        </div>
      </div>
    </header>

    <div style={css("flex:1;overflow-y:auto;padding:24px 26px 60px;")}>

{v.telaHoje && (<><TelaHoje /></>)}
{v.telaAprovacoes && (<><TelaAprovacoes /></>)}
{v.telaConteudo && (<><TelaConteudo /></>)}
{v.telaCalendario && (<><TelaCalendario /></>)}
{v.telaAgenda && (<><TelaAgenda /></>)}
{v.telaJornadas && (<><TelaJornadas /></>)}
{v.telaNewsletter && (<><TelaNewsletter /></>)}
{v.telaDesempenho && (<><TelaDesempenho /></>)}
{v.telaCarteira && (<><TelaCarteira /></>)}
{v.telaMarca && (<><TelaMarca /></>)}
{v.telaAgentes && (<><TelaAgentes /></>)}
{v.telaConfig && (<><TelaConfig /></>)}
    </div>
  </main>

  {v.onbAberto && (<>
    <div style={css("position:fixed;inset:0;z-index:70;display:flex;background:#F0F7F8;")} data-screen-label="Onboarding">
      <aside style={css("width:284px;flex-shrink:0;background:#0B1115;background-image:radial-gradient(circle at 0% 100%, rgba(15,194,192,0.18) 0%, rgba(11,17,21,0) 55%);padding:32px 28px;display:flex;flex-direction:column;")}>
        <div style={css("display:flex;align-items:baseline;gap:8px;margin-bottom:36px;")}>
          <span style={css("font-family:'Sora',Arial,sans-serif;font-size:19px;font-weight:700;color:#FFFFFF;")}>Olga</span>
          <span style={css("font-size:10px;color:#7FA2AB;letter-spacing:0.09em;text-transform:uppercase;font-weight:600;")}>Marketing OS</span>
        </div>
        <div style={css("display:grid;gap:20px;")}>
          {(v.onbPassos || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
            <div style={css("display:flex;gap:12px;align-items:flex-start;")}>
              <span style={css(`width:25px;height:25px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:700;background:${p.bg};color:${p.cor};border:1.5px solid ${p.borda};flex-shrink:0;`)}>{p.marca}</span>
              <div><p style={css(`margin:0;font-size:13px;font-weight:600;color:${p.tCor};`)}>{p.t}</p><p style={css("margin:2px 0 0;font-size:11px;color:#7FA2AB;")}>{p.s}</p></div>
            </div>
          </Fragment>))}
        </div>
        <div style={css("flex:1;")}></div>
        <p style={css("margin:0;font-size:11.5px;color:#7FA2AB;line-height:1.6;")}>O Brand Brain nasce como proposta: o agente extrai, você confirma. Nada publica com marca não confirmada.</p>
      </aside>
      <main style={css("flex:1;overflow-y:auto;")}>
        <div style={css("max-width:680px;margin:0 auto;padding:48px 36px 60px;")}>
          {v.onbP1 && (<>
            <h1 style={css("margin:0 0 8px;font-family:'Sora',Arial,sans-serif;font-size:25px;font-weight:700;color:#0E353D;")}>Vamos montar a marca da corretora</h1>
            <p style={css("margin:0 0 26px;font-size:14px;color:#5A7A82;line-height:1.6;")}>O agente de Brand lê o site e monta o Brand Brain: tom de voz, claims com fonte, paleta e proibições. Você revisa antes de valer.</p>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:24px;display:grid;gap:16px;")}>
              <div style={css("display:grid;gap:6px;")}>
                <label style={css("font-size:13px;font-weight:600;color:#0E353D;")}>Nome da corretora</label>
                <input style={css("padding:11px 14px;border:1px solid #D4DFE2;border-radius:12px;font-size:14px;color:#1A2C31;outline-color:#0FC2C0;")} value={v.onbNome} onChange={v.setOnbNome} />
              </div>
              <div style={css("display:grid;gap:6px;")}>
                <label style={css("font-size:13px;font-weight:600;color:#0E353D;")}>Site</label>
                <input style={css("padding:11px 14px;border:1px solid #D4DFE2;border-radius:12px;font-size:14px;color:#1A2C31;outline-color:#0FC2C0;")} value={v.onbUrl} onChange={v.setOnbUrl} />
                <span style={css("font-size:12px;color:#8AA6AD;")}>Sem site? Dá para começar por Instagram ou um PDF institucional.</span>
              </div>
              <HoverEl as="button" style={css("justify-self:start;padding:12px 22px;border:none;border-radius:12px;background:linear-gradient(130deg,#6D5CE7 0%,#3A7BDC 60%,#0FC2C0 130%);color:#FFFFFF;font-size:14px;font-weight:600;cursor:pointer;")} hoverStyle={css("filter:brightness(1.08);")} onClick={v.extrair}>Ler o site e montar a marca</HoverEl>
            </div>
          </>)}
          {v.onbP2 && (<>
            <h1 style={css("margin:0 0 8px;font-family:'Sora',Arial,sans-serif;font-size:25px;font-weight:700;color:#0E353D;")}>Lendo {v.onbUrl}</h1>
            <p style={css("margin:0 0 26px;font-size:14px;color:#5A7A82;line-height:1.6;")}>O agente de Brand roda em A2: extrai e propõe, sem nenhum efeito externo.</p>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:24px;display:grid;gap:15px;")}>
              {(v.onbLeitura || []).map((l: any, lIdx: number) => (<Fragment key={l.id ?? lIdx}>
                <div style={css("display:flex;gap:12px;align-items:flex-start;")}>
                  <span style={css(`width:22px;height:22px;border-radius:50%;border:1.5px solid ${l.cor};color:${l.cor};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;`)}>{l.marca}</span>
                  <div><p style={css("margin:0;font-size:13.5px;font-weight:600;color:#0E353D;")}>{l.t}</p><p style={css("margin:2px 0 0;font-size:12px;color:#8AA6AD;")}>{l.d}</p></div>
                </div>
              </Fragment>))}
            </div>
          </>)}
          {v.onbP3 && (<>
            <h1 style={css("margin:0 0 8px;font-family:'Sora',Arial,sans-serif;font-size:25px;font-weight:700;color:#0E353D;")}>Revise a marca proposta</h1>
            <p style={css("margin:0 0 22px;font-size:14px;color:#5A7A82;line-height:1.6;")}>Ajuste o que não representa a corretora. Isso vira a régua de todo post.</p>
            <div style={css("display:grid;gap:14px;")}>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:20px;display:grid;gap:10px;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Tom de voz</h2>
                <div style={css("display:flex;gap:7px;flex-wrap:wrap;")}>
                  {(v.onbTom || []).map((t: any, tIdx: number) => (<Fragment key={t.id ?? tIdx}>
                    <HoverEl as="span" style={css(`padding:6px 13px;border-radius:999px;font-size:12.5px;font-weight:600;cursor:pointer;background:${t.bg};color:${t.cor};border:1px solid ${t.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={t.onClick}>{t.t}</HoverEl>
                  </Fragment>))}
                </div>
              </div>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:20px;display:grid;gap:11px;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Claims encontrados</h2>
                {(v.onbClaims || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                  <div style={css("display:flex;gap:11px;align-items:center;cursor:pointer;flex-wrap:wrap;")} onClick={c.onToggle}>
                    <span style={css(`width:19px;height:19px;border-radius:6px;border:1.5px solid ${c.checkBorda};background:${c.checkBg};color:#FFFFFF;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`)}>{c.check}</span>
                    <strong style={css("font-size:13px;color:#0E353D;flex:1;min-width:180px;")}>{c.t}</strong>
                    <span style={css("font-size:12px;color:#8AA6AD;")}>{c.f}</span>
                    {c.temWarn && (<>
                      <span style={css("background:#FFF0F0;color:#C0392B;padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;")}>sem fonte</span>
                    </>)}
                  </div>
                </Fragment>))}
                <p style={css("margin:0;font-size:11.5px;color:#8AA6AD;")}>Claim sem fonte não entra em post: o Compliance bloqueia com CLAIM_UNSUPPORTED.</p>
              </div>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:20px;display:grid;gap:12px;")}>
                <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Identidade e tagline</h2>
                <div style={css("display:flex;gap:8px;align-items:center;")}>
                  {(v.onbPaleta || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                    <span style={css(`width:32px;height:32px;border-radius:10px;background:${p};border:1px solid #E3EDEF;`)}></span>
                  </Fragment>))}
                  <span style={css("font-size:11.5px;color:#8AA6AD;margin-left:6px;")}>detectada no site</span>
                </div>
                <input style={css("padding:10px 14px;border:1px solid #D4DFE2;border-radius:11px;font-size:13.5px;color:#1A2C31;outline-color:#0FC2C0;")} value={v.onbTagline} onChange={v.setOnbTagline} />
              </div>
              <HoverEl as="button" style={css("justify-self:start;padding:12px 22px;border:none;border-radius:12px;background:#0E353D;color:#FFFFFF;font-size:14px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.onbSeguir}>Continuar</HoverEl>
            </div>
          </>)}
          {v.onbP4 && (<>
            <h1 style={css("margin:0 0 8px;font-family:'Sora',Arial,sans-serif;font-size:25px;font-weight:700;color:#0E353D;")}>Onde a corretora publica</h1>
            <p style={css("margin:0 0 22px;font-size:14px;color:#5A7A82;line-height:1.6;")}>Sem conexão ativa, a policy bloqueia publicação — você conecta depois, quando quiser.</p>
            <div style={css("display:grid;gap:14px;")}>
              <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:20px;display:flex;gap:8px;flex-wrap:wrap;")}>
                {(v.onbCanais || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
                  <HoverEl as="span" style={css(`padding:8px 16px;border-radius:999px;font-size:13px;font-weight:600;cursor:pointer;background:${c.bg};color:${c.cor};border:1px solid ${c.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={c.onClick}>{c.t}</HoverEl>
                </Fragment>))}
              </div>
              <div style={css("background:#E6F9F9;border:1px solid #BDE8E7;border-radius:16px;padding:18px 20px;")}>
                <p style={css("margin:0 0 4px;font-family:'Sora',Arial,sans-serif;font-size:13.5px;font-weight:600;color:#0A6462;")}>Brand Brain v1 — proposta</p>
                <p style={css("margin:0;font-size:13px;color:#0A6462;line-height:1.6;")}>{v.onbResumo}</p>
              </div>
              <HoverEl as="button" style={css("justify-self:start;padding:12px 24px;border:none;border-radius:12px;background:linear-gradient(130deg,#0A8583,#17C964);color:#FFFFFF;font-size:14px;font-weight:600;cursor:pointer;")} hoverStyle={css("filter:brightness(1.06);")} onClick={v.concluirOnb}>Confirmar marca e entrar</HoverEl>
            </div>
          </>)}
        </div>
      </main>
    </div>
  </>)}

  {v.drawerAberto && (<>
    <div style={css("position:fixed;inset:0;background:rgba(9,26,30,0.34);z-index:40;")} onClick={v.fecharDrawer}></div>
    <aside style={css("position:fixed;top:0;right:0;bottom:0;width:min(520px,100%);background:#FFFFFF;border-left:1px solid #E3EDEF;z-index:41;display:flex;flex-direction:column;animation:om-in .18s ease-out;")}>
      <div style={css("padding:18px 22px;border-bottom:1px solid #E9F1F2;display:flex;align-items:flex-start;gap:12px;")}>
        <div style={css("min-width:0;flex:1;")}>
          <div style={css("display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:5px;")}>
            <span style={css(`background:${v.det.estBg};color:${v.det.estCor};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;`)}>{v.det.estRotulo}</span>
            <span style={css("font-size:11.5px;color:#8AA6AD;")}>v{v.det.versao} · risco {v.det.risco} · {v.det.agente}</span>
          </div>
          <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:17px;font-weight:600;color:#0E353D;line-height:1.3;")}>{v.det.titulo}</h2>
        </div>
        <HoverEl as="span" style={css("cursor:pointer;font-size:20px;color:#8AA6AD;line-height:1;padding:2px 4px;")} hoverStyle={css("color:#0E353D;")} onClick={v.fecharDrawer}>×</HoverEl>
      </div>
      <div style={css("flex:1;overflow-y:auto;padding:18px 22px 26px;display:grid;gap:14px;align-content:start;")}>
        <div style={css(`border-radius:14px;background:${v.det.grad};padding:18px;min-height:130px;display:flex;flex-direction:column;`)}>
          <span style={css("font-family:'Sora',Arial,sans-serif;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);")}>{v.marcaCurta}</span>
          <div style={css("flex:1;")}></div>
          <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:17px;font-weight:600;line-height:1.3;color:#FFFFFF;text-wrap:pretty;")}>{v.det.headline}</p>
        </div>
        <div style={css("display:flex;gap:6px;align-items:center;flex-wrap:wrap;")}>
          {(v.det.tabs || []).map((t: any, tIdx: number) => (<Fragment key={t.id ?? tIdx}>
            <HoverEl as="span" style={css(`display:inline-flex;align-items:center;gap:6px;padding:4px 11px 4px 5px;border-radius:999px;font-size:11.5px;font-weight:600;cursor:pointer;background:${t.bg};color:${t.cor};border:1px solid ${t.borda};`)} hoverStyle={css("border-color:#0FC2C0;")} onClick={t.onClick}><span style={css(`width:16px;height:16px;border-radius:5px;background:${t.canalCor};color:#FFFFFF;font-size:7.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;`)}>{t.sigla}</span>{t.canal}</HoverEl>
          </Fragment>))}
        </div>
        <p style={css("margin:0;font-size:13.5px;line-height:1.65;color:#1A2C31;white-space:pre-wrap;")}>{v.det.corpoAtivo}</p>

        <div style={css("border-top:1px solid #F0F5F6;padding-top:14px;display:grid;gap:9px;")}>
          <p style={css("margin:0;font-size:10.5px;font-weight:700;letter-spacing:0.07em;color:#8AA6AD;")}>HISTÓRICO</p>
          {(v.det.hist || []).map((h: any, hIdx: number) => (<Fragment key={h.id ?? hIdx}>
            <div style={css("display:flex;gap:10px;")}>
              <span style={css("width:7px;height:7px;border-radius:50%;background:#C3D2D6;margin-top:5px;flex-shrink:0;")}></span>
              <div><p style={css("margin:0;font-size:12.5px;color:#41565D;line-height:1.5;")}>{h.t}</p><p style={css("margin:1px 0 0;font-size:11px;color:#8AA6AD;")}>{h.q}</p></div>
            </div>
          </Fragment>))}
        </div>

        {v.det.temMetricas && (<>
          <div style={css("border-top:1px solid #F0F5F6;padding-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px;")}>
            <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:19px;color:#0E353D;")}>{v.det.mAlcance}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>alcance</p></div>
            <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:19px;color:#0E353D;")}>{v.det.mEng}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>engajamento</p></div>
            <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:19px;color:#0E353D;")}>{v.det.mCliques}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>cliques</p></div>
            <div><strong style={css("font-family:'Sora',Arial,sans-serif;font-size:19px;color:#0E353D;")}>{v.det.mConversas}</strong><p style={css("margin:2px 0 0;font-size:11.5px;color:#5A7A82;")}>conversas no WhatsApp</p></div>
          </div>
        </>)}

        {v.det.temReceipt && (<>
          <div style={css("background:#F8FBFB;border:1px solid #E9F1F2;border-radius:12px;padding:12px 14px;")}>
            <p style={css("margin:0 0 3px;font-size:10.5px;font-weight:700;letter-spacing:0.06em;color:#8AA6AD;")}>RECEIPT</p>
            <p style={css("margin:0;font-family:Courier,monospace;font-size:12px;color:#41565D;")}>{v.det.receipt}</p>
          </div>
        </>)}
      </div>
      {v.det.temAcao && (<>
        <div style={css("padding:14px 22px;border-top:1px solid #E9F1F2;display:flex;gap:9px;flex-wrap:wrap;")}>
          <HoverEl as="button" style={css("flex:1;min-width:150px;padding:11px;border:none;border-radius:12px;background:#0E353D;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.det.onPrimaria}>{v.det.primariaRotulo}</HoverEl>
          {v.det.temSecundaria && (<>
            <HoverEl as="button" style={css("padding:11px 16px;border:1px solid #D4DFE2;border-radius:12px;background:#FFFFFF;color:#0E353D;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={v.det.onSecundaria}>{v.det.secundariaRotulo}</HoverEl>
          </>)}
        </div>
      </>)}
    </aside>
  </>)}

  {v.copilotAberto && (<>
    <div style={css("position:fixed;inset:0;background:rgba(9,26,30,0.34);z-index:44;")} onClick={v.fecharCopilot}></div>
    <aside style={css("position:fixed;top:0;right:0;bottom:0;width:min(430px,100%);background:#FFFFFF;border-left:1px solid #E3EDEF;z-index:45;display:flex;flex-direction:column;animation:om-in .18s ease-out;")}>
      <div style={css("padding:16px 20px;border-bottom:1px solid #E9F1F2;display:flex;align-items:center;gap:10px;")}>
        <span style={css("width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#6D5CE7,#0FC2C0);display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;font-size:12px;font-weight:700;color:#FFFFFF;")}>O</span>
        <div style={css("flex:1;")}>
          <p style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:14px;font-weight:600;color:#0E353D;")}>Copilot</p>
          <p style={css("margin:0;font-size:11px;color:#8AA6AD;")}>roteia seu pedido para a capability certa · A3</p>
        </div>
        <HoverEl as="span" style={css("cursor:pointer;font-size:20px;color:#8AA6AD;line-height:1;padding:2px 4px;")} hoverStyle={css("color:#0E353D;")} onClick={v.fecharCopilot}>×</HoverEl>
      </div>
      <div style={css("flex:1;overflow-y:auto;padding:18px 20px;display:grid;gap:12px;align-content:start;")}>
        {(v.chat || []).map((m: any, mIdx: number) => (<Fragment key={m.id ?? mIdx}>
          <div style={css(`justify-self:${m.lado};max-width:86%;background:${m.bg};border:1px solid ${m.borda};border-radius:14px;padding:11px 14px;`)}>
            <p style={css(`margin:0;font-size:13px;line-height:1.6;color:${m.cor};white-space:pre-wrap;`)}>{m.texto}</p>
          </div>
        </Fragment>))}
      </div>
      <div style={css("padding:14px 20px 16px;border-top:1px solid #E9F1F2;display:grid;gap:9px;")}>
        <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
          {(v.chatSugestoes || []).map((s: any, sIdx: number) => (<Fragment key={s.id ?? sIdx}>
            <HoverEl as="span" style={css("padding:5px 11px;border:1px solid #D4DFE2;border-radius:999px;font-size:11.5px;font-weight:600;color:#41565D;cursor:pointer;background:#FFFFFF;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={s.onClick}>{s.t}</HoverEl>
          </Fragment>))}
        </div>
        <div style={css("display:flex;gap:8px;")}>
          <input style={css("flex:1;padding:11px 14px;border:1px solid #D4DFE2;border-radius:12px;font-size:13px;color:#1A2C31;outline-color:#0FC2C0;")} value={v.chatIn} onChange={v.setChatIn} onKeyDown={v.chatKey} placeholder="Peça algo — ex: gere um post sobre chuvas" />
          <HoverEl as="button" style={css("padding:11px 17px;border:none;border-radius:12px;background:#0E353D;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.enviarChat}>Enviar</HoverEl>
        </div>
      </div>
    </aside>
  </>)}

  {v.temToast && (<>
    <div style={css("position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:60;background:#0B1115;color:#FFFFFF;border-radius:13px;padding:13px 18px;display:flex;align-items:center;gap:14px;box-shadow:0 14px 40px rgba(9,26,30,0.28);animation:om-up .2s ease-out;max-width:min(620px,92vw);")}>
      <span style={css("width:8px;height:8px;border-radius:50%;background:#17C964;flex-shrink:0;")}></span>
      <p style={css("margin:0;font-size:13px;line-height:1.5;")}>{v.toastTexto}</p>
      {v.toastTemAcao && (<>
        <HoverEl as="span" style={css("font-size:12.5px;font-weight:700;color:#0FC2C0;cursor:pointer;flex-shrink:0;")} hoverStyle={css("color:#7FE9E8;")} onClick={v.toastAcao}>{v.toastCta}</HoverEl>
      </>)}
    </div>
  </>)}

</div>
</>
  );
}
