// @ts-nocheck
/* Lógica do Marketing OS — portada do protótipo original. */
export class DCLogic {
  state: any = {};
  props: any = {};
  _emit: (() => void) | null = null;
  setState(u: any) {
    const patch = typeof u === "function" ? u(this.state) : u;
    this.state = { ...this.state, ...patch };
    if (this._emit) this._emit();
  }
}


const GRAD = [
  'linear-gradient(135deg,#0E353D 0%,#0A8583 100%)',
  'linear-gradient(135deg,#6D5CE7 0%,#3A7BDC 100%)',
  'linear-gradient(135deg,#3A7BDC 0%,#0FC2C0 100%)',
  'linear-gradient(135deg,#0A8583 0%,#17C964 100%)',
  'linear-gradient(135deg,#1B3A5C 0%,#6D5CE7 100%)',
  'linear-gradient(135deg,#0E353D 0%,#6D5CE7 100%)',
];
const CANAL = {
  Instagram: { s: 'IG', c: '#6D5CE7', lim: 'até 2.200 caracteres' },
  Facebook: { s: 'FB', c: '#3A7BDC', lim: 'texto livre' },
  LinkedIn: { s: 'IN', c: '#0E353D', lim: 'até 3.000 caracteres' },
  WhatsApp: { s: 'WA', c: '#17C964', lim: 'lista com consent ativo' },
  'E-mail': { s: '@', c: '#5A7A82', lim: 'assunto + corpo' },
};
const cm = (c) => CANAL[c] || { s: (c || '?').slice(0, 2).toUpperCase(), c: '#5A7A82', lim: '' };
const EST = {
  PAUTA: { r: 'Pauta aprovada', c: '#5A7A82', b: '#EEF3F4' },
  RASCUNHO: { r: 'Rascunho da IA', c: '#2D62B0', b: '#EAF2FD' },
  COMPLIANCE: { r: 'Revisão de compliance', c: '#9A6B00', b: '#FFF8E1' },
  INTERNA: { r: 'Sua aprovação', c: '#9A6B00', b: '#FFF8E1' },
  EXTERNA: { r: 'Com o cliente', c: '#7C3AED', b: '#F4F0FE' },
  AGENDADO: { r: 'Agendado', c: '#0A8583', b: '#E6F9F9' },
  PUBLICANDO: { r: 'Publicando', c: '#0A8583', b: '#E6F9F9' },
  PUBLICADO: { r: 'Publicado', c: '#0E8A46', b: '#EDFCF2' },
  RECUSADO: { r: 'Recusado', c: '#C0392B', b: '#FFF0F0' },
  FALHA: { r: 'Falha na publicação', c: '#C0392B', b: '#FFF0F0' },
};
const RISCO = {
  baixo: { b: '#EDFCF2', c: '#0E8A46' },
  medio: { b: '#FFF8E1', c: '#9A6B00' },
  alto: { b: '#FFF0F0', c: '#C0392B' },
};
const ICON = {
  hoje: 'M3 11l9-8 9 8M5 10v10h14V10',
  aprov: 'M9 12l2 2 4-5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  conteudo: 'M4 7l8-4 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4',
  calendario: 'M4 6h16v15H4zM4 10h16M9 3v4M15 3v4',
  agenda: 'M5 4h11l3 3v13H5zM8 10h8M8 14h8M8 18h5',
  jornada: 'M6 3v11M6 14a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM18 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18 10a9 9 0 0 1-9 9',
  desempenho: 'M4 20V11M10 20V4M16 20v-6M2 20h20',
  carteira: 'M3 8h18v12H3zM8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18',
  marca: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.6 1 1.5 1 2.5h6c0-1 .3-1.9 1-2.5A6 6 0 0 0 12 3z',
  agentes: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.5 6.5l1.5 1.5M16 16l1.5 1.5M17.5 6.5L16 8M8 16l-1.5 1.5',
  alerta: 'M12 4l9 16H3l9-16zM12 10v4M12 17v.5',
  relogio: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l4 2',
  olho: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  email: 'M3 6h18v12H3zM3 6l9 7 9-7',
};
const brl = (v) => 'R$ ' + v.toFixed(2).replace('.', ',');
const chip = (t, sel, onClick) => ({ t, sel, onClick, bg: sel ? '#0E353D' : '#FFFFFF', cor: sel ? '#FFFFFF' : '#5A7A82', borda: sel ? '#0E353D' : '#D4DFE2' });
const mil = (v) => v.toLocaleString('pt-BR');

const variante = (it, canal) => {
  const base = it.corpo;
  if (canal === 'Instagram') return base + '\n\n' + (it.tags || '#seguro #proteção');
  if (canal === 'LinkedIn') return base + '\n\nSe quiser entender como isso se aplica à sua operação, me chame aqui.';
  if (canal === 'E-mail') return 'Assunto: ' + it.titulo + '\n\n' + base + '\n\nAtenciosamente,\nEquipe Horizonte Seguros';
  if (canal === 'WhatsApp') return base.split('\n')[0] + '\n\nQuer que eu revise sua apólice? Responda aqui.';
  return base;
};

