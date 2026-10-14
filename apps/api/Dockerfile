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
# 复刻 pnpm workspace 相对布局：apps/api 内的符号链接指向 ../../node_modules/.pnpm，
# 因此 runner 内必须保持 <root>/node_modules 与 <root>/apps/api/* 的相对位置一致
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
USER app
EXPOSE 3001
# 存活探针：进程能响应即健康（就绪探针 /health/ready 供 ALB/Nginx 摘流）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health/live >/dev/null 2>&1 || exit 1
WORKDIR /app/apps/api
CMD ["node", "dist/main.js"]
