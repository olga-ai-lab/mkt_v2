/**
 * Os contratos de fonte, como o dublê dos testes sem banco os enxerga.
 *
 * Este arquivo existe para NÃO haver duas listas. O retrieval é testado sem
 * Postgres, então precisa de um dublê; e um dublê escrito à mão diverge da
 * migration no dia em que alguém muda um prazo — sem nada quebrar, porque os
 * dois testes continuariam verdes cada um com a sua verdade.
 *
 * Quem amarra os dois é `packages/db/test/source-contracts.test.mjs`, que lê
 * mkt.source_contracts do banco de verdade e compara com o que está aqui.
 * Mudar a migration sem mudar este arquivo quebra lá.
 */
export const CONTRATOS_DE_FONTE = {
  BRAND_BRAIN: {
    source_kind: "BRAND_BRAIN", temporal_authority: "activated_at",
    max_age_days: 180, default_quality: "HIGH", carries_pii: false,
  },
  SOURCE_ARTIFACT: {
    source_kind: "SOURCE_ARTIFACT", temporal_authority: "retrieved_at",
    max_age_days: 30, default_quality: "MEDIUM", carries_pii: false,
  },
  DOMAIN_RECORD: {
    source_kind: "DOMAIN_RECORD", temporal_authority: "created_at",
    max_age_days: null, default_quality: "HIGH", carries_pii: false,
  },
  UPLOADED_FILE: {
    source_kind: "UPLOADED_FILE", temporal_authority: "retrieved_at",
    max_age_days: 365, default_quality: "MEDIUM", carries_pii: true,
  },
  PROVIDER_RESPONSE: {
    source_kind: "PROVIDER_RESPONSE", temporal_authority: "recorded_at",
    max_age_days: null, default_quality: "HIGH", carries_pii: false,
  },
};