class Component extends DCLogic {
  state = {
    tela: 'hoje', busca: '', sel: null, varSel: {}, coment: {}, ag: {}, links: {},
    copilot: false, chatIn: '',
    chat: [{ de: 'olga', t: 'Oi, Fernanda. Posso propor pauta, escrever variante por canal, checar claim contra a marca ou puxar renovações da carteira. O que precisa agora?' }],
    onb: null, onbPasso: 1, onbProg: 0, onbConcluido: false,
    onbNome: 'Corretora Horizonte Seguros', onbUrl: 'www.horizonteseguros.com.br',
    onbTom: { Próximo: true, Didático: true, Consultivo: true, Técnico: false, Formal: false },
    onbClaims: { c1: true, c2: true, c3: false },
    onbCanais: { Instagram: true, Facebook: true, WhatsApp: true, LinkedIn: false },
    onbTagline: 'Seguro explicado do jeito que você entende.',
    filtro: 'TODOS', abaConteudo: 'esteira',
    pautasFase: 'vazio', pautaSel: {}, nPautasAprov: 0,
    jornadaSel: 'j1', carteiraMsg: '', repRespondida: false, pausa: false, grupoTodos: true,
    novoN: 0, toast: null,
    items: [
      { id: 'i1', titulo: '3 perguntas antes de renovar o seguro do carro', headline: 'Antes de renovar, faça 3 perguntas', vertical: 'Renovação', formato: 'Carrossel', grad: 2, canais: ['Instagram', 'Facebook'], estado: 'INTERNA', risco: 'baixo', versao: 1, agente: 'Conteúdo', auton: 'A2', proposta: '2026-08-27T10:00', janela: 'melhor janela: 5ª, 10h', tags: '#renovação #segurodecarro',
        corpo: 'Renovar no automático é o jeito mais fácil de pagar mais caro do que precisa.\n\nAntes de assinar, pergunte: 1) o valor do carro na tabela mudou? 2) mudou seu uso (trabalho, viagem, garagem)? 3) a franquia ainda faz sentido pro seu bolso?\n\nSe qualquer resposta mudou, sua apólice merece uma revisão. É rápido — e costuma render desconto.',
        motivos: [{ marca: '•', texto: 'Conteúdo educativo sem citar preço ou cobertura específica: risco baixo, pode ser aprovado em lote.' }], hist: [{ q: 'há 2 horas', t: 'Conteúdo gerou a v1 a partir da pauta "Renovação sem susto"' }] },
      { id: 'i2', titulo: 'Você sabe o que é assistência 24h?', headline: 'Assistência 24h: o que está incluído', vertical: 'Coberturas', formato: 'Post 1:1', grad: 0, canais: ['Instagram'], estado: 'INTERNA', risco: 'baixo', versao: 2, agente: 'Conteúdo', auton: 'A2', proposta: '2026-08-29T18:30', janela: 'melhor janela: 6ª, 18h30', tags: '#assistência24h #seguroauto', histRotulo: 'ajustada após seu comentário na v1',
        corpo: 'Pneu furado às 23h. Bateria morta no estacionamento. Chave trancada dentro do carro.\n\nAssistência 24h cobre reboque, socorro elétrico, chaveiro e táxi em muitos casos — mas os limites variam por apólice.\n\nQuer saber o que a sua cobre? Manda "assistência" aqui que eu te explico.',
        motivos: [{ marca: '•', texto: 'Texto revisado após seu pedido: tiramos a promessa de "cobertura ilimitada" e trocamos por "limites variam por apólice".' }], hist: [{ q: 'há 1 dia', t: 'Você pediu ajuste: "não prometer ilimitado"' }, { q: 'há 22 horas', t: 'Conteúdo entregou a v2 com o claim corrigido' }] },
      { id: 'i3', titulo: 'Renovação Horizonte: condições 2026', headline: 'Suas condições de renovação 2026', vertical: 'Renovação', formato: 'E-mail', grad: 4, canais: ['E-mail'], estado: 'COMPLIANCE', risco: 'alto', versao: 1, agente: 'Conteúdo', auton: 'A2', proposta: '2026-09-02T09:00', janela: 'disparo individual, sem massa',
        corpo: 'Olá, {{nome}}. Sua apólice de automóvel vence em 12/09.\n\nJá negociamos as condições de renovação com a seguradora e conseguimos manter o valor da franquia. O novo prêmio e as coberturas estão no documento anexo.\n\nSe preferir, respondo por WhatsApp e explico linha por linha.',
        motivos: [{ marca: '⚠', cor: '#C0392B', texto: 'CLAIM_UNSUPPORTED: "conseguimos manter o valor da franquia" não tem fonte na base de evidências — anexe a proposta da seguradora ou remova a frase.' }, { marca: '⚠', cor: '#C0392B', texto: 'Comunicação de renovação com valor é risco ALTO: autonomia máxima A2 e revisão de Compliance obrigatória antes de sair.' }],
        hist: [{ q: 'há 40 minutos', t: 'Conteúdo gerou a v1 a partir de 86 renovações elegíveis na carteira' }, { q: 'há 38 minutos', t: 'Compliance travou o envio com CLAIM_UNSUPPORTED' }] },
      { id: 'i4', titulo: 'Parceria Horizonte + 88i: seguro para entregadores', headline: 'Proteção para quem vive na rua', vertical: 'Institucional', formato: 'Post 1:1', grad: 5, canais: ['LinkedIn', 'Instagram'], estado: 'EXTERNA', risco: 'medio', versao: 1, agente: 'Conteúdo', auton: 'A2', proposta: '2026-09-01T09:00', janela: 'aguardando parceiro',
        corpo: 'Entregador que roda 300 km por semana não pode ficar sem renda por uma queda.\n\nJunto com a 88i, passamos a oferecer proteção para quem trabalha de moto: diária por impedimento, cobertura de bagagem e assistência.\n\nQuem tem equipe na rua: vale conversar.',
        motivos: [{ marca: '•', texto: 'Cita marca de terceiro (88i): a policy exige aprovação do parceiro antes da sua decisão final.' }], hist: [{ q: 'há 3 horas', t: 'Conteúdo gerou a v1 a partir do briefing de parceria' }] },
      { id: 'i5', titulo: 'Reels: os 10 minutos depois de uma batida', headline: 'Bateu o carro? Faça isso primeiro', vertical: 'Prevenção', formato: 'Reels', grad: 3, canais: ['Instagram'], estado: 'RASCUNHO', risco: 'baixo', versao: 1, agente: 'Conteúdo', auton: 'A2', proposta: '2026-09-03T12:00', janela: 'melhor janela: 5ª, 12h', tags: '#sinistro #seguroauto',
        corpo: 'Roteiro em 4 cenas: 1) sinalize e saia da pista; 2) fotografe posição dos carros, placas e danos; 3) troque dados com o outro motorista; 4) abra o aviso de sinistro pelo WhatsApp da corretora.\n\nFechamento: "Guarde este vídeo. Você não vai lembrar disso na hora."',
        motivos: [{ marca: '•', texto: 'Ainda em geração: assim que o Conteúdo terminar as legendas, entra na sua fila.' }], hist: [{ q: 'há 6 minutos', t: 'Conteúdo começou a escrever a partir da pauta "Pós-batida"' }] },
      { id: 'i6', titulo: 'Chuvas de agosto: 5 cuidados com o carro', headline: 'Chuva forte à vista? 5 cuidados', vertical: 'Prevenção', formato: 'Carrossel', grad: 1, canais: ['Instagram', 'Facebook'], estado: 'PUBLICADO', risco: 'baixo', versao: 2, agente: 'Conteúdo', auton: 'A3', pubRotulo: '22/08 às 09:00', pubDia: 22, tags: '#chuva #prevenção', receipt: 'PUB-IG-8241 · idempotente · 22/08 09:00:04',
        corpo: 'Época de chuva pede atenção: revise palhetas e pneus, mantenha distância dobrada, evite ruas que alagam e nunca atravesse água parada.\n\nSe o carro parar na água, não tente ligar de novo — chame a assistência.',
        m: { alcance: 3412, eng: '5,8%', cliques: 41, conversas: 12 }, motivos: [], hist: [{ q: '20/08', t: 'Você aprovou a v2 e agendou para 22/08 09:00' }, { q: '22/08', t: 'Gateway publicou no Instagram e Facebook · receipt PUB-IG-8241' }] },
      { id: 'i7', titulo: 'O que é franquia, afinal?', headline: 'O que é franquia, afinal?', vertical: 'Coberturas', formato: 'Carrossel', grad: 0, canais: ['Instagram'], estado: 'PUBLICADO', risco: 'baixo', versao: 1, agente: 'Conteúdo', auton: 'A4', pubRotulo: '19/08 às 18:00', pubDia: 19, tags: '#franquia #seguro', receipt: 'PUB-IG-8177 · reuso de modelo pré-aprovado v3',
        corpo: 'Franquia é a sua parte no reparo. Se o conserto custa R$ 4.000 e sua franquia é R$ 2.500, o seguro paga a diferença.\n\nFranquia menor = prêmio maior. O equilíbrio depende de quanto você aguenta pagar de uma vez.',
        m: { alcance: 2870, eng: '7,1%', cliques: 63, conversas: 9 }, motivos: [], hist: [{ q: '18/08', t: 'Reuso de modelo pré-aprovado — republicação é risco LOW (até A4)' }, { q: '19/08', t: 'Gateway publicou no Instagram · receipt PUB-IG-8177' }] },
      { id: 'i8', titulo: 'Setembro amarelo: cuidar também é proteger', headline: 'Cuidar também é proteger', vertical: 'Institucional', formato: 'Post 1:1', grad: 5, canais: ['Instagram', 'Facebook'], estado: 'AGENDADO', risco: 'baixo', versao: 1, agente: 'Conteúdo', auton: 'A3', agRotulo: '28/08 às 09:00', agDia: 28, tags: '#setembroamarelo', receipt: 'APR-I8 · vinculado à v1 · você em 25/08',
        corpo: 'Proteger vida vai além de apólice. Neste Setembro Amarelo, lembramos: falar salva. CVV 188, ligação gratuita, 24 horas.\n\nSe você precisa conversar, procure ajuda. A gente cuida do resto.',
        motivos: [], hist: [{ q: '25/08', t: 'Você aprovou a v1 e agendou para 28/08 09:00' }] },
      { id: 'i9', titulo: 'Dia do corretor de seguros', headline: 'Hoje é dia de quem protege', vertical: 'Institucional', formato: 'Post 1:1', grad: 4, canais: ['Instagram'], estado: 'FALHA', risco: 'baixo', versao: 1, agente: 'Conteúdo', auton: 'A3', agRotulo: '25/08 às 08:00', agDia: 25, tags: '#diadocorretor',
        corpo: 'Por trás de cada apólice existe alguém que estuda o seu risco e briga pelo seu sinistro. Feliz dia do corretor de seguros.',
        motivos: [{ marca: '⚠', cor: '#C0392B', texto: 'CHANNEL_TOKEN_EXPIRED: o token do Instagram expirou às 07:58. O conteúdo está intacto — reconecte o canal e reagende com um clique.' }], hist: [{ q: '25/08', t: 'Gateway tentou publicar e parou: token expirado. Nenhuma publicação parcial — a operação é idempotente.' }] },
    ],
    biblioteca: [
      { id: 'b1', titulo: 'Explicativo: o que é franquia', headline: 'O que é franquia, afinal?', formato: 'Carrossel', grad: 0, v: 3, usos: 9, desde: '02/06', canais: ['Instagram'], vertical: 'Coberturas', corpo: 'Franquia é a sua parte no reparo. Se o conserto custa R$ 4.000 e sua franquia é R$ 2.500, o seguro paga a diferença.' },
      { id: 'b2', titulo: 'Prevenção: chuvas e alagamento', headline: 'Chuva forte à vista? 5 cuidados', formato: 'Carrossel', grad: 1, v: 2, usos: 12, desde: '10/07', canais: ['Instagram', 'Facebook'], vertical: 'Prevenção', corpo: 'Revise palhetas e pneus, dobre a distância, evite ruas que alagam e nunca atravesse água parada.' },
      { id: 'b3', titulo: 'Institucional: atendimento de sinistro', headline: 'Sinistro não espera. A gente também não.', formato: 'Reels', grad: 3, v: 2, usos: 7, desde: '15/07', canais: ['Instagram', 'Facebook'], vertical: 'Institucional', corpo: 'Acompanhamento do início ao fim: você fala com gente, não com protocolo.' },
      { id: 'b4', titulo: 'Coberturas: assistência 24h', headline: 'Assistência 24h: o que entra', formato: 'Post 1:1', grad: 2, v: 1, usos: 4, desde: '20/08', canais: ['Instagram'], vertical: 'Coberturas', corpo: 'Reboque, socorro elétrico, chaveiro e táxi — com limites que variam por apólice. Confira a sua.' },
    ],
    bibUsados: {},
    jornadas: [
      { id: 'j1', nome: 'Renovação', trigger: 'apólice a 60 dias do vencimento', ativa: true, inscritos: 86, auton: 'A3 — cada mensagem passa pela sua fila', taxa: '38% de resposta', passos: [{ q: 'D-60', t: 'E-mail com condições', canal: 'E-mail' }, { q: 'D-30', t: 'Lembrete curto', canal: 'WhatsApp' }, { q: 'D-7', t: 'Tarefa para o corretor ligar', canal: 'Interno' }] },
      { id: 'j2', nome: 'Pós-sinistro', trigger: 'sinistro aberto no módulo de Sinistros', ativa: false, inscritos: 0, auton: 'A3 — conteúdo sensível, aprovação item a item', taxa: 'não iniciada', passos: [{ q: 'D0', t: 'Confirmação e próximos passos', canal: 'WhatsApp' }, { q: 'D+7', t: 'Acompanhamento do reparo', canal: 'WhatsApp' }, { q: 'D+30', t: 'Pesquisa de satisfação', canal: 'E-mail' }] },
      { id: 'j3', nome: 'Win-back', trigger: '90 dias após não-renovação', ativa: false, inscritos: 0, auton: 'A4 — envelope: 20 envios/semana, só base com consent', taxa: 'não iniciada', passos: [{ q: 'D+90', t: 'E-mail de reaproximação', canal: 'E-mail' }, { q: 'D+104', t: 'Oferta de recotação', canal: 'E-mail' }] },
      { id: 'j4', nome: 'NPS e avaliações', trigger: 'renovação concluída', ativa: true, inscritos: 41, auton: 'A4 — envelope: risco baixo, kill switch ativo', taxa: '9 avaliações no mês', passos: [{ q: 'D+2', t: 'Pesquisa NPS de 1 pergunta', canal: 'WhatsApp' }, { q: 'nota 9-10', t: 'Convite para avaliar no Google', canal: 'WhatsApp' }, { q: 'nota ≤ 6', t: 'Tarefa de retenção para o corretor', canal: 'Interno' }] },
    ],
    renovacoes: [
      { id: 'r1', seg: 'M. Albuquerque', produto: 'Auto · Porto Seguro', vence: '12/09 · em 18 dias', st: 'ELIGIVEL' },
      { id: 'r2', seg: 'Transportes Rocha ME', produto: 'Frota · Allianz', vence: '20/09 · em 26 dias', st: 'ELIGIVEL' },
      { id: 'r3', seg: 'C. Ferreira', produto: 'Residencial · Tokio Marine', vence: '28/09 · em 34 dias', st: 'SEM_CONSENT' },
      { id: 'r4', seg: 'Padaria Dois Irmãos', produto: 'Empresarial · Mapfre', vence: '30/09 · em 36 dias', st: 'ELIGIVEL' },
    ],
    canais: [
      { id: 'Instagram', conta: '@horizonteseguros', st: 'ok', detalhe: 'conectado · token válido até 12/11' },
      { id: 'Facebook', conta: 'Horizonte Seguros', st: 'ok', detalhe: 'conectado · página verificada' },
      { id: 'WhatsApp', conta: '+55 11 9xxxx-4120', st: 'ok', detalhe: 'API oficial · 1.284 contatos, 74% com consent' },
      { id: 'LinkedIn', conta: '—', st: 'off', detalhe: 'não conectado — sem conexão, a policy bloqueia publicação' },
    ],
    abaPlan: 'campanhas', campSel: 'c1', periodo: '30 dias', nlMsg: '',
    nlSel: { i6: true, i1: true, i7: true },
    nlCfg: {
      remetente: 'Horizonte Seguros', email: 'news@horizonteseguros.com.br', reply: 'contato@horizonteseguros.com.br',
      assunto: 'Antes de renovar, faça 3 perguntas', preheader: 'E o que fazer nos 10 minutos depois de uma batida',
      modelo: 'educativo', cadencia: 'Semanal · sexta, 9h', lista: 'Clientes ativos', utm: true, pixel: true,
      teste: 'fernanda@horizonteseguros.com.br',
    },
    nlOrdem: ['i6', 'i1', 'i7'],
    nlAuto: { auto: false, reenvio: true, sendtime: true, cta: true },
    campanhas: [
      { id: 'c1', nome: 'Renovação setembro', obj: 'Retenção', st: 'ATIVA', periodo: '25/08 – 30/09', aud: 'Renovação em 60 dias', pessoas: 71, canais: ['E-mail', 'WhatsApp'], auton: 'A3 · aprovação item a item', orc: 'orgânico + tarefa do corretor', itens: ['Renovação Horizonte: condições 2026', '3 perguntas antes de renovar', 'Lembrete D-30 (WhatsApp)'], res: { alcance: 612, cliques: 74, conversas: 21, cotacoes: 9, apolices: 4 }, guard: ['máx. 1 mensagem por cliente a cada 7 dias', 'suprime sinistro aberto e inadimplente', 'hold-out de 10% para medir efeito real'] },
      { id: 'c2', nome: 'Setembro Amarelo', obj: 'Marca', st: 'AGENDADA', periodo: '28/08 – 30/09', aud: 'Base geral com consent', pessoas: 948, canais: ['Instagram', 'Facebook'], auton: 'A3 · aprovação item a item', orc: 'R$ 300 de impulsionamento', itens: ['Setembro amarelo: cuidar também é proteger', 'Carrossel de apoio (em pauta)'], res: null, guard: ['tema sensível: nenhuma peça em A4', 'sem call-to-action de venda'] },
      { id: 'c3', nome: 'Entregadores + 88i', obj: 'Aquisição', st: 'RASCUNHO', periodo: 'a definir', aud: 'Prospect frota e delivery', pessoas: 0, canais: ['LinkedIn', 'Instagram'], auton: 'A2 · nada sai sem parceiro aprovar', orc: 'a definir', itens: ['Parceria Horizonte + 88i'], res: null, guard: ['cita marca de terceiro: aprovação externa obrigatória'] },
      { id: 'c4', nome: 'Chuvas de agosto', obj: 'Educação', st: 'ENCERRADA', periodo: '10/08 – 24/08', aud: 'Base geral', pessoas: 1180, canais: ['Instagram', 'Facebook'], auton: 'A3', orc: 'orgânico', itens: ['Chuvas de agosto: 5 cuidados', 'O que é franquia, afinal?'], res: { alcance: 6282, cliques: 104, conversas: 21, cotacoes: 6, apolices: 2 }, guard: ['encerrada no prazo · resultados consolidados'] },
    ],
    audiencias: [
      { id: 'a1', nome: 'Renovação em 60 dias', regra: 'vencimento entre amanhã e +60 dias', total: 86, eleg: 71, consent: '83%', uso: 'Campanha Renovação setembro · Jornada Renovação' },
      { id: 'a2', nome: 'Mono-produto auto', regra: 'tem auto e nenhum outro ramo há 12 meses', total: 214, eleg: 159, consent: '74%', uso: 'sem uso' },
      { id: 'a3', nome: 'Sem contato há 90 dias', regra: 'último contato > 90 dias e consent ativo', total: 132, eleg: 132, consent: '100%', uso: 'sem uso' },
      { id: 'a4', nome: 'Promotores de NPS', regra: 'nota 9 ou 10 nos últimos 90 dias', total: 41, eleg: 41, consent: '100%', uso: 'Jornada NPS e avaliações' },
      { id: 'a5', nome: 'Não renovaram (win-back)', regra: 'não-renovação entre 90 e 180 dias', total: 58, eleg: 37, consent: '64%', uso: 'Jornada Win-back (pausada)' },
    ],
    nlEdicoes: [
      { id: 'e1', n: '#20 · Setembro Amarelo', st: 'AGENDADA', quando: '28/08 às 09:00', envios: '948 previstos', ab: '—', cl: '—' },
      { id: 'e2', n: '#19 · Renovação sem susto', st: 'ENVIADA', quando: '21/08', envios: '912 enviados', ab: '38,4%', cl: '6,1%' },
      { id: 'e3', n: '#18 · Chuvas e alagamento', st: 'ENVIADA', quando: '14/08', envios: '905 enviados', ab: '35,2%', cl: '4,8%' },
      { id: 'e4', n: '#17 · Assistência 24h', st: 'ENVIADA', quando: '07/08', envios: '898 enviados', ab: '31,9%', cl: '3,9%' },
    ],
    atividade: [
      { hora: 'há 6 minutos', agente: 'Conteúdo', acao: 'começou o reels "10 minutos depois de uma batida" a partir da pauta aprovada.', cor: '#0FC2C0' },
      { hora: 'há 38 minutos', agente: 'Compliance', acao: 'travou o e-mail de renovação com CLAIM_UNSUPPORTED — claim sem fonte.', cor: '#0E353D' },
      { hora: 'há 3 horas', agente: 'Conteúdo', acao: 'gerou o post da parceria com a 88i e pediu aprovação do parceiro.', cor: '#0FC2C0' },
      { hora: 'hoje, 08:02', agente: 'Gateway', acao: 'parou a publicação do "Dia do corretor": token do Instagram expirado, nada publicado.', cor: '#17C964' },
    ],
    receipts: [
      { id: 'PUB-IG-8241', t: 'Publicação · Chuvas de agosto', d: '22/08 09:00 · Instagram + Facebook · idempotente' },
      { id: 'APR-I8', t: 'Aprovação · Setembro amarelo', d: '25/08 · Fernanda (OWNER) · vinculada à v1' },
      { id: 'PUB-IG-8177', t: 'Publicação · O que é franquia', d: '19/08 18:00 · reuso de modelo pré-aprovado v3' },
    ],
  };

