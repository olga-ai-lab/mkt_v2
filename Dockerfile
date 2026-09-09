# =====================================================================
# Imagem do apps/web (ADR-0012 — Railway).
#
# Ate aqui nao havia configuracao de deploy nenhuma no repositorio: nem
# vercel.json, nem Dockerfile, nem Procfile. O unico registro de intencao era
# a ADR-0002. Este arquivo e a metade material da decisao de ir para o Railway.
#
# Tres estagios, e o motivo de cada um:
#
#   deps    instala com o lockfile e nada mais, para a camada ser reaproveitada
#           entre builds em que so o codigo mudou
#   build   compila; precisa das dependencias de desenvolvimento
#   run     recebe so a saida `standalone` e roda como usuario sem privilegio
#
# O que NAO acontece aqui: migration. Rodar migration no start do container
# parece conveniente e quebra no dia em que houver duas replicas — duas
# subidas simultaneas aplicando a mesma migration e a forma mais rapida de
# corromper o controle de versao do schema. Migration e passo de release, e
# esta em docs/DEPLOY.md.
# =====================================================================

FROM node:22-slim AS deps
WORKDIR /app
# Os package.json de todos os workspaces antes do codigo: e o que permite ao
# Docker reaproveitar esta camada enquanto as dependencias nao mudam.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/policy/package.json    packages/policy/
COPY packages/gateway/package.json   packages/gateway/
COPY packages/runtime/package.json   packages/runtime/
COPY packages/db/package.json        packages/db/
COPY apps/web/package.json           apps/web/
COPY apps/worker/package.json        apps/worker/
RUN npm ci --no-audit --no-fund --maxsockets 4

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# O schema entra no build porque `next build` avalia modulos que o leem. O
# valor de execucao vem do ambiente do Railway e sobrescreve este.
ENV MKT_SCHEMA=mkt_v2
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @olga/web

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Usuario sem privilegio. A imagem base traz `node` (uid 1000) pronto — criar
# outro so acrescentaria uma linha para o mesmo resultado.
USER node

# `standalone` traz o servidor e as dependencias que ele de fato importa. Os
# dois COPY seguintes existem porque o Next NAO os inclui ali: `static` e
# `public` sao servidos pelo processo, mas ficam fora do bundle.
COPY --chown=node:node --from=build /app/apps/web/.next/standalone ./
COPY --chown=node:node --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Os contratos sao lidos do DISCO em tempo de execucao, e nao importados — e
# bundler nenhum rastreia isso. Sem estas duas linhas a imagem sobe, responde
# ao primeiro request com 500 e um ENOENT dentro de um chunk do webpack.
# Aconteceu na primeira imagem construida aqui; e por isso que a verificacao
# do deploy roda a imagem em vez de so construi-la.
COPY --chown=node:node --from=build /app/packages/contracts/enums   ./packages/contracts/enums
COPY --chown=node:node --from=build /app/packages/contracts/schemas ./packages/contracts/schemas

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
