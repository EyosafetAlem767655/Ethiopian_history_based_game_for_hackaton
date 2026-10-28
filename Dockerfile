FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@11.5.1 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/server/package.json ./apps/server/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY apps/server apps/server
COPY packages/shared packages/shared
COPY tsconfig.json ./
ENV NODE_ENV=production
EXPOSE 2567
CMD ["node","--import","tsx","apps/server/src/index.ts"]
