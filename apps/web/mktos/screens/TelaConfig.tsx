// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaConfig() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1040px;display:grid;gap:14px;")} data-screen-label="Configurações">
          <header>
            <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Configurações</h1>
            <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Canais, quem aprova o quê e o teto de gasto com IA.</p>
          </header>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
            <div style={css("padding:16px 20px 10px;")}><h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Canais conectados</h2></div>
            {(v.canaisConf || []).map((c: any, cIdx: number) => (<Fragment key={c.id ?? cIdx}>
              <div style={css("display:flex;align-items:center;gap:12px;padding:13px 20px;border-top:1px solid #F0F5F6;flex-wrap:wrap;")}>
                <span style={css(`width:30px;height:30px;border-radius:9px;background:${c.cor};color:#FFFFFF;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;flex-shrink:0;`)}>{c.sigla}</span>
                <div style={css("min-width:150px;")}>
                  <strong style={css("font-size:13px;color:#0E353D;")}>{c.id}</strong>
                  <p style={css("margin:1px 0 0;font-size:11.5px;color:#8AA6AD;")}>{c.conta}</p>
                </div>
                <span style={css("font-size:12.5px;color:#5A7A82;flex:1;min-width:200px;")}>{c.detalhe}</span>
                <span style={css(`background:${c.stBg};color:${c.stCor};padding:3px 10px;border-radius:999px;font-size:10px;font-weight:700;`)}>{c.stRotulo}</span>
              </div>
            </Fragment>))}
          </div>
          <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:12px;align-content:start;")}>
              <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Quem aprova</h2>
              <div style={css("display:grid;gap:10px;")}>
                {(v.equipe || []).map((e: any, eIdx: number) => (<Fragment key={e.id ?? eIdx}>
                  <div style={css("display:flex;align-items:center;gap:10px;")}>
                    <span style={css("width:28px;height:28px;border-radius:9px;background:#0E353D;color:#FFFFFF;font-size:10.5px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:'Sora',Arial,sans-serif;")}>{e.ini}</span>
                    <div><strong style={css("font-size:12.5px;color:#0E353D;")}>{e.n}</strong><p style={css("margin:1px 0 0;font-size:11.5px;color:#8AA6AD;")}>{e.p}</p></div>
                  </div>
                </Fragment>))}
              </div>
              <div style={css("border-top:1px solid #F0F5F6;padding-top:12px;display:grid;gap:9px;")}>
                <p style={css("margin:0;font-size:12.5px;color:#5A7A82;line-height:1.55;")}>Grupo <strong style={css("color:#0E353D;")}>Compliance</strong> entra antes de você em todo item de risco alto — hoje {v.grupoRotulo}.</p>
                <HoverEl as="button" style={css("justify-self:start;padding:8px 15px;border:1px solid #D4DFE2;border-radius:11px;background:#FFFFFF;color:#0E353D;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={v.toggleGrupo}>Alternar regra do grupo</HoverEl>
              </div>
            </div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;padding:20px 22px;display:grid;gap:10px;align-content:start;")}>
              <h2 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Orçamento de IA</h2>
              <div style={css("display:flex;align-items:baseline;gap:8px;")}>
                <strong style={css("font-family:'Sora',Arial,sans-serif;font-size:24px;color:#0E353D;")}>{v.custoTotal}</strong>
                <span style={css("font-size:12.5px;color:#8AA6AD;")}>de {v.custoTeto} no mês</span>
              </div>
              <div style={css("height:8px;border-radius:999px;background:#EEF3F4;overflow:hidden;")}><div style={css("height:100%;width:39%;background:linear-gradient(90deg,#0FC2C0,#3A7BDC);")}></div></div>
              <p style={css("margin:0;font-size:12px;color:#8AA6AD;line-height:1.55;")}>Alerta em 80% e corte automático no teto: ao bater o limite, os agentes param de gerar e a fila continua com o que já existe.</p>
              <div style={css("border-top:1px solid #F0F5F6;padding-top:12px;")}>
                <p style={css("margin:0 0 8px;font-size:12.5px;color:#5A7A82;line-height:1.55;")}>Kill switch global: interrompe qualquer ação externa dos agentes, sem apagar o que já foi produzido.</p>
                <HoverEl as="button" style={css(`padding:9px 16px;border:none;border-radius:11px;background:${v.pausaBg};color:#FFFFFF;font-size:12.5px;font-weight:600;cursor:pointer;`)} hoverStyle={css("filter:brightness(1.1);")} onClick={v.togglePausa}>{v.pausaRotulo}</HoverEl>
              </div>
            </div>
          </div>
        </section>
      </>
  );
}
