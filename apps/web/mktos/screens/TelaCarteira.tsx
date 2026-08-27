// @ts-nocheck
import { Fragment } from "react";
import { css, HoverEl } from "@/mktos/css";
import { useMktos } from "@/mktos/store";

export default function TelaCarteira() {
  const v = useMktos();
  return (
    <>
        <section style={css("max-width:1180px;display:grid;gap:14px;")} data-screen-label="Audiências">
          <header>
            <h1 style={css("margin:0;font-family:'Sora',Arial,sans-serif;font-size:21px;font-weight:700;color:#0E353D;letter-spacing:-0.01em;")}>Audiências</h1>
            <p style={css("margin:4px 0 0;font-size:13px;color:#5A7A82;")}>Marketing não administra apólices — usa a carteira para saber com quem pode falar, por quê e sob qual regra.</p>
          </header>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
            <div style={css("padding:18px 20px 12px;")}>
              <h2 style={css("margin:0 0 3px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Segmentos disponíveis</h2>
              <p style={css("margin:0;font-size:12.5px;color:#8AA6AD;")}>Cada segmento é uma regra determinística sobre a carteira. Elegível = passou na regra <em>e</em> tem consent ativo.</p>
            </div>
            {(v.audiencias || []).map((a: any, aIdx: number) => (<Fragment key={a.id ?? aIdx}>
              <div style={css("padding:14px 20px;border-top:1px solid #F0F5F6;display:grid;gap:8px;")}>
                <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap;")}>
                  <strong style={css("font-size:13.5px;color:#0E353D;min-width:190px;")}>{a.nome}</strong>
                  <span style={css("font-size:12px;color:#8AA6AD;flex:1;min-width:230px;")}>regra: {a.regra}</span>
                  <span style={css("font-size:12.5px;color:#5A7A82;")}>{a.totalTexto} na regra</span>
                  <strong style={css("font-size:13px;color:#0E8A46;")}>{a.elegTexto} elegíveis</strong>
                  <HoverEl as="button" style={css("padding:7px 14px;border:1px solid #D4DFE2;border-radius:10px;background:#FFFFFF;color:#0E353D;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={a.onUsar}>Usar em campanha</HoverEl>
                </div>
                <div style={css("display:flex;align-items:center;gap:12px;flex-wrap:wrap;")}>
                  <div style={css("flex:1;min-width:180px;height:6px;border-radius:999px;background:#EEF3F4;overflow:hidden;")}><div style={css(`height:100%;width:${a.barra};background:linear-gradient(90deg,#0E353D,#17C964);`)}></div></div>
                  <span style={css("font-size:11.5px;color:#8AA6AD;")}>{a.bloq} bloqueados por consent ou supressão · consent {a.consent}</span>
                  <span style={css("font-size:11.5px;color:#6D5CE7;font-weight:600;")}>{a.uso}</span>
                </div>
              </div>
            </Fragment>))}
          </div>
          <div style={css("display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px;")}>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:20px 22px;")}>
              <h2 style={css("margin:0 0 6px;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>De onde vêm os dados</h2>
              <p style={css("margin:0 0 12px;font-size:12.5px;color:#5A7A82;line-height:1.55;")}>carteira_ago2026.xlsx · 22/08 · 1.284 linhas · 97% das colunas mapeadas pelo <strong style={css("color:#0E353D;")}>SRC-POLICY-FILE v3</strong>, 3% confirmadas por você. Marketing só lê — nada é alterado na carteira.</p>
              <div style={css("display:flex;gap:10px;align-items:center;flex-wrap:wrap;")}>
                <HoverEl as="button" style={css("padding:9px 16px;border:none;border-radius:11px;background:#0E353D;color:#FFFFFF;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("background:#16505C;")} onClick={v.novaCarga}>Atualizar base (CSV/XLSX)</HoverEl>
                <span style={css("font-size:11.5px;color:#8AA6AD;")}>mapeamento versionado e reutilizado</span>
              </div>
              {v.temCarteiraMsg && (<>
                <p style={css("margin:12px 0 0;font-size:12.5px;font-weight:600;color:#0E8A46;line-height:1.5;")}>{v.carteiraMsg}</p>
              </>)}
            </div>
            <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:16px;padding:20px 22px;")}>
              <h2 style={css("margin:0 0 10px;font-family:'Sora',Arial,sans-serif;font-size:15px;font-weight:600;color:#0E353D;")}>Quem nunca recebe</h2>
              <div style={css("display:flex;gap:6px;flex-wrap:wrap;")}>
                {(v.supressoes || []).map((s: any, sIdx: number) => (<Fragment key={s.id ?? sIdx}>
                  <span style={css("background:#FFF0F0;border:1px solid #F5D9D5;border-radius:999px;padding:4px 11px;font-size:11.5px;font-weight:600;color:#C0392B;")}>{s}</span>
                </Fragment>))}
              </div>
              <p style={css("margin:13px 0 0;font-size:11.5px;color:#8AA6AD;line-height:1.55;")}>Supressão vale acima de qualquer campanha ou jornada, inclusive das que rodam em A4. Nenhum agente pode remover uma supressão.</p>
            </div>
          </div>
          <div style={css("background:#FFFFFF;border:1px solid #E3EDEF;border-radius:18px;overflow:hidden;")}>
            <div style={css("padding:18px 20px 12px;")}>
              <h2 style={css("margin:0 0 3px;font-family:'Sora',Arial,sans-serif;font-size:15.5px;font-weight:600;color:#0E353D;")}>Gatilhos individuais desta semana</h2>
              <p style={css("margin:0;font-size:12.5px;color:#8AA6AD;")}>Casos que a regra marcou como oportunidade de comunicação — gerar campanha manda para Compliance antes da sua fila.</p>
            </div>
            {(v.renovacoes || []).map((r: any, rIdx: number) => (<Fragment key={r.id ?? rIdx}>
              <div style={css("display:flex;align-items:center;gap:12px;padding:12px 20px;border-top:1px solid #F0F5F6;flex-wrap:wrap;")}>
                <strong style={css("font-size:13px;color:#0E353D;min-width:150px;")}>{r.seg}</strong>
                <span style={css("font-size:12.5px;color:#5A7A82;flex:1;min-width:170px;")}>{r.produto}</span>
                <span style={css("font-size:12px;color:#8AA6AD;min-width:118px;")}>{r.vence}</span>
                <span style={css(`background:${r.chipBg};color:${r.chipCor};padding:2px 9px;border-radius:999px;font-size:10.5px;font-weight:700;`)}>{r.stTexto}</span>
                {r.gerado && (<>
                  <span style={css("font-size:12.5px;font-weight:600;color:#0E8A46;")}>campanha criada →</span>
                </>)}
                {r.podeGerar && (<>
                  <HoverEl as="button" style={css("padding:7px 14px;border:1px solid #D4DFE2;border-radius:10px;background:#FFFFFF;color:#0E353D;font-size:12.5px;font-weight:600;cursor:pointer;")} hoverStyle={css("border-color:#0FC2C0;color:#0A8583;")} onClick={r.onGerar}>Gerar campanha</HoverEl>
                </>)}
              </div>
            </Fragment>))}
          </div>
        </section>
      </>
  );
}
