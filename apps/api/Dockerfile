# syntax=docker/dockerfile:1
# TeamSpace API — NestJS + Prisma（pnpm workspace 内构建）
FROM node:20-alpine AS deps
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @teamspace/api...

FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @teamspace/api exec prisma generate \
 && pnpm --filter @teamspace/api run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/prisma ./prisma
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps-api-node_modules
# Prisma client 生成在 node_modules/.prisma，运行时装入路径
RUN cp -r apps-api-node_modules/* node_modules/ 2>/dev/null || true && rm -rf apps-api-node_modules
USER app
EXPOSE 3001
CMD ["node", "dist/src/main.js"]