  get(id) { return this.state.items.find((i) => i.id === id) || {}; }
  fmt(v) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(v || '');
    if (!m) return { rotulo: '27/08 às 10:00', dia: 27, mes: 8, hora: '10:00' };
    return { rotulo: m[3] + '/' + m[2] + ' às ' + m[4], dia: +m[3], mes: +m[2], hora: m[4] };
  }
  ir(t) { this.setState({ tela: t, sel: null }); }
  toast(t, cta, tela) { this.setState({ toast: { t, cta, tela } }); clearTimeout(this._tt); this._tt = setTimeout(() => this.setState({ toast: null }), 6000); }
  log(agente, acao, cor) { this.setState((s) => ({ atividade: [{ hora: 'agora', agente, acao, cor: cor || '#0FC2C0' }, ...s.atividade].slice(0, 8) })); }
  patch(id, campos, hist) {
    this.setState((s) => ({ items: s.items.map((i) => i.id === id ? { ...i, ...campos, hist: hist ? [...(i.hist || []), hist] : i.hist } : i) }));
  }

  aprovar(id) {
    const it = this.get(id);
    const q = this.fmt(this.state.ag[id] ?? it.proposta);
    this.patch(id, { estado: 'AGENDADO', agRotulo: q.rotulo, agDia: q.mes === 8 ? q.dia : null, agMes: q.mes, receipt: 'APR-' + id.toUpperCase() + ' · vinculado à v' + it.versao + ' · você agora', motivos: [] }, { q: 'agora', t: 'Você aprovou a v' + it.versao + ' e agendou para ' + q.rotulo });
    this.setState((s) => ({ receipts: [{ id: 'APR-' + id.toUpperCase(), t: 'Aprovação · ' + it.titulo, d: 'agora · Fernanda (OWNER) · vinculada à v' + it.versao }, ...s.receipts].slice(0, 8) }));
    this.log('Gateway', 'registrou o receipt APR-' + id.toUpperCase() + ' — aprovação vinculada à v' + it.versao + ', não ao texto futuro.', '#17C964');
    this.toast('Aprovado e agendado para ' + q.rotulo + ' em ' + (it.canais || []).join(' + ') + '.', 'Ver no calendário', 'calendario');
  }
  ajuste(id) {
    const c = (this.state.coment[id] || '').trim();
    if (!c) { this.toast('Escreva o que precisa mudar — o comentário vai junto para o agente.'); return; }
    const it = this.get(id);
    this.patch(id, { estado: 'RASCUNHO', motivos: [{ marca: '•', texto: 'Reescrevendo com o seu comentário: "' + c + '"' }] }, { q: 'agora', t: 'Você pediu ajuste: "' + c + '"' });
    this.setState((s) => ({ coment: { ...s.coment, [id]: '' } }));
    this.toast('Ajuste enviado ao agente. A nova versão volta para a fila em instantes.');
    setTimeout(() => {
      this.patch(id, { estado: 'INTERNA', versao: it.versao + 1, histRotulo: 'ajustada após seu comentário na v' + it.versao, motivos: [{ marca: '•', texto: 'Nova versão com o seu pedido aplicado: "' + c + '"' }] }, { q: 'agora', t: 'Conteúdo entregou a v' + (it.versao + 1) });
      this.log('Conteúdo', 'entregou a v' + (it.versao + 1) + ' de "' + it.titulo + '" — a aprovação anterior caiu junto com a versão.', '#0FC2C0');
    }, 2600);
  }
  recusar(id) {
    const c = (this.state.coment[id] || '').trim();
    if (!c) { this.toast('Recusa exige motivo — ele fica registrado na trilha.'); return; }
    const it = this.get(id);
    this.patch(id, { estado: 'RECUSADO', motivos: [{ marca: '•', texto: 'Recusado por você: "' + c + '"' }] }, { q: 'agora', t: 'Você recusou a v' + it.versao + ': "' + c + '"' });
    this.log('Compliance', 'registrou a recusa de "' + it.titulo + '" com o seu motivo — o agente usa isso para não repetir o padrão.', '#0E353D');
    this.toast('Recusado. O motivo entrou na trilha e no aprendizado do agente.');
  }
  externa(id) {
    if (this.state.links[id]) return;
    const it = this.get(id);
    this.setState((s) => ({ links: { ...s.links, [id]: 'horizonte.olga.app/aprovar/' + id + '-8f3k2' } }));
    this.patch(id, { estado: 'EXTERNA' }, { q: 'agora', t: 'Link de aprovação externa gerado (token de uso único)' });
    this.log('Gateway', 'gerou link de aprovação externa para "' + it.titulo + '" — decisão do cliente entra na trilha como externa.', '#7C3AED');
    this.toast('Link gerado. O cliente aprova sem precisar de login.');
  }
  lote() {
    const ids = this.state.items.filter((i) => i.estado === 'INTERNA' && i.risco === 'baixo').map((i) => i.id);
    if (!ids.length) return;
    ids.forEach((id) => this.aprovar(id));
    this.toast(ids.length + ' itens de risco baixo aprovados — um receipt por item, cada um vinculado à sua versão.', 'Ver no calendário', 'calendario');
  }
  publicar(id) {
    const it = this.get(id);
    this.patch(id, { estado: 'PUBLICANDO' });
    this.toast('Publicando em ' + (it.canais || []).join(' + ') + '…');
    setTimeout(() => {
      this.patch(id, { estado: 'PUBLICADO', pubRotulo: it.agRotulo || 'agora', pubDia: it.agDia, receipt: 'PUB-' + cm((it.canais || [])[0]).s + '-' + (8300 + this.state.novoN) + ' · idempotente', m: { alcance: 1180, eng: '4,2%', cliques: 17, conversas: 3 } }, { q: 'agora', t: 'Gateway publicou em ' + (it.canais || []).join(' + ') + ' · receipt idempotente' });
      this.log('Gateway', 'publicou "' + it.titulo + '" com receipt idempotente — reexecutar o workflow não duplica o post.', '#17C964');
      this.toast('Publicado. As métricas começam a chegar em minutos.', 'Ver desempenho', 'desempenho');
    }, 1500);
  }
  reconectar(id) {
    const it = this.get(id);
    this.setState((s) => ({ canais: s.canais.map((c) => c.id === 'Instagram' ? { ...c, st: 'ok', detalhe: 'reconectado agora · token válido até 24/11' } : c) }));
    this.patch(id, { estado: 'INTERNA', motivos: [{ marca: '•', texto: 'Canal reconectado. Confirme a nova data e o item volta para a fila de publicação.' }] }, { q: 'agora', t: 'Você reconectou o Instagram e reabriu o item' });
    this.log('Gateway', 'reconectou o Instagram — "' + it.titulo + '" pode ser reagendado sem risco de post duplicado.', '#17C964');
    this.toast('Instagram reconectado. Reagende quando quiser.', 'Ir para a fila', 'aprovacoes');
  }
  gerarPautas() {
    this.setState({ pautasFase: 'gerando' });
    setTimeout(() => this.setState((s) => ({ pautasFase: 'pronto', pautaSel: PAUTAS.reduce((a, p) => ({ ...a, [p.id]: true }), {}) })), 1400);
  }
  aprovarPautas() {
    const sel = PAUTAS.filter((p) => this.state.pautaSel[p.id]);
    if (!sel.length) return;
    const novos = sel.slice(0, 2).map((p, k) => ({
      id: 'n' + (this.state.novoN + k + 1), titulo: p.t, headline: p.h, vertical: p.v, formato: p.f, grad: (k + 2) % 6, canais: p.c,
      estado: 'RASCUNHO', risco: p.r, versao: 1, agente: 'Conteúdo', auton: 'A2', proposta: p.iso, janela: 'janela da pauta: ' + p.janela, tags: '#seguro',
      corpo: p.corpo, motivos: [{ marca: '•', texto: 'Rascunho em produção a partir da pauta aprovada — entra na sua fila quando terminar.' }],
      hist: [{ q: 'agora', t: 'Você aprovou a pauta "' + p.t + '"' }],
    }));
    this.setState((s) => ({ pautasFase: 'aprovado', nPautasAprov: sel.length, novoN: s.novoN + novos.length, items: [...novos, ...s.items] }));
    this.log('Conteúdo', 'recebeu ' + sel.length + ' pautas aprovadas e começou pelos 2 primeiros rascunhos.', '#0FC2C0');
    this.toast(sel.length + ' pautas aprovadas. Os 2 primeiros rascunhos já estão em produção.', 'Ver na esteira', 'conteudo');
    novos.forEach((n, k) => setTimeout(() => {
      this.patch(n.id, { estado: n.risco === 'alto' ? 'COMPLIANCE' : 'INTERNA', motivos: [{ marca: '•', texto: n.risco === 'alto' ? 'Risco alto: Compliance revisa antes de chegar a você.' : 'Rascunho pronto para a sua decisão — risco baixo.' }] }, { q: 'agora', t: 'Conteúdo entregou a v1 para revisão' });
      if (k === 0) this.toast('"' + n.titulo + '" está pronto para a sua decisão.', 'Abrir fila', 'aprovacoes');
    }, 2400 + k * 900));
  }
  usarModelo(id) {
    const m = this.state.biblioteca.find((b) => b.id === id);
    if (!m || this.state.bibUsados[id]) return;
    const nid = 'bib' + (this.state.novoN + 1);
    this.setState((s) => ({
      novoN: s.novoN + 1, bibUsados: { ...s.bibUsados, [id]: true },
      items: [{ id: nid, titulo: m.titulo, headline: m.headline, vertical: m.vertical, formato: m.formato, grad: m.grad, canais: m.canais, estado: 'AGENDADO', risco: 'baixo', versao: m.v, agente: 'Conteúdo', auton: 'A4', agRotulo: '30/08 às 10:00', agDia: 30, agMes: 8, proposta: '2026-08-30T10:00', janela: 'janela padrão do modelo', corpo: m.corpo, tags: '#seguro', receipt: 'REUSO-' + m.id.toUpperCase() + ' · modelo pré-aprovado v' + m.v, motivos: [], hist: [{ q: 'agora', t: 'Reuso de modelo pré-aprovado v' + m.v + ' — republicação é risco baixo (até A4)' }] }, ...s.items],
    }));
    this.log('Gateway', 'liberou reuso do modelo "' + m.titulo + '" sem nova aprovação — republicação de aprovado é risco baixo.', '#17C964');
    this.toast('Modelo agendado para 30/08 às 10:00 sem passar pela fila.', 'Ver no calendário', 'calendario');
  }
  gerarCampanha(rid) {
    const r = this.state.renovacoes.find((x) => x.id === rid);
    if (!r || r.gerado) return;
    const nid = 'ren' + (this.state.novoN + 1);
    this.setState((s) => ({
      novoN: s.novoN + 1,
      renovacoes: s.renovacoes.map((x) => x.id === rid ? { ...x, gerado: true } : x),
      items: [{ id: nid, titulo: 'Renovação: ' + r.seg, headline: 'Sua proteção renova em setembro', vertical: 'Renovação', formato: 'E-mail', grad: 4, canais: ['E-mail'], estado: 'COMPLIANCE', risco: 'alto', versao: 1, agente: 'Conteúdo', auton: 'A2', proposta: '2026-09-02T09:00', janela: 'envio individual', corpo: 'Olá! A apólice ' + r.produto + ' vence em breve. Preparamos as condições de renovação com antecedência — mensagem individual, sem disparo em massa.', motivos: [{ marca: '⚠', cor: '#C0392B', texto: 'Renovação com valor é risco ALTO: autonomia máxima A2 e revisão de Compliance obrigatória.' }], hist: [{ q: 'agora', t: 'Gerado a partir da carteira — elegibilidade por regra determinística, rastreável até a versão da regra' }] }, ...s.items],
    }));
    this.log('Conteúdo', 'gerou a campanha de renovação de ' + r.seg + ' a partir da carteira.', '#0FC2C0');
    this.toast('Campanha criada e enviada para Compliance antes da sua fila.', 'Acompanhar', 'aprovacoes');
  }
  enviarChat(texto) {
    const t = (texto ?? this.state.chatIn).trim();
    if (!t) return;
    const baixa = t.toLowerCase();
    let resp = 'Entendi. Vou tratar isso como pedido de conteúdo: escrevo o rascunho em A2 e ele entra na sua fila — nada sai sem sua decisão.';
    let acao = null;
    if (baixa.includes('renov')) { resp = 'A carteira tem 86 renovações nos próximos 60 dias, 74% com consent ativo. Renovação com valor é risco alto: gero em A2 e o Compliance revisa antes de você.'; acao = { cta: 'Abrir audiências', tela: 'audiencias' }; }
    else if (baixa.includes('pauta') || baixa.includes('plano') || baixa.includes('mês')) { resp = 'Posso propor 8 pautas para setembro, distribuídas entre Prevenção, Coberturas, Renovação e Institucional. Aprovar pauta não publica nada — só libera a produção.'; acao = { cta: 'Ver agenda editorial', tela: 'agenda' }; }
    else if (baixa.includes('métric') || baixa.includes('resultado') || baixa.includes('desempenho')) { resp = 'Nos últimos 30 dias: 6.282 pessoas alcançadas, 21 conversas abertas no WhatsApp e R$ 462,40 de custo de IA. Instagram puxa o alcance; WhatsApp puxa conversa.'; acao = { cta: 'Ver desempenho', tela: 'desempenho' }; }
    else if (baixa.includes('claim') || baixa.includes('compliance')) { resp = 'Tem um claim sem fonte agora: "conseguimos manter o valor da franquia" no e-mail de renovação. Anexe a proposta da seguradora ou remova a frase — sem isso, o Compliance mantém o bloqueio.'; acao = { cta: 'Abrir item', tela: 'aprovacoes' }; }
    else if (baixa.includes('chuva') || baixa.includes('post')) { resp = 'Escrevo em três variantes (Instagram, Facebook, WhatsApp) a partir do Brand Brain v1 e mando para a sua fila com o motivo da revisão.'; acao = { cta: 'Abrir fila', tela: 'aprovacoes' }; }
    this.setState((s) => ({ chat: [...s.chat, { de: 'eu', t }, { de: 'olga', t: resp, acao }], chatIn: '' }));
  }

  usarAudiencia(id) {
    const a = this.state.audiencias.find((x) => x.id === id);
    if (!a) return;
    this.setState({ tela: 'jornadas', abaPlan: 'campanhas' });
    this.log('Campanhas', 'abriu rascunho de campanha para a audiência "' + a.nome + '" (' + a.eleg + ' elegíveis, consent ativo).', '#F0B429');
    this.toast('Audiência "' + a.nome + '" carregada: ' + a.eleg + ' de ' + a.total + ' elegíveis por consent.');
  }
  setCfg(campo, valor) { this.setState((s) => ({ nlCfg: { ...s.nlCfg, [campo]: valor } })); }
  toggleAuto(k) {
    const v = !this.state.nlAuto[k];
    this.setState((s) => ({ nlAuto: { ...s.nlAuto, [k]: v } }));
    if (k === 'auto') this.toast(v ? 'Auto-montagem ligada: toda quinta o agente monta a edição com o conteúdo aprovado da semana — e ela cai na sua fila, nunca no envio.' : 'Auto-montagem desligada.');
  }
  mover(id, dir) {
    this.setState((s) => {
      const sel = s.items.filter((i) => s.nlSel[i.id] && ['PUBLICADO', 'AGENDADO', 'PUBLICANDO'].includes(i.estado)).map((i) => i.id);
      const ord = s.nlOrdem.filter((x) => sel.includes(x)).concat(sel.filter((x) => !s.nlOrdem.includes(x)));
      const k = ord.indexOf(id), alvo = k + dir;
      if (k < 0 || alvo < 0 || alvo >= ord.length) return {};
      const novo = ord.slice();
      novo[k] = ord[alvo]; novo[alvo] = id;
      return { nlOrdem: novo };
    });
  }
  duplicar(id) {
    const e = this.state.nlEdicoes.find((x) => x.id === id);
    if (!e) return;
    this.setCfg('assunto', e.n.split('· ')[1] || e.n);
    this.setState({ nlMsg: 'Edição "' + e.n + '" carregada como base: assunto, modelo e lista copiados. Troque os blocos e monte a nova.' });
    this.toast('Base copiada de ' + e.n + '.');
  }
  nlEscolhidos() { return this.state.items.filter((i) => this.state.nlSel[i.id] && ['PUBLICADO', 'AGENDADO', 'PUBLICANDO'].includes(i.estado)); }
  montarEdicao() {
    const sel = this.nlEscolhidos();
    if (!sel.length) { this.toast('Escolha ao menos um conteúdo já aprovado para montar a edição.'); return; }
    const cfg = this.state.nlCfg;
    const nid = 'nl' + (this.state.novoN + 1);
    this.setState((s) => ({
      novoN: s.novoN + 1, nlMsg: 'Edição #21 montada com ' + sel.length + ' conteúdos do sistema e enviada para a sua fila.',
      items: [{ id: nid, titulo: 'Newsletter #21 · ' + cfg.assunto, headline: cfg.assunto, vertical: 'Institucional', formato: 'E-mail', grad: 1, canais: ['E-mail'], estado: 'INTERNA', risco: 'medio', versao: 1, agente: 'Conteúdo', auton: 'A2', proposta: '2026-09-04T09:00', janela: cfg.cadencia,
        corpo: 'Assunto: ' + cfg.assunto + '\nPreheader: ' + cfg.preheader + '\n\n' + sel.map((i, k) => (k + 1) + '. ' + i.titulo + ' — ' + i.corpo.split('\n')[0]).join('\n\n') + '\n\nRodapé: CNPJ, endereço, descadastro em 1 clique.',
        motivos: [{ marca: '•', texto: 'Newsletter é envio direto para base com consent (' + cfg.lista + '): risco médio, autonomia máxima A3 e aprovação por edição.' }],
        hist: [{ q: 'agora', t: 'Montada com ' + sel.length + ' conteúdos já aprovados · modelo ' + cfg.modelo + ' · lista ' + cfg.lista }] }, ...s.items],
    }));
    this.log('Conteúdo', 'montou a newsletter #21 reaproveitando ' + sel.length + ' conteúdos já aprovados — nenhum texto novo, nenhum claim novo.', '#0FC2C0');
    this.toast('Edição #21 montada com conteúdo já aprovado.', 'Revisar na fila', 'aprovacoes');
  }
  enviarTeste() {
    if (!this.nlEscolhidos().length) { this.toast('Selecione o conteúdo antes de enviar o teste.'); return; }
    this.setState({ nlMsg: 'Teste enviado para ' + this.state.nlCfg.teste + ' — envio de teste não conta na base nem gera métrica.' });
    this.toast('Teste enviado para ' + this.state.nlCfg.teste + '.');
  }
  novaCarga() { this.setState({ carteiraMsg: 'Upload recebido: mapeamento SRC-POLICY-FILE v3 reutilizado — 1.291 apólices (7 novas), nenhuma coluna pendente de confirmação.' }); }
  responder() {
    this.setState({ repRespondida: true });
    this.log('Conteúdo', 'publicou a resposta aprovada à avaliação de Marcos T. no Google — no tom confirmado do Brand Brain.', '#0FC2C0');
    this.toast('Resposta publicada e registrada na trilha.');
  }
  toggleJornada(id) {
    const j = this.state.jornadas.find((x) => x.id === id);
    if (!j) return;
    this.setState((s) => ({ jornadas: s.jornadas.map((x) => x.id === id ? { ...x, ativa: !x.ativa, inscritos: x.ativa ? x.inscritos : (x.inscritos || 12) } : x) }));
    this.log('Campanhas', (j.ativa ? 'pausou' : 'ativou') + ' a jornada "' + j.nome + '" — quem, quando e por quê ficam registrados.', '#F0B429');
    this.toast('Jornada "' + j.nome + '" ' + (j.ativa ? 'pausada' : 'ativada') + '.');
  }
  togglePausa() {
    const p = !this.state.pausa;
    this.setState({ pausa: p });
    this.log('Gateway', p ? 'acionou o kill switch: nenhum agente executa ação externa até você liberar.' : 'liberou a operação — agentes voltam ao nível governado.', '#17C964');
    this.toast(p ? 'Kill switch acionado. Nada sai até você liberar.' : 'Operação liberada.');
  }
  abrirOnb() { this.setState({ onb: true, onbPasso: 1, onbProg: 0 }); }
  extrair() {
    this.setState({ onbPasso: 2, onbProg: 0 });
    [1, 2, 3, 4].forEach((n) => setTimeout(() => this.setState({ onbProg: n }), n * 650));
    setTimeout(() => this.setState({ onbPasso: 3 }), 3200);
  }
  concluirOnb() {
    this.setState({ onb: false, onbConcluido: true, tela: 'hoje' });
    this.log('Brand', 'confirmou o Brand Brain v1 de ' + this.state.onbNome + ' — extraído do site e revisado por você.', '#3A7BDC');
    this.toast('Marca confirmada. Agora os agentes escrevem dentro dela.', 'Ver a marca', 'marca');
  }

  renderVals() {
    const s = this.state;
    const workspace = this.props.nomeWorkspace ?? 'Corretora Horizonte Seguros';
    const marcaCurta = workspace.replace('Corretora ', '');
    const busca = s.busca.trim().toLowerCase();
    const conta = (f) => s.items.filter(f).length;
    const naFila = (i) => ['COMPLIANCE', 'INTERNA', 'EXTERNA'].includes(i.estado);
    const filaItens = s.items.filter(naFila).sort((a, b) => ({ alto: 0, medio: 1, baixo: 2 }[a.risco] - { alto: 0, medio: 1, baixo: 2 }[b.risco]));
    const pend = s.items.filter((i) => naFila(i) || i.estado === 'FALHA');
    const lote = s.items.filter((i) => i.estado === 'INTERNA' && i.risco === 'baixo');
    const agendados = s.items.filter((i) => ['AGENDADO', 'PUBLICANDO'].includes(i.estado));
    const publicados = s.items.filter((i) => i.estado === 'PUBLICADO');
    const custoTotal = 462.4;

    const deco = (i) => {
      const e = EST[i.estado] || EST.RASCUNHO;
      const r = RISCO[i.risco] || RISCO.baixo;
      const canais = i.canais && i.canais.length ? i.canais : ['Instagram'];
      const ativo = canais.includes(s.varSel[i.id]) ? s.varSel[i.id] : canais[0];
      const q = this.fmt(s.ag[i.id] ?? i.proposta);
      return {
        ...i, estRotulo: e.r, estCor: e.c, estBg: e.b, riscoRotulo: (i.risco || '').toUpperCase(), riscoBg: r.b, riscoCor: r.c,
        grad: GRAD[(i.grad || 0) % 6], corpoAtivo: variante(i, ativo), limite: cm(ativo).lim,
        temHist: !!i.histRotulo, chips: canais.map((c) => ({ sigla: cm(c).s, cor: cm(c).c })),
        tabs: canais.map((c) => ({ canal: c, sigla: cm(c).s, canalCor: cm(c).c, bg: c === ativo ? '#0E353D' : '#FFFFFF', cor: c === ativo ? '#FFFFFF' : '#5A7A82', borda: c === ativo ? '#0E353D' : '#D4DFE2', onClick: () => this.setState((st) => ({ varSel: { ...st.varSel, [i.id]: c } })) })),
        motivos: (i.motivos || []).map((m) => ({ ...m, cor: m.cor || '#0FC2C0' })),
        agInput: s.ag[i.id] ?? i.proposta ?? '2026-08-27T10:00', agRotulo: q.rotulo,
        onAgendar: (ev) => this.setState((st) => ({ ag: { ...st.ag, [i.id]: ev.target.value } })),
        coment: s.coment[i.id] || '', onComent: (ev) => this.setState((st) => ({ coment: { ...st.coment, [i.id]: ev.target.value } })),
        comentBorda: (s.coment[i.id] || '').trim() ? '#0FC2C0' : '#D4DFE2',
        cardBorda: i.risco === 'alto' ? '#F5D9D5' : '#E3EDEF',
        temLink: !!s.links[i.id], link: s.links[i.id] || '',
        extDesab: !!s.links[i.id], extOp: s.links[i.id] ? 0.45 : 1,
        cadeia: i.estado === 'COMPLIANCE'
          ? [{ t: 'Compliance', marca: '●', bg: '#FFF8E1', cor: '#9A6B00' }, { t: 'Você (OWNER)', marca: '○', bg: '#EEF3F4', cor: '#8AA6AD' }]
          : i.estado === 'EXTERNA'
            ? [{ t: 'Compliance', marca: '✓', bg: '#EDFCF2', cor: '#0E8A46' }, { t: 'Cliente', marca: '●', bg: '#F4F0FE', cor: '#7C3AED' }, { t: 'Você (OWNER)', marca: '○', bg: '#EEF3F4', cor: '#8AA6AD' }]
            : [{ t: 'Compliance', marca: '✓', bg: '#EDFCF2', cor: '#0E8A46' }, { t: 'Você (OWNER)', marca: '●', bg: '#FFF8E1', cor: '#9A6B00' }],
        onAprovar: () => this.aprovar(i.id), onAjuste: () => this.ajuste(i.id), onRecusar: () => this.recusar(i.id),
        onExterna: () => this.externa(i.id), onPublicar: () => this.publicar(i.id), onReconectar: () => this.reconectar(i.id),
        onAbrir: () => this.setState({ sel: i.id }),
        quando: i.estado === 'PUBLICADO' ? i.pubRotulo : i.agRotulo || q.rotulo,
      };
    };

    const nav = (id, rotulo, icone, badge, badgeAlerta) => ({
      id, rotulo, icone, temBadge: !!badge, badge: badge || '',
      badgeBg: badgeAlerta ? '#F0B429' : 'rgba(255,255,255,0.14)', badgeCor: badgeAlerta ? '#3A2A00' : '#B7D3D7',
      bg: s.tela === id ? 'rgba(15,194,192,0.16)' : 'transparent',
      cor: s.tela === id ? '#FFFFFF' : '#9FBDC4', peso: s.tela === id ? 600 : 500,
      onClick: () => this.ir(id),
    });

    const etapas = { hoje: 'PAINEL', aprovacoes: 'ETAPA 3 · DECIDIR', conteudo: 'ETAPA 2 · PRODUZIR', calendario: 'ETAPA 4 · PUBLICAR', agenda: 'ETAPA 1 · PLANEJAR', jornadas: 'ETAPA 1 · PLANEJAR', newsletter: 'ETAPA 1 · PLANEJAR', desempenho: 'ETAPA 5 · MEDIR', audiencias: 'ETAPA 1 · PARA QUEM', marca: 'GOVERNANÇA', agentes: 'GOVERNANÇA', config: 'GOVERNANÇA' };
    const titulos = { hoje: 'Hoje', aprovacoes: 'Aprovações', conteudo: 'Conteúdo', calendario: 'Calendário', agenda: 'Agenda editorial', jornadas: 'Campanhas e jornadas', newsletter: 'Newsletter', desempenho: 'Desempenho', audiencias: 'Audiências', marca: 'Marca', agentes: 'Agentes e autonomia', config: 'Configurações' };

    const focoItem = s.items.find((i) => i.estado === 'FALHA') || s.items.find((i) => i.estado === 'COMPLIANCE') || filaItens[0] || agendados[0];
    let foco = { titulo: 'Nada te bloqueia agora', texto: 'A fila está limpa e o calendário tem itens agendados. Bom momento para planejar o próximo mês.', cta: 'Planejar setembro', acao: () => this.ir('agenda') };
    if (focoItem) {
      if (focoItem.estado === 'FALHA') foco = { titulo: 'Uma publicação falhou por token expirado', texto: '"' + focoItem.titulo + '" parou antes de publicar. O conteúdo está intacto: reconecte o canal e reagende — a operação é idempotente, não existe post duplicado.', cta: 'Corrigir agora', acao: () => this.setState({ tela: 'aprovacoes', sel: focoItem.id }) };
      else if (focoItem.estado === 'COMPLIANCE') foco = { titulo: 'Compliance travou um claim sem fonte', texto: '"' + focoItem.titulo + '" tem uma afirmação que não existe na base de evidências. Sem fonte, o item não avança para você.', cta: 'Revisar o claim', acao: () => this.setState({ tela: 'aprovacoes', sel: focoItem.id }) };
      else if (focoItem.estado === 'EXTERNA') foco = { titulo: 'Aguardando o cliente aprovar', texto: '"' + focoItem.titulo + '" está com o parceiro. Você decide depois que ele responder.', cta: 'Ver na fila', acao: () => this.ir('aprovacoes') };
      else if (focoItem.estado === 'INTERNA') foco = { titulo: pend.length + ' itens esperando sua decisão', texto: 'Comece por "' + focoItem.titulo + '". Risco baixo pode ir em lote; risco alto pede leitura linha a linha.', cta: 'Abrir a fila', acao: () => this.ir('aprovacoes') };
      else foco = { titulo: 'Tudo aprovado — agora é publicar', texto: agendados.length + ' itens agendados. Você pode antecipar qualquer um deles pelo calendário.', cta: 'Ver calendário', acao: () => this.ir('calendario') };
    }

    const det = s.sel ? deco(this.get(s.sel)) : null;
    const detExtra = det ? {
      ...det,
      temMetricas: !!det.m, mAlcance: det.m ? mil(det.m.alcance) : '', mEng: det.m ? det.m.eng : '', mCliques: det.m ? det.m.cliques : '', mConversas: det.m ? det.m.conversas : '',
      temReceipt: !!det.receipt, receipt: det.receipt || '',
      hist: (det.hist || []).slice().reverse(),
      temAcao: ['INTERNA', 'COMPLIANCE', 'AGENDADO', 'FALHA'].includes(det.estado),
      primariaRotulo: det.estado === 'AGENDADO' ? 'Publicar agora' : det.estado === 'FALHA' ? 'Reconectar canal e reabrir' : 'Aprovar e agendar ' + det.agRotulo,
      onPrimaria: det.estado === 'AGENDADO' ? () => this.publicar(det.id) : det.estado === 'FALHA' ? () => this.reconectar(det.id) : () => this.aprovar(det.id),
      temSecundaria: ['INTERNA', 'COMPLIANCE'].includes(det.estado),
      secundariaRotulo: 'Pedir ajuste', onSecundaria: () => this.ajuste(det.id),
    } : { tabs: [], hist: [], motivos: [] };

    return {
      workspace, marcaCurta, busca, setBusca: (e) => this.setState({ busca: e.target.value }),
      etapaAtual: etapas[s.tela] || '', tituloTela: titulos[s.tela] || '',
      statusTexto: s.pausa ? 'Pausado por você' : 'A2–A3 · governado', statusCor: s.pausa ? '#F0B429' : '#17C964',
      grupos: [
        { rotulo: 'OPERAR', itens: [nav('hoje', 'Hoje', ICON.hoje), nav('aprovacoes', 'Aprovações', ICON.aprov, pend.length ? String(pend.length) : '', true), nav('conteudo', 'Conteúdo', ICON.conteudo), nav('calendario', 'Calendário', ICON.calendario, agendados.length ? String(agendados.length) : '')] },
        { rotulo: 'PLANEJAR', itens: [nav('agenda', 'Agenda editorial', ICON.agenda), nav('jornadas', 'Campanhas e jornadas', ICON.jornada), nav('newsletter', 'Newsletter', ICON.email)] },
        { rotulo: 'ENTENDER', itens: [nav('desempenho', 'Desempenho', ICON.desempenho), nav('audiencias', 'Audiências', ICON.carteira)] },
        { rotulo: 'GOVERNANÇA', itens: [nav('marca', 'Marca', ICON.marca), nav('agentes', 'Agentes e autonomia', ICON.agentes), nav('config', 'Configurações', ICON.config)] },
      ],
      telaHoje: s.tela === 'hoje', telaAprovacoes: s.tela === 'aprovacoes', telaConteudo: s.tela === 'conteudo', telaCalendario: s.tela === 'calendario',
      telaAgenda: s.tela === 'agenda', telaJornadas: s.tela === 'jornadas', telaDesempenho: s.tela === 'desempenho', telaCarteira: s.tela === 'audiencias', telaNewsletter: s.tela === 'newsletter',
      telaMarca: s.tela === 'marca', telaAgentes: s.tela === 'agentes', telaConfig: s.tela === 'config',
      irAprovacoes: () => this.ir('aprovacoes'), irCalendario: () => this.ir('calendario'), irAgenda: () => this.ir('agenda'),
      irAgentes: () => this.ir('agentes'), irDesempenho: () => this.ir('desempenho'), irConteudo: () => this.ir('conteudo'), irConfig: () => this.ir('config'),

      esteira: [
        { passo: 'ETAPA 1', rotulo: 'Pautas propostas', dono: 'agente de Conteúdo', n: s.pautasFase === 'pronto' ? 8 : s.pautasFase === 'aprovado' ? 0 : 8, tela: 'agenda' },
        { passo: 'ETAPA 2', rotulo: 'Rascunhos em produção', dono: 'agente de Conteúdo', n: conta((i) => i.estado === 'RASCUNHO'), tela: 'conteudo' },
        { passo: 'ETAPA 3', rotulo: 'Compliance', dono: 'agente Compliance', n: conta((i) => i.estado === 'COMPLIANCE'), tela: 'aprovacoes' },
        { passo: 'ETAPA 3', rotulo: 'Sua aprovação', dono: 'você e o cliente', n: conta((i) => ['INTERNA', 'EXTERNA'].includes(i.estado)), tela: 'aprovacoes', foco: true },
        { passo: 'ETAPA 4', rotulo: 'Agendados', dono: 'Gateway', n: agendados.length, tela: 'calendario' },
        { passo: 'ETAPA 5', rotulo: 'Publicados no mês', dono: 'métricas em Desempenho', n: publicados.length, tela: 'desempenho' },
      ].map((e) => ({ ...e, bg: e.foco ? '#FFFBF0' : '#F8FBFB', borda: e.foco ? '#F5E3B8' : '#E9F1F2', numCor: e.n ? '#0E353D' : '#C3D2D6', onClick: () => this.ir(e.tela) })),

      nPendente: pend.length, semPendencia: !pend.length,
      pendencias: pend.slice(0, 4).map((i) => {
        const d = deco(i);
        const alerta = i.estado === 'COMPLIANCE' || i.estado === 'FALHA';
        return { ...d, motivo: (i.motivos && i.motivos[0] ? i.motivos[0].texto : 'Pronto para a sua decisão.'), cta: i.estado === 'FALHA' ? 'Corrigir' : i.estado === 'EXTERNA' ? 'Acompanhar' : 'Revisar',
          icone: i.estado === 'FALHA' ? ICON.alerta : i.estado === 'COMPLIANCE' ? ICON.agentes : i.estado === 'EXTERNA' ? ICON.relogio : ICON.aprov,
          iconeBg: alerta ? '#FFF0F0' : '#FFF8E1', iconeCor: alerta ? '#C0392B' : '#9A6B00',
          onAbrir: () => this.setState({ tela: 'aprovacoes', sel: i.id }) };
      }),
      proximas: agendados.slice(0, 4).map((i) => { const d = deco(i); return { ...d, quando: i.agRotulo || d.agRotulo, origem: i.receipt && i.receipt.startsWith('REUSO') ? 'reuso de modelo' : i.vertical }; }),
      semProximas: !agendados.length,
      focoTitulo: foco.titulo, focoTexto: foco.texto, focoCta: foco.cta, focoAcao: foco.acao,
      kpiAlcance: mil(publicados.reduce((a, i) => a + (i.m ? i.m.alcance : 0), 0)),
      kpiConversas: publicados.reduce((a, i) => a + (i.m ? i.m.conversas : 0), 0),
      kpiPublicados: publicados.length, kpiCusto: brl(custoTotal),
      atividade: s.atividade,

      fila: filaItens.map(deco), filaVazia: !filaItens.length,
      temLote: lote.length >= 2, loteN: lote.length, aprovarLote: () => this.lote(),

      drawerAberto: !!s.sel, det: detExtra, fecharDrawer: () => this.setState({ sel: null }),

      copilotAberto: s.copilot, abrirCopilot: () => this.setState({ copilot: true }), fecharCopilot: () => this.setState({ copilot: false }),
      chat: s.chat.map((m) => ({ texto: m.t, lado: m.de === 'eu' ? 'end' : 'start', bg: m.de === 'eu' ? '#0E353D' : '#F8FBFB', borda: m.de === 'eu' ? '#0E353D' : '#E9F1F2', cor: m.de === 'eu' ? '#FFFFFF' : '#1A2C31' })),
      chatIn: s.chatIn, setChatIn: (e) => this.setState({ chatIn: e.target.value }),
      chatKey: (e) => { if (e.key === 'Enter') this.enviarChat(); },
      enviarChat: () => this.enviarChat(),
      chatSugestoes: ['Quais renovações vencem em setembro?', 'Propor pautas do mês', 'Como estão os resultados?'].map((t) => ({ t, onClick: () => this.enviarChat(t) })),

      temToast: !!s.toast, toastTexto: s.toast ? s.toast.t : '', toastTemAcao: !!(s.toast && s.toast.cta), toastCta: s.toast ? s.toast.cta : '',
      toastAcao: () => { if (s.toast && s.toast.tela) this.ir(s.toast.tela); this.setState({ toast: null }); },

      abaEsteira: s.abaConteudo === 'esteira', abaBiblioteca: s.abaConteudo === 'biblioteca',
      abas: [{ id: 'esteira', t: 'Esteira de produção' }, { id: 'biblioteca', t: 'Biblioteca pré-aprovada' }].map((a) => ({
        ...a, bg: s.abaConteudo === a.id ? '#0E353D' : '#FFFFFF', cor: s.abaConteudo === a.id ? '#FFFFFF' : '#5A7A82', borda: s.abaConteudo === a.id ? '#0E353D' : '#D4DFE2',
        onClick: () => this.setState({ abaConteudo: a.id }),
      })),
      colunas: [
        { rotulo: 'Rascunho da IA', dono: 'agente de Conteúdo', ests: ['RASCUNHO'] },
        { rotulo: 'Em revisão', dono: 'Compliance, você, cliente', ests: ['COMPLIANCE', 'INTERNA', 'EXTERNA'] },
        { rotulo: 'Agendado', dono: 'Gateway', ests: ['AGENDADO', 'PUBLICANDO'] },
        { rotulo: 'Publicado', dono: 'métricas chegando', ests: ['PUBLICADO'] },
        { rotulo: 'Parado', dono: 'precisa de você', ests: ['RECUSADO', 'FALHA'] },
      ].map((c) => {
        const itens = s.items.filter((i) => c.ests.includes(i.estado) && (!busca || (i.titulo + ' ' + i.corpo + ' ' + i.vertical).toLowerCase().includes(busca)));
        return { ...c, n: itens.length, vazio: !itens.length, itens: itens.map((i) => { const d = deco(i); return { ...d, quandoTexto: i.estado === 'PUBLICADO' ? 'publicado ' + (i.pubRotulo || '') : ['AGENDADO', 'PUBLICANDO'].includes(i.estado) ? 'sai ' + (i.agRotulo || '') : i.estado === 'RASCUNHO' ? 'em produção' : 'aguarda decisão' }; }) };
      }),
      biblioteca: s.biblioteca.map((b) => ({ ...b, gradCss: GRAD[b.grad % 6], canaisTexto: b.canais.join(' · '), usado: !!s.bibUsados[b.id], mostraBtn: !s.bibUsados[b.id], onUsar: () => this.usarModelo(b.id) })),

      semanas: (() => {
        const porDia = {};
        s.items.forEach((i) => {
          const dia = i.estado === 'PUBLICADO' ? i.pubDia : (['AGENDADO', 'PUBLICANDO'].includes(i.estado) ? (i.agMes === 9 ? null : i.agDia) : null);
          if (!dia) return;
          (porDia[dia] = porDia[dia] || []).push(i);
        });
        const cells = [];
        for (let k = 0; k < 5; k++) cells.push({ dia: '', vazio: true, itens: [], bg: 'transparent', borda: 'transparent' });
        for (let d = 1; d <= 31; d++) {
          const itens = (porDia[d] || []).map((i) => { const c = cm((i.canais || [])[0]); return { titulo: i.titulo, hora: (i.estado === 'PUBLICADO' ? i.pubRotulo : i.agRotulo || '').split('às ')[1] || '', sigla: c.s, cor: i.estado === 'PUBLICADO' ? '#0E8A46' : '#0A8583', bg: i.estado === 'PUBLICADO' ? '#EDFCF2' : '#E6F9F9', onClick: () => this.setState({ sel: i.id }) }; });
          cells.push({ dia: String(d), vazio: false, itens, hoje: d === 27, bg: d === 27 ? '#FFFBF0' : '#FFFFFF', borda: d === 27 ? '#F5E3B8' : '#E9F1F2' });
        }
        while (cells.length % 7) cells.push({ dia: '', vazio: true, itens: [], bg: 'transparent', borda: 'transparent' });
        const out = [];
        for (let k = 0; k < cells.length; k += 7) out.push({ dias: cells.slice(k, k + 7) });
        return out;
      })(),
      nAgendados: agendados.length, nPublicados: publicados.length,

      pautaVazio: s.pautasFase === 'vazio', pautaGerando: s.pautasFase === 'gerando', pautaPronto: s.pautasFase === 'pronto', pautaAprovado: s.pautasFase === 'aprovado',
      gerarPautas: () => this.gerarPautas(), aprovarPautas: () => this.aprovarPautas(),
      nPautaSel: PAUTAS.filter((p) => s.pautaSel[p.id]).length, nPautaAprov: s.nPautasAprov,
      pautas: PAUTAS.map((p) => {
        const sel = !!s.pautaSel[p.id]; const r = RISCO[p.r] || RISCO.baixo;
        return { id: p.id, t: p.t, v: p.v, f: p.f, janela: p.janela, canais: p.c.join(' · '), sel,
          check: sel ? '✓' : '', checkBg: sel ? '#0E353D' : '#FFFFFF', checkBorda: sel ? '#0E353D' : '#C3D2D6',
          riscoRotulo: p.r.toUpperCase(), riscoBg: r.b, riscoCor: r.c, corBorda: sel ? '#BDE8E7' : '#E9F1F2',
          onToggle: () => this.setState((st) => ({ pautaSel: { ...st.pautaSel, [p.id]: !st.pautaSel[p.id] } })) };
      }),

      jornadas: s.jornadas.map((j) => ({ ...j, ativoSel: s.jornadaSel === j.id, stRotulo: j.ativa ? 'ATIVA' : 'DISPONÍVEL', stBg: j.ativa ? '#EDFCF2' : '#EEF3F4', stCor: j.ativa ? '#0E8A46' : '#5A7A82', selBg: s.jornadaSel === j.id ? '#F8FBFB' : '#FFFFFF', selBorda: s.jornadaSel === j.id ? '#0FC2C0' : '#E9F1F2', onSel: () => this.setState({ jornadaSel: j.id }), sub: j.ativa ? j.inscritos + ' clientes · ' + j.taxa : 'pronta para ativar' })),
      jSel: (() => {
        const j = s.jornadas.find((x) => x.id === s.jornadaSel) || s.jornadas[0];
        return { ...j, stRotulo: j.ativa ? 'ATIVA' : 'DISPONÍVEL', stBg: j.ativa ? '#EDFCF2' : '#EEF3F4', stCor: j.ativa ? '#0E8A46' : '#5A7A82',
          btn: j.ativa ? 'Pausar jornada' : 'Ativar jornada', btnBg: j.ativa ? '#FFFFFF' : '#0E353D', btnCor: j.ativa ? '#0E353D' : '#FFFFFF', btnBorda: j.ativa ? '#D4DFE2' : '#0E353D',
          onToggle: () => this.toggleJornada(j.id), inscritosTexto: j.ativa ? j.inscritos + ' clientes na jornada · ' + j.taxa : 'nenhum cliente inscrito',
          passos: j.passos.map((p) => ({ ...p, sigla: cm(p.canal).s, cor: p.canal === 'Interno' ? '#5A7A82' : cm(p.canal).c })) };
      })(),

      canaisPerf: [
        { canal: 'Instagram', alcance: '4.910', eng: '6,2%', cliques: '84', conversas: '14', tend: '+12%', tendCor: '#0E8A46', cor: '#6D5CE7', sigla: 'IG' },
        { canal: 'Facebook', alcance: '2.180', eng: '3,4%', cliques: '27', conversas: '5', tend: '+4%', tendCor: '#0E8A46', cor: '#3A7BDC', sigla: 'FB' },
        { canal: 'WhatsApp', alcance: '612 entregues', eng: '41% resposta', cliques: '—', conversas: '21', tend: '+9%', tendCor: '#0E8A46', cor: '#17C964', sigla: 'WA' },
        { canal: 'LinkedIn', alcance: '—', eng: '—', cliques: '—', conversas: '—', tend: 'sem conexão', tendCor: '#C0392B', cor: '#0E353D', sigla: 'IN' },
      ],
      topPosts: publicados.slice().sort((a, b) => (b.m ? b.m.alcance : 0) - (a.m ? a.m.alcance : 0)).map((i) => { const d = deco(i); return { ...d, alcanceTexto: i.m ? mil(i.m.alcance) + ' alcance · ' + i.m.eng + ' eng · ' + i.m.conversas + ' conversas' : '' }; }),
      custos: [
        { agente: 'Conteúdo', v: brl(302.1), runs: '52 execuções', pct: '65%', barra: '65%' },
        { agente: 'Compliance', v: brl(96.4), runs: '18 execuções', pct: '21%', barra: '21%' },
        { agente: 'Copilot', v: brl(41.1), runs: '312 execuções', pct: '9%', barra: '9%' },
        { agente: 'Brand', v: brl(22.8), runs: '6 execuções', pct: '5%', barra: '5%' },
      ],
      custoTotal: brl(custoTotal), custoTeto: brl(1200), custoPct: '39%',
      repRespondida: s.repRespondida, repBtn: !s.repRespondida, responder: () => this.responder(),

      renovacoes: s.renovacoes.map((r) => ({ ...r, stTexto: r.st === 'ELIGIVEL' ? 'elegível' : 'sem consent', chipBg: r.st === 'ELIGIVEL' ? '#EDFCF2' : '#FFF8E1', chipCor: r.st === 'ELIGIVEL' ? '#0E8A46' : '#9A6B00', gerado: !!r.gerado, podeGerar: r.st === 'ELIGIVEL' && !r.gerado, onGerar: () => this.gerarCampanha(r.id) })),
      carteiraMsg: s.carteiraMsg, temCarteiraMsg: !!s.carteiraMsg, novaCarga: () => this.novaCarga(),

      brandTom: ['Próximo', 'Didático', 'Consultivo'],
      brandClaims: [
        { t: '25 anos de mercado segurador', fonte: 'página /sobre · verificado', ok: true },
        { t: 'Atendimento de sinistro com acompanhamento', fonte: 'página /servicos · verificado', ok: true },
        { t: '+5.000 clientes ativos', fonte: 'sem fonte verificável — bloqueado para uso', ok: false },
      ].map((c) => ({ ...c, marca: c.ok ? '✓' : '⚠', cor: c.ok ? '#0E8A46' : '#C0392B' })),
      brandPaleta: ['#1B3A5C', '#E8A33D', '#2E7D5B', '#F4F1EA'],
      brandProibido: ['garantimos', 'cobertura total', 'o mais barato do mercado', 'sem carência'],
      brandTagline: s.onbTagline, brandNome: s.onbNome, brandUrl: s.onbUrl,
      brandStatus: s.onbConcluido ? 'Confirmada por você no onboarding' : 'Ativa desde 20/08 · revisada por Fernanda',
      abrirOnb: () => this.abrirOnb(),
      brandVersoes: [
        { v: 'v1', st: 'ATIVA', d: 'tom + 2 claims com fonte + paleta do site', q: s.onbConcluido ? 'agora · você' : '20/08 · você' },
        { v: 'v0', st: 'ARQUIVADA', d: 'extração inicial automática, sem revisão humana', q: '19/08 · agente Brand' },
      ],

      agentes: [
        { n: 'Copilot', nivel: 'A3', st: 'ATIVO', runs: '312 execuções', custo: brl(41.1), d: 'Entrypoint de tudo: interpreta o pedido, resolve a intenção e roteia para a capability certa.', grad: 'linear-gradient(135deg,#6D5CE7,#3A7BDC)' },
        { n: 'Brand', nivel: 'A2', st: 'ATIVO', runs: '6 execuções', custo: brl(22.8), d: 'Extrai e versiona o Brand Brain a partir do site. Mudança de marca nunca roda em A4.', grad: 'linear-gradient(135deg,#0E353D,#6D5CE7)' },
        { n: 'Conteúdo', nivel: 'A2', st: 'ATIVO', runs: '52 execuções', custo: brl(302.1), d: 'Pauta, briefing e variantes por canal. Todo texto nasce rascunho — nada publica sozinho.', grad: 'linear-gradient(135deg,#3A7BDC,#0FC2C0)' },
        { n: 'Compliance', nivel: 'A3', st: 'ATIVO', runs: '18 execuções', custo: brl(96.4), d: 'Confere cada claim contra o Brand Brain e a lista de proibições. Claim sem fonte trava.', grad: 'linear-gradient(135deg,#0E353D,#0A8583)' },
        { n: 'Campanhas e jornadas', nivel: 'A2', st: 'CANDIDATO', runs: 'sem execuções', custo: brl(0), d: 'Audiências e jornadas da carteira. Nasce candidato: promover é ato de governança.', grad: 'linear-gradient(135deg,#0FC2C0,#17C964)' },
      ].map((a) => ({ ...a, stBg: a.st === 'ATIVO' ? '#EDFCF2' : '#FFF8E1', stCor: a.st === 'ATIVO' ? '#0E8A46' : '#9A6B00' })),
      matriz: [
        { risco: 'BAIXO', bg: '#EDFCF2', cor: '#0E8A46', ex: 'Post educativo, institucional, republicação de aprovado', teto: 'até A4', obs: 'envelope de volume + kill switch' },
        { risco: 'MÉDIO', bg: '#FFF8E1', cor: '#9A6B00', ex: 'Cita produto sem afirmar cobertura; marca de parceiro', teto: 'até A3', obs: 'aprovação item a item' },
        { risco: 'ALTO', bg: '#FFF0F0', cor: '#C0392B', ex: 'Claim de cobertura, preço ou prazo; renovação com valor', teto: 'até A2', obs: 'compliance obrigatório' },
      ],
      nuncaA4: ['primeira publicação do workspace', 'conteúdo alterado após aprovação', 'mudança de Brand Brain', 'claim de cobertura, preço ou prazo', 'envio sem consent ativo', 'ação sem receipt possível'],
      receipts: s.receipts,
      pausa: s.pausa, pausaRotulo: s.pausa ? 'Liberar operação' : 'Acionar kill switch', pausaBg: s.pausa ? '#0E8A46' : '#C0392B', togglePausa: () => this.togglePausa(),

      canaisConf: s.canais.map((c) => ({ ...c, sigla: cm(c.id).s, cor: cm(c.id).c, ok: c.st === 'ok', stRotulo: c.st === 'ok' ? 'CONECTADO' : 'DESCONECTADO', stBg: c.st === 'ok' ? '#EDFCF2' : '#FFF0F0', stCor: c.st === 'ok' ? '#0E8A46' : '#C0392B' })),
      grupoRotulo: s.grupoTodos ? 'exige todos os moderadores' : 'basta um moderador',
      toggleGrupo: () => this.setState((st) => ({ grupoTodos: !st.grupoTodos })),
      equipe: [
        { n: 'Fernanda Angeloni', p: 'OWNER · aprova tudo, inclusive risco alto', ini: 'FA' },
        { n: 'Rafael Lima', p: 'EDITOR · cria e pede ajuste, não aprova', ini: 'RL' },
        { n: 'Compliance 88i', p: 'MODERADOR · revisa claims antes de você', ini: 'C8' },
      ],

      onbAberto: s.onb === null ? (this.props.iniciarNoOnboarding ?? false) : s.onb,
      onbP1: s.onbPasso === 1, onbP2: s.onbPasso === 2, onbP3: s.onbPasso === 3, onbP4: s.onbPasso === 4,
      onbPassos: [{ n: 1, t: 'Corretora', s: 'nome e site' }, { n: 2, t: 'Leitura', s: 'extração do site' }, { n: 3, t: 'Marca', s: 'revisar e ajustar' }, { n: 4, t: 'Canais', s: 'onde publicar' }].map((p) => {
        const done = s.onbPasso > p.n, at = s.onbPasso === p.n;
        return { ...p, marca: done ? '✓' : String(p.n), bg: done ? '#0FC2C0' : at ? 'rgba(255,255,255,0.12)' : 'transparent', cor: done ? '#04302F' : at ? '#FFFFFF' : '#7FA2AB', borda: done ? '#0FC2C0' : at ? '#0FC2C0' : 'rgba(255,255,255,0.25)', tCor: at || done ? '#FFFFFF' : '#7FA2AB' };
      }),
      onbNome: s.onbNome, setOnbNome: (e) => this.setState({ onbNome: e.target.value }),
      onbUrl: s.onbUrl, setOnbUrl: (e) => this.setState({ onbUrl: e.target.value }),
      extrair: () => this.extrair(),
      onbLeitura: [{ t: 'Página inicial', d: 'proposta de valor e tagline' }, { t: 'Sobre a corretora', d: 'história, equipe, credenciais' }, { t: 'Produtos e coberturas', d: 'auto, vida, residencial, empresarial' }, { t: 'Tom e identidade visual', d: 'vocabulário, cores, tipografia' }].map((l, k) => ({ ...l, marca: s.onbProg > k ? '✓' : '·', cor: s.onbProg > k ? '#0E8A46' : s.onbProg === k ? '#0A8583' : '#C3D2D6' })),
      onbTom: ['Próximo', 'Didático', 'Consultivo', 'Técnico', 'Formal'].map((t) => chip(t, !!s.onbTom[t], () => this.setState((st) => ({ onbTom: { ...st.onbTom, [t]: !st.onbTom[t] } })))),
      onbClaims: [{ id: 'c1', t: '25 anos de mercado segurador', f: 'extraído de /sobre' }, { id: 'c2', t: 'Atendimento de sinistro com acompanhamento', f: 'extraído de /servicos' }, { id: 'c3', t: '+5.000 clientes ativos', f: 'sem fonte verificável', warn: true }].map((c) => {
        const sel = !!s.onbClaims[c.id];
        return { ...c, temWarn: !!c.warn, check: sel ? '✓' : '', checkBg: sel ? '#0E353D' : '#FFFFFF', checkBorda: sel ? '#0E353D' : '#C3D2D6', onToggle: () => this.setState((st) => ({ onbClaims: { ...st.onbClaims, [c.id]: !st.onbClaims[c.id] } })) };
      }),
      onbPaleta: ['#1B3A5C', '#E8A33D', '#2E7D5B', '#F4F1EA'],
      onbTagline: s.onbTagline, setOnbTagline: (e) => this.setState({ onbTagline: e.target.value }),
      onbSeguir: () => this.setState({ onbPasso: 4 }),
      onbCanais: ['Instagram', 'Facebook', 'LinkedIn', 'WhatsApp'].map((c) => chip(c, !!s.onbCanais[c], () => this.setState((st) => ({ onbCanais: { ...st.onbCanais, [c]: !st.onbCanais[c] } })))),
      onbResumo: s.onbNome + ' · ' + Object.keys(s.onbTom).filter((k) => s.onbTom[k]).length + ' atributos de tom · ' + Object.keys(s.onbClaims).filter((k) => s.onbClaims[k]).length + ' claims com fonte · ' + Object.keys(s.onbCanais).filter((k) => s.onbCanais[k]).length + ' canais',
      concluirOnb: () => this.concluirOnb(),

      abaCampanhas: s.abaPlan === 'campanhas', abaJornadas: s.abaPlan === 'jornadas',
      abasPlan: [{ id: 'campanhas', t: 'Campanhas' }, { id: 'jornadas', t: 'Jornadas automáticas' }].map((a) => ({
        ...a, bg: s.abaPlan === a.id ? '#0E353D' : '#FFFFFF', cor: s.abaPlan === a.id ? '#FFFFFF' : '#5A7A82', borda: s.abaPlan === a.id ? '#0E353D' : '#D4DFE2',
        onClick: () => this.setState({ abaPlan: a.id }),
      })),
      campanhas: s.campanhas.map((c) => {
        const st = { ATIVA: ['#EDFCF2', '#0E8A46'], AGENDADA: ['#E6F9F9', '#0A8583'], RASCUNHO: ['#EEF3F4', '#5A7A82'], ENCERRADA: ['#F4F0FE', '#6D5CE7'] }[c.st] || ['#EEF3F4', '#5A7A82'];
        return { ...c, sel: s.campSel === c.id, stBg: st[0], stCor: st[1], canaisTexto: c.canais.join(' · '),
          selBg: s.campSel === c.id ? '#F8FBFB' : '#FFFFFF', selBorda: s.campSel === c.id ? '#0FC2C0' : '#E9F1F2',
          resumo: c.res ? mil(c.res.conversas) + ' conversas · ' + c.res.apolices + ' apólices' : c.pessoas ? mil(c.pessoas) + ' pessoas na audiência' : 'sem audiência definida',
          onSel: () => this.setState({ campSel: c.id }) };
      }),
      camp: (() => {
        const c = s.campanhas.find((x) => x.id === s.campSel) || s.campanhas[0];
        const st = { ATIVA: ['#EDFCF2', '#0E8A46'], AGENDADA: ['#E6F9F9', '#0A8583'], RASCUNHO: ['#EEF3F4', '#5A7A82'], ENCERRADA: ['#F4F0FE', '#6D5CE7'] }[c.st] || ['#EEF3F4', '#5A7A82'];
        const r = c.res || { alcance: 0, cliques: 0, conversas: 0, cotacoes: 0, apolices: 0 };
        const max = Math.max(r.alcance, 1);
        return { ...c, stBg: st[0], stCor: st[1], canaisChips: c.canais.map((x) => ({ canal: x, sigla: cm(x).s, cor: cm(x).c })),
          temRes: !!c.res, semRes: !c.res,
          funil: [
            { t: 'Alcance', v: mil(r.alcance), barra: '100%' },
            { t: 'Cliques', v: mil(r.cliques), barra: Math.max(3, Math.round((r.cliques / max) * 100)) + '%' },
            { t: 'Conversas', v: mil(r.conversas), barra: Math.max(3, Math.round((r.conversas / max) * 100)) + '%' },
            { t: 'Cotações', v: mil(r.cotacoes), barra: Math.max(3, Math.round((r.cotacoes / max) * 100)) + '%' },
            { t: 'Apólices', v: mil(r.apolices), barra: Math.max(2, Math.round((r.apolices / max) * 100)) + '%' },
          ],
          pessoasTexto: c.pessoas ? mil(c.pessoas) + ' pessoas' : 'audiência não definida' };
      })(),

      audiencias: s.audiencias.map((a) => ({ ...a, totalTexto: mil(a.total), elegTexto: mil(a.eleg), bloq: a.total - a.eleg, temUso: a.uso !== 'sem uso', barra: Math.round((a.eleg / a.total) * 100) + '%', onUsar: () => this.usarAudiencia(a.id) })),
      supressoes: ['sinistro em aberto', 'inadimplência ativa', 'opt-out registrado', 'contato nos últimos 7 dias', 'cliente em disputa jurídica'],

      nlEdicoes: s.nlEdicoes.map((e) => {
        const st = { ENVIADA: ['#EDFCF2', '#0E8A46'], AGENDADA: ['#E6F9F9', '#0A8583'], RASCUNHO: ['#EEF3F4', '#5A7A82'] }[e.st] || ['#EEF3F4', '#5A7A82'];
        return { ...e, stBg: st[0], stCor: st[1], onDuplicar: () => this.duplicar(e.id) };
      }),
      nlBlocos: s.items.filter((i) => i.estado !== 'RECUSADO' && i.formato !== 'E-mail').map((i) => {
        const pronto = ['PUBLICADO', 'AGENDADO', 'PUBLICANDO'].includes(i.estado);
        const sel = pronto && !!s.nlSel[i.id];
        const origem = i.estado === 'PUBLICADO' ? 'publicado ' + (i.pubRotulo || '') + (i.m ? ' · ' + mil(i.m.alcance) + ' alcance' : '') : i.estado === 'AGENDADO' || i.estado === 'PUBLICANDO' ? 'aprovado · sai ' + (i.agRotulo || '') : i.estado === 'EXTERNA' ? 'aguardando o cliente aprovar' : i.estado === 'COMPLIANCE' ? 'travado no compliance' : i.estado === 'FALHA' ? 'publicação falhou' : 'ainda sem sua aprovação';
        return { id: i.id, t: i.titulo, vertical: i.vertical, o: origem, snippet: i.corpo.split('\n')[0], sel, bloq: !pronto,
          check: !pronto ? '×' : sel ? '✓' : '', checkBg: !pronto ? '#F4F7F8' : sel ? '#0E353D' : '#FFFFFF', checkBorda: !pronto ? '#E3EDEF' : sel ? '#0E353D' : '#C3D2D6', checkCor: !pronto ? '#C3D2D6' : '#FFFFFF',
          tCor: pronto ? '#0E353D' : '#8AA6AD',
          ordem: sel ? String(s.nlOrdem.indexOf(i.id) < 0 ? s.nlOrdem.length + 1 : s.nlOrdem.indexOf(i.id) + 1).padStart(2, '0') : '',
          onSubir: (ev) => { ev.stopPropagation(); this.mover(i.id, -1); },
          onDescer: (ev) => { ev.stopPropagation(); this.mover(i.id, 1); },
          onToggle: () => { if (!pronto) { this.toast('Só conteúdo aprovado entra na newsletter — este está ' + origem + '.'); return; } this.setState((st) => ({ nlSel: { ...st.nlSel, [i.id]: !st.nlSel[i.id] } })); } };
      }),
      nlCfg: s.nlCfg,
      setNlAssunto: (e) => this.setCfg('assunto', e.target.value),
      setNlPreheader: (e) => this.setCfg('preheader', e.target.value),
      setNlRemetente: (e) => this.setCfg('remetente', e.target.value),
      setNlEmail: (e) => this.setCfg('email', e.target.value),
      setNlReply: (e) => this.setCfg('reply', e.target.value),
      setNlTeste: (e) => this.setCfg('teste', e.target.value),
      nlModelos: [
        { id: 'educativo', t: 'Educativo', d: 'Destaque + dois apoios', ideal: 'conteúdo de prevenção e coberturas', blocos: '3 a 4 blocos',
          thumb: [{ h: 26, w: '100%', c: '#1B3A5C' }, { h: 5, w: '78%', c: '#C3D2D6' }, { h: 13, w: '100%', c: '#E4DFD2' }, { h: 13, w: '100%', c: '#E4DFD2' }] },
        { id: 'radar', t: 'Radar semanal', d: 'Lista numerada, sem imagem', ideal: 'quem quer volume de assunto', blocos: '4 a 6 blocos',
          thumb: [{ h: 7, w: '62%', c: '#1B3A5C' }, { h: 6, w: '100%', c: '#E4DFD2' }, { h: 6, w: '100%', c: '#E4DFD2' }, { h: 6, w: '100%', c: '#E4DFD2' }, { h: 6, w: '88%', c: '#E4DFD2' }] },
        { id: 'renovacao', t: 'Renovação', d: 'Destaque + chamada forte', ideal: 'comunicação individual com valor', blocos: '1 a 2 blocos',
          thumb: [{ h: 22, w: '100%', c: '#1B3A5C' }, { h: 5, w: '70%', c: '#C3D2D6' }, { h: 10, w: '100%', c: '#E4DFD2' }, { h: 11, w: '48%', c: '#E8A33D' }] },
        { id: 'unico', t: 'Um assunto', d: 'Uma peça, texto longo', ideal: 'case, posicionamento, parceria', blocos: '1 bloco',
          thumb: [{ h: 34, w: '100%', c: '#1B3A5C' }, { h: 5, w: '86%', c: '#C3D2D6' }, { h: 5, w: '64%', c: '#C3D2D6' }] },
        { id: 'digest', t: 'Digest mensal', d: 'Compacto, muitos itens', ideal: 'fechamento de mês', blocos: '5 a 8 blocos',
          thumb: [{ h: 6, w: '46%', c: '#1B3A5C' }, { h: 8, w: '100%', c: '#E4DFD2' }, { h: 8, w: '100%', c: '#E4DFD2' }, { h: 8, w: '100%', c: '#E4DFD2' }, { h: 8, w: '100%', c: '#E4DFD2' }, { h: 8, w: '76%', c: '#E4DFD2' }] },
      ].map((m) => {
        const sel = s.nlCfg.modelo === m.id;
        return { ...m, sel, borda: sel ? '#0FC2C0' : '#E9F1F2', bg: sel ? '#F8FBFB' : '#FFFFFF', tCor: sel ? '#0A8583' : '#0E353D',
          selo: sel ? 'EM USO' : '', temSelo: sel, onClick: () => this.setCfg('modelo', m.id) };
      }),
      nlAutoLinhas: [
        { k: 'auto', t: 'Montar sozinha toda quinta', d: 'usa os melhores conteúdos aprovados da semana — a edição cai na sua fila, nunca no envio' },
        { k: 'reenvio', t: 'Reenviar a quem não abriu', d: 'D+3 com assunto alternativo, uma vez por edição' },
        { k: 'sendtime', t: 'Melhor horário por assinante', d: 'ajusta o envio ao horário em que cada pessoa costuma abrir' },
        { k: 'cta', t: 'Bloco fixo de contato', d: 'fecha toda edição com "fale com seu corretor" e o WhatsApp da corretora' },
      ].map((l) => {
        const on = !!s.nlAuto[l.k];
        return { ...l, on, bg: on ? '#0E353D' : '#FFFFFF', borda: on ? '#0E353D' : '#C3D2D6', cor: on ? '#FFFFFF' : '#C3D2D6', check: on ? '✓' : '', onToggle: () => this.toggleAuto(l.k) };
      }),
      nlEstim: (() => {
        const sel = s.items.filter((i) => s.nlSel[i.id] && ['PUBLICADO', 'AGENDADO', 'PUBLICANDO'].includes(i.estado));
        const palavras = sel.reduce((a, i) => a + i.corpo.split(/\s+/).length, 0) + 40;
        const dest = { 'Clientes ativos': 948, 'Prospects do site': 312, 'Corretores parceiros': 64 }[s.nlCfg.lista] || 0;
        return { dest: mil(dest), leitura: Math.max(1, Math.round(palavras / 200)) + ' min de leitura', blocos: sel.length + (s.nlAuto.cta ? 1 : 0) + ' blocos', reenvio: s.nlAuto.reenvio ? '+ reenvio D+3 a quem não abrir' : 'sem reenvio' };
      })(),
      nlCadencias: ['Semanal · sexta, 9h', 'Quinzenal · 1ª e 3ª sexta', 'Mensal · última sexta'].map((c) => ({ t: c, bg: s.nlCfg.cadencia === c ? '#0E353D' : '#FFFFFF', cor: s.nlCfg.cadencia === c ? '#FFFFFF' : '#5A7A82', borda: s.nlCfg.cadencia === c ? '#0E353D' : '#D4DFE2', onClick: () => this.setCfg('cadencia', c) })),
      nlListas: ['Clientes ativos', 'Prospects do site', 'Corretores parceiros'].map((l) => ({ t: l, bg: s.nlCfg.lista === l ? '#0E353D' : '#FFFFFF', cor: s.nlCfg.lista === l ? '#FFFFFF' : '#5A7A82', borda: s.nlCfg.lista === l ? '#0E353D' : '#D4DFE2', onClick: () => this.setCfg('lista', l) })),
      nlUtm: s.nlCfg.utm, nlUtmBg: s.nlCfg.utm ? '#0E353D' : '#FFFFFF', nlUtmCor: s.nlCfg.utm ? '#FFFFFF' : '#C3D2D6', nlUtmBorda: s.nlCfg.utm ? '#0E353D' : '#C3D2D6', nlUtmCheck: s.nlCfg.utm ? '✓' : '',
      toggleUtm: () => this.setCfg('utm', !s.nlCfg.utm),
      nlPixel: s.nlCfg.pixel, nlPixelBg: s.nlCfg.pixel ? '#0E353D' : '#FFFFFF', nlPixelCor: s.nlCfg.pixel ? '#FFFFFF' : '#C3D2D6', nlPixelBorda: s.nlCfg.pixel ? '#0E353D' : '#C3D2D6', nlPixelCheck: s.nlCfg.pixel ? '✓' : '',
      togglePixel: () => this.setCfg('pixel', !s.nlCfg.pixel),
      enviarTeste: () => this.enviarTeste(),
      nlPrevia: (() => {
        const m = s.nlCfg.modelo;
        const brutos = s.items.filter((i) => s.nlSel[i.id] && ['PUBLICADO', 'AGENDADO', 'PUBLICANDO'].includes(i.estado));
        const pos = (id) => { const k = s.nlOrdem.indexOf(id); return k < 0 ? 99 : k; };
        let sel = brutos.slice().sort((a, b) => pos(a.id) - pos(b.id));
        if (m === 'unico' || m === 'renovacao') sel = sel.slice(0, m === 'unico' ? 1 : 2);
        const comHero = ['educativo', 'renovacao', 'unico'].includes(m);
        const hero = comHero ? sel[0] : null;
        const resto = hero ? sel.slice(1) : sel;
        return {
          n: sel.length, vazia: !sel.length,
          temHero: !!hero, heroTitulo: hero ? hero.titulo : '', heroTexto: hero ? (m === 'unico' ? hero.corpo : hero.corpo.split('\n')[0]) : '', heroGrad: hero ? GRAD[(hero.grad || 0) % 6] : GRAD[0], heroAlto: m === 'unico' ? '104px' : '74px',
          numerada: m === 'radar' || m === 'digest', compacto: m === 'digest',
          temCta: !!s.nlAuto.cta, ctaTexto: m === 'renovacao' ? 'Quero revisar minha renovação' : 'Falar com meu corretor',
          itens: resto.map((i, k) => ({ titulo: i.titulo, texto: i.corpo.split('\n')[0], vertical: i.vertical, num: String(k + (hero ? 2 : 1)).padStart(2, '0') })),
        };
      })(),
      nlSegmentos: [
        { n: 'Clientes ativos', p: '948', d: 'opt-in duplo · consent registrado na apólice' },
        { n: 'Prospects do site', p: '312', d: 'opt-in simples · formulário de cotação' },
        { n: 'Corretores parceiros', p: '64', d: 'lista B2B · conteúdo de mercado' },
      ],
      nlMsg: s.nlMsg, temNlMsg: !!s.nlMsg, montarEdicao: () => this.montarEdicao(),
      nlAbertura: '38,4%', nlCliques: '6,1%', nlDesinscr: '0,3%', nlBase: '1.324',

      periodos: ['7 dias', '30 dias', '90 dias'].map((p) => ({ t: p, bg: s.periodo === p ? '#0E353D' : '#FFFFFF', cor: s.periodo === p ? '#FFFFFF' : '#5A7A82', borda: s.periodo === p ? '#0E353D' : '#D4DFE2', onClick: () => this.setState({ periodo: p }) })),
      periodoAtual: s.periodo,
      funilGeral: (() => {
        const f = s.periodo === '7 dias' ? [1420, 26, 6, 3, 1] : s.periodo === '90 dias' ? [18640, 312, 64, 27, 11] : [6282, 104, 21, 9, 4];
        const nomes = ['Pessoas alcançadas', 'Cliques no link', 'Conversas abertas', 'Cotações pedidas', 'Apólices emitidas'];
        return f.map((v, k) => ({ t: nomes[k], v: mil(v), barra: Math.max(3, Math.round((v / f[0]) * 100)) + '%', conv: k ? Math.round((v / f[k - 1]) * 1000) / 10 + '% do passo anterior' : 'base do período' }));
      })(),
      porVertical: [
        { v: 'Prevenção', posts: 4, alcance: '5.210', conv: '17 conversas', barra: '86%' },
        { v: 'Coberturas', posts: 3, alcance: '2.870', conv: '9 conversas', barra: '47%' },
        { v: 'Renovação', posts: 2, alcance: '612', conv: '21 conversas', barra: '10%' },
        { v: 'Institucional', posts: 2, alcance: '1.140', conv: '2 conversas', barra: '19%' },
      ],
      horarios: [
        { t: 'Quinta, 9h–10h', d: 'melhor janela geral · +34% de alcance', destaque: true },
        { t: 'Sexta, 18h–19h', d: 'melhor para carrossel educativo' },
        { t: 'Terça, 12h–13h', d: 'melhor para reels' },
        { t: 'Domingo', d: 'pior desempenho — evite agendar' },
      ],
      teste: { a: 'Antes de renovar, faça 3 perguntas', b: 'Sua apólice pode estar caindo no automático', vencedor: 'A', dif: '+41% de cliques', obs: 'Rodou com 50/50 da base; o vencedor virou o texto padrão da campanha.' },
      custoConversa: brl(22.02), custoApolice: brl(115.6),
    };
  }
}

