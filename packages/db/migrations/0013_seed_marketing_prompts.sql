-- =====================================================================
-- 0013_seed_marketing_prompts.sql
--
-- Os modulos por objetivo e a biblioteca inicial de prompts.
--
-- Separado de 0012 pela mesma razao que 0006 e separado de 0004:
-- estrutura e conteudo governado mudam por motivos diferentes e em
-- ritmos diferentes. Um template novo nao deveria exigir DDL.
--
-- ── Sobre o status dos templates ──────────────────────────────────────
--
-- Todos entram ACTIVE. Diferente de agente e capability, um template de
-- prompt nao autoriza nada: ele so descreve o que escrever, e o que ele
-- escreve continua passando por claims, quality.precheck, policy e
-- aprovacao humana antes de existir como publicacao. O gate esta depois,
-- nao aqui.
--
-- ── Sobre o texto dos templates ───────────────────────────────────────
--
-- Nenhum deles manda afirmar cobertura, preco ou prazo. Isso e
-- deliberado: o redator recusa claim material sem evidence
-- (CLAIM_UNSUPPORTED), entao um template que pedisse "destaque nossa
-- cobertura de X" produziria recusa em vez de conteudo. Os templates
-- pedem angulo, formato e publico — nunca a afirmacao.
--
-- O corpo vai em dollar-quoting ($tpl$): o texto tem quebra de linha e
-- aspas, e escapar isso a mao e o tipo de coisa que passa despercebida
-- em revisao.
-- =====================================================================

insert into mkt.marketing_modules (objective, module_key, title, description, ordem) values
  ('NOVOS_NEGOCIOS', 'planejamento_pipeline', 'Planejamento por pipeline',
   'O calendario prioriza temas de dor, solucao e prova, com CTA consultiva no fim de cada peca.', 1),
  ('NOVOS_NEGOCIOS', 'conteudo_por_publico', 'Conteudo por publico',
   'Cada segmento recebe linguagem, exemplos e produtos associados na configuracao.', 2),
  ('NOVOS_NEGOCIOS', 'captacao_distribuicao', 'Captacao e distribuicao',
   'Publicacao nos seus canais e materiais de apoio para o time comercial.', 3),

  ('AUTORIDADE', 'pilares_editoriais', 'Pilares editoriais',
   'Distribuicao percentual que faz educacao e analise ocuparem o peso certo na agenda.', 1),
  ('AUTORIDADE', 'biblioteca_inteligente', 'Biblioteca inteligente',
   'Historico organizado por tema, publico e status, pronto para reuso e aprofundamento.', 2),
  ('AUTORIDADE', 'series_recorrencia', 'Series e recorrencia',
   'Temas que voltam com cadencia definida em vez de posts avulsos.', 3),

  ('MARCA', 'posicionamento_aplicado', 'Posicionamento aplicado',
   'Proposta de valor e atributos de percepcao entram em toda peca produzida.', 1),
  ('MARCA', 'tom_de_voz_travado', 'Tom de voz travado',
   'Estilos, tons e palavras proibidas viram regra editorial, nao sugestao.', 2),
  ('MARCA', 'consistencia_entre_canais', 'Consistencia entre canais',
   'A mesma historia em site, redes e materiais comerciais.', 3),

  ('RELACIONAMENTO', 'conteudo_de_servico', 'Conteudo de servico',
   'Orientacao, prevencao e uso da apolice para a base ativa de clientes.', 1),
  ('RELACIONAMENTO', 'regua_de_contato', 'Regua de contato',
   'Cadencia de relacionamento planejada junto com o calendario editorial.', 2),
  ('RELACIONAMENTO', 'renovacao_retencao', 'Renovacao e retencao',
   'Temas ligados ao ciclo da carteira em vez de campanhas isoladas.', 3);

-- ---------------------------------------------------------------------
-- A capability passa a poder falhar por motivos novos
-- ---------------------------------------------------------------------
--
-- content.create_draft agora aplica o perfil de marketing, e com isso
-- ganha tres recusas que antes nao existiam:
--
--   AMBIGUOUS_GOAL           marca com estrategia, peca sem tema
--   UNSUPPORTED_VALUE        nao ha template para aquele objetivo/canal
--   SCHEMA_VALIDATION_FAILED template incoerente com o que declara
--
-- Declarar no registry nao e burocracia: o registry e o que a policy e a
-- microcopy leem. Uma capability que recusa por um codigo que o registry
-- nao lista age por uma regra e e julgada por outra — que e a divergencia
-- que este projeto mais evita.
--
-- Os tres codigos ja existem no enum fechado de reason codes; nenhum
-- codigo novo entra aqui.
update mkt.capability_registry
   set error_codes = error_codes
                   || '{AMBIGUOUS_GOAL,UNSUPPORTED_VALUE,SCHEMA_VALIDATION_FAILED}'::text[]
 where capability_id = 'content.create_draft';

