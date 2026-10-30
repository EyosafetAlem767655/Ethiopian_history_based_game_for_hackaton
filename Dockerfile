FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/server/package.json ./apps/server/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
# The web app is served by this same service. Vite embeds VITE_* values at build time;
# Render passes the service's environment variables to the build as these arguments.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_RECORDS_ADDRESS
RUN pnpm build
COPY apps/server apps/server
COPY scripts/backup.ts scripts/backup.ts
ENV NODE_ENV=production
USER node
EXPOSE 2567
CMD ["node","--import","tsx","apps/server/src/index.ts"]