const PAUTAS = [
  { id: 'p1', t: 'Renovação sem susto: o que revisar antes', h: 'Antes de renovar, revise 3 coisas', v: 'Renovação', f: 'Carrossel', c: ['Instagram', 'Facebook'], r: 'baixo', janela: '1ª semana', iso: '2026-09-02T10:00', corpo: 'Valor do carro, uso e franquia: os três pontos que mudam o preço da renovação.' },
  { id: 'p2', t: 'Chuvas de setembro: carro na garagem', h: 'Garagem cheia, rua alagada', v: 'Prevenção', f: 'Post 1:1', c: ['Instagram'], r: 'baixo', janela: '1ª semana', iso: '2026-09-04T18:00', corpo: 'Onde deixar o carro quando a previsão é de temporal — e o que o seguro cobre em alagamento.' },
  { id: 'p3', t: 'Assistência 24h na prática: 3 histórias', h: 'Três noites, três resgates', v: 'Coberturas', f: 'Reels', c: ['Instagram'], r: 'baixo', janela: '2ª semana' },
  { id: 'p4', t: 'Frota de empresa: o que muda no seguro', h: 'Sua empresa tem frota?', v: 'Coberturas', f: 'Artigo', c: ['LinkedIn'], r: 'medio', janela: '2ª semana' },
  { id: 'p5', t: 'Nova regra de aviso de sinistro', h: 'Mudou o prazo de aviso', v: 'Mercado', f: 'Post 1:1', c: ['Instagram', 'LinkedIn'], r: 'medio', janela: '3ª semana' },
  { id: 'p6', t: 'Seguro para entregadores: por que agora', h: 'Quem vive na rua precisa de rede', v: 'Institucional', f: 'Carrossel', c: ['Instagram'], r: 'baixo', janela: '3ª semana' },
  { id: 'p7', t: 'Como calculamos seu prêmio', h: 'De onde vem o preço', v: 'Coberturas', f: 'Carrossel', c: ['Instagram'], r: 'alto', janela: '4ª semana' },
  { id: 'p8', t: 'Balanço: 6 meses de atendimento', h: '6 meses, 214 sinistros resolvidos', v: 'Institucional', f: 'Post 1:1', c: ['Instagram', 'Facebook'], r: 'alto', janela: '4ª semana' },
];
export { Component };