-- ---------------------------------------------------------------------
-- Templates base: um por objetivo, sem canal (servem a qualquer um).
-- ---------------------------------------------------------------------
insert into mkt.prompt_templates
  (template_id, version, status, objective, module_key, org_types, channel, formato, body, variables, owner)
values
  ('PT-NOVOS-NEGOCIOS-BASE', 1, 'ACTIVE', 'NOVOS_NEGOCIOS', 'conteudo_por_publico', '{}', null, 'Post',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e gerar novas oportunidades comerciais.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Estruture em torno de uma dor concreta que esse publico reconhece, o caminho para
resolve-la e um convite a conversar. Nao prometa cobertura, preco ou prazo:
descreva o problema e o criterio de decisao, nao o produto.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga'),

  ('PT-AUTORIDADE-BASE', 1, 'ACTIVE', 'AUTORIDADE', 'pilares_editoriais', '{}', null, 'Artigo',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e construir autoridade tecnica.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Explique o mecanismo, nao so a conclusao: quem le tem de terminar entendendo por
que a coisa funciona assim. Prefira precisao a entusiasmo. Onde faltar dado para
sustentar uma afirmacao, escreva sem ela.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga'),

  ('PT-MARCA-BASE', 1, 'ACTIVE', 'MARCA', 'posicionamento_aplicado', '{}', null, 'Post',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e fortalecer a percepcao de marca.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

A peca deve soar como essa empresa e nao como qualquer outra do setor. Escolha um
angulo que so ela poderia assinar. Evite superlativo: o que diferencia aparece no
criterio que ela usa, nao no adjetivo que ela escolhe.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga'),

  ('PT-RELACIONAMENTO-BASE', 1, 'ACTIVE', 'RELACIONAMENTO', 'conteudo_de_servico', '{}', null, 'Post',
$tpl$Escreva para {{brand_name}}, que atua como {{org_type_label}}.
O objetivo desta peca e servir quem ja e cliente.
Publico: {{publico_alvo}}.
O que a empresa comunica: {{o_que_comunica}}
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Escreva para quem ja comprou: orientacao pratica, prevencao, como usar o que ja se
tem. Nao venda de novo o que a pessoa ja contratou.$tpl$,
   '{brand_name,org_type_label,publico_alvo,o_que_comunica,como_comunica,briefing}',
   'olga');

-- ---------------------------------------------------------------------
-- Templates por canal: mais especificos, vencem o base na escolha.
-- ---------------------------------------------------------------------
insert into mkt.prompt_templates
  (template_id, version, status, objective, module_key, org_types, channel, formato, body, variables, owner)
values
  ('PT-AUTORIDADE-LINKEDIN', 1, 'ACTIVE', 'AUTORIDADE', 'pilares_editoriais', '{}', 'LINKEDIN', 'Artigo',
$tpl$Escreva para {{brand_name}} publicar no LinkedIn.
Publico: {{publico_alvo}}.
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Abra com a afirmacao mais util do texto, nao com contexto. Paragrafos curtos. Uma
ideia por paragrafo. Termine com a pergunta que voce genuinamente faria a quem
trabalha com isso — nao com pedido de engajamento.$tpl$,
   '{brand_name,publico_alvo,como_comunica,briefing}',
   'olga'),

  ('PT-RELACIONAMENTO-INSTAGRAM', 1, 'ACTIVE', 'RELACIONAMENTO', 'conteudo_de_servico', '{}', 'INSTAGRAM', 'Carrossel',
$tpl$Escreva para {{brand_name}} publicar no Instagram, em formato de carrossel.
Publico: {{publico_alvo}}.
Como a empresa se comunica: {{como_comunica}}
Tema pedido agora: {{briefing}}

Cada tela precisa fazer sentido sozinha e puxar a proxima. Primeira tela: o
problema em uma frase. Ultimas: o que fazer na pratica. Linguagem direta, sem
jargao de seguro que o cliente final nao usa.$tpl$,
   '{brand_name,publico_alvo,como_comunica,briefing}',
   'olga');
