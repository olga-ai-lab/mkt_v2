// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaAgenda() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1040px;")} data-screen-label="Agenda editorial">
          <header style={css("margin-bottom:16px;")}>
            <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Agenda editorial</h1>
            <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Pauta é o briefing; post é a peça. Aprovar pauta libera a produção — não publica nada.</p>
          </header>

          {v.pautaVazio && (<>
            <div style={css("background:#FFFFFF;border:1px dashed #C3D2D6;border-radius:18px;padding:44px 24px;text-align:center;")}>
              <p style={css("margin:0 0 6px;font-family:'Sora',Arial,sans-serif;font-size:17px;font-weight:600;color:#0E353D;")}>Setembro ainda não tem pautas.</p>
              <p style={css("margin:0 auto 18px;font-size:13px;color:#5A7A82;max-width:460px;line-height:1.6;")}>O agente de Conteúdo propõe um mês inteiro de uma vez, equilibrando verticais e usando os assuntos que já performaram na sua base.</p>
              <HoverEl as="button" style={css("padding:11px 22px;border:none;border-radius:12px;background:linear-gradient(130deg,#6D5CE7 0%,#3A7BDC 60%,#0FC2C0 130%);color:#FFFFFF;font-size:13.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("filter:brightness(1.08);")} onClick={v.gerarPautas}>Propor pautas de setembro</HoverEl>
            </div>
          </>)}

          {v.pautaGerando && (<>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:40px 24px;text-align:center;")}>
              <p style={css("margin:0 0 8px;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Montando a agenda…</p>
              <p style={css("margin:0;font-size:12.5px;color:#5A7A82;")}>Cruzando Brand Brain, calendário do setor e o que já funcionou na sua base.</p>
            </div>
          </>)}

          {v.pautaPronto && (<>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
              <div style={css("padding:16px 20px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid #F0F5F6;")}>
                <span style={css("font-size:13px;color:#5A7A82;")}><strong style={css("color:#0E353D;")}>{v.nPautaSel}</strong> de 8 pautas selecionadas — desmarque o que não fizer sentido.</span>
                <span style={css("flex:1;")}></span>
                <HoverEl as="button" style={css("padding:10px 18px;border:none;border-radius:11px;background:#0E353D;color:#FFFFFF;font-size:13px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.aprovarPautas}>Aprovar {v.nPautaSel} pautas</HoverEl>
              </div>
              {(v.pautas || []).map((p: any, pIdx: number) => (<Fragment key={p.id ?? pIdx}>
                <HoverEl as="div" style={css("display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid #F0F5F6;cursor:pointer;flex-wrap:wrap;")} hoverStyle={css("background:#F8FBFB;")} onClick={p.onToggle}>
                  <span style={css(`width:19px;height:19px;border-radius:6px;border:1.5px solid ${p.checkBorda};background:${p.checkBg};color:#FFFFFF;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`)}>{p.check}</span>
                  <strong style={css("font-size:13.5px;color:#0E353D;flex:1;min-width:220px;")}>{p.t}</strong>
                  <span style={css("font-size:11.5px;color:#5A7A82;width:96px;")}>{p.v}</span>
                  <span style={css("font-size:11.5px;color:#8AA6AD;width:110px;")}>{p.f}</span>
                  <span style={css("font-size:11.5px;color:#8AA6AD;width:120px;")}>{p.canais}</span>
                  <span style={css("font-size:11.5px;color:#8AA6AD;width:84px;")}>{p.janela}</span>
                  <span style={css(`background:${p.riscoBg};color:${p.riscoCor};padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;`)}>{p.riscoRotulo}</span>
                </HoverEl>
              </Fragment>))}
            </div>
          </>)}

          {v.pautaAprovado && (<>
            <div style={css("background:#EDFCF2;border:1px solid #BFE9CF;border-radius:18px;padding:22px 24px;display:grid;gap:8px;")}>
              <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:16px;color:#0E8A46;")}>Agenda de setembro aprovada — {v.nPautaAprov} pautas em produção.</strong>
              <p style={css("margin:0;font-size:13px;color:#41565D;line-height:1.6;")}>Os 2 primeiros rascunhos já estão sendo escritos e caem na sua fila quando terminarem; o resto entra conforme a janela de cada pauta. Aprovar pauta não publica nada.</p>
              <div style={css("display:flex;gap:9px;flex-wrap:wrap;margin-top:4px;")}>
                <HoverEl as="button" style={css("padding:9px 16px;border:none;border-radius:11px;background:#0E353D;color:#FFFFFF;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.irConteudo}>Ver na esteira</HoverEl>
                <HoverEl as="button" style={css("padding:9px 16px;border:1px solid #BFE9CF;border-radius:11px;background:#FFFFFF;color:#0E8A46;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0E8A46;")} onClick={v.irAprovacoes}>Ir para a fila</HoverEl>
              </div>
            </div>
          </>)}
        </section>
      </>
  );
}
