# IM 即时通讯功能实现计划

## Context

在已有 WebSocket 实时协作（presence + 任务广播）的基础上，仿照钉钉为 TeamSpace 增加组织内即时通讯能力：成员之间可私聊、可建群聊，支持文字/图片/文件，消息实时推送并持久化。目标是一个简单可用的 P0 版本，不做已读回执、消息撤回、消息搜索等高级能力。

## 核心设计决策

1. **私聊/群聊统一建模**：单表 `Conversation`（`type = DIRECT | GROUP`）。私聊通过 `directKey = orgId:uidA:uidB`（字典序）保证幂等去重；群聊 `title` 必填。
2. **WebSocket 推送走"用户房间"**：socket 鉴权成功后自动 join `user:{userId}`；服务端发消息时取该会话全部 ACTIVE 成员逐一 `emitToUser` 推送。会话列表页与聊天窗口都能收到事件，天然支持多标签页。
3. **附件独立存储**：不复用 `prj_file`（该表 projectId 非空且语义是项目交付物）。新增 `MessageAttachment` 表，磁盘目录 `.uploads/{orgId}/chat/{convId}/{nanoid}`，复用 20MB 上限与 streamFile 下载模式。
4. **RLS 双层策略**：组织隔离 + 会话成员资格。`im_conversation`/`im_conversation_member` 允许"我是成员 OR 我是创建者"；`im_message`/`im_message_attachment` 要求"组织一致 AND 我是该会话 ACTIVE 成员"。
5. **Prisma 上下文**：新增 `prisma.withOrgUser(orgId, userId, fn)`，同一事务内 set 两个 GUC，不动现有 withOrg/withUser。

## 数据模型（schema.prisma 末尾新增）

- `Conversation`：id / organizationId / type(DIRECT|GROUP) / title? / directKey? / createdById / lastMessageAt / createdAt / updatedAt
  - `@@unique([organizationId, directKey])`，`@@index([organizationId, lastMessageAt(sort: Desc)])`
- `ConversationMember`：id / conversationId / organizationId / userId / role(OWNER|MEMBER) / status(ACTIVE|LEFT) / lastReadMessageId? / joinedAt
  - `@@unique([conversationId, userId])`，`@@index([organizationId, userId, status])`
- `Message`：id / conversationId / organizationId / senderId / type(TEXT|IMAGE|FILE) / content / attachmentId? / createdAt
  - `@@index([conversationId, createdAt])`
- `MessageAttachment`：id / organizationId / conversationId / uploaderId / name / objectKey / size(BigInt) / mimeType / createdAt
- 枚举：`ConversationType` / `ConversationMemberRole` / `ConversationMemberStatus` / `MessageType`
- User / Organization 补 back-relations

未读数：不引入 MessageRead 表，用 `ConversationMember.lastReadMessageId` 与会话最新消息对比聚合 count。

## API 端点（REST）

控制器 `apps/api/src/modules/im/im.controller.ts`，全部走 OrgContextGuard + 成员校验：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/conversations` | 我的会话列表（含 peer、最后一条消息、未读数），按 lastMessageAt desc |
| POST | `/conversations/direct` | body { userId }，幂等 |
| POST | `/conversations/group` | body { title, memberIds[] } |
| GET | `/conversations/:id` | 详情含成员列表 |
| POST | `/conversations/:id/members` | 仅群聊，加成员 |
| DELETE | `/conversations/:id/members/:userId` | 仅群聊，移除/退出（status=LEFT） |
| POST | `/conversations/:id/read` | body { lastReadMessageId } |
| GET | `/conversations/:id/messages?beforeId=&limit=50` | 倒序分页 |
| POST | `/conversations/:id/messages` | body { type, content, attachmentId? }，事务内写消息+更新 lastMessageAt+审计+emitToUsers |
| POST | `/conversations/:id/attachments` | multipart 上传，返回 attachmentId |
| GET | `/messages/attachments/:id/download` | 校验 ACTIVE 成员后流式下载 |

权限：新增菜单 `im:view` / `im:use` / `im:group:create` / `im:attachment:upload`，挂给 OWNER/ADMIN/MEMBER（GUEST 不给 group:create）。

## WebSocket 扩展

- `RealtimeEventsService` 新增：`userRoom(userId)`、`emitToUser(userId, event, payload)`、`emitToUsers(userIds[], event, payload)`
- `CollaborationGateway.authenticate` 成功后自动 `client.join(userRoom(user.id))`
- 事件：
  - `im:message:new` → { conversationId, message: { id, senderId, senderName, type, content, attachment?, createdAt } }
  - `im:conversation:updated` → { conversationId, lastMessageAt, lastMessagePreview }
  - `im:member:joined` / `im:member:left` → { conversationId, userId }

## RLS（enable-rls.ts 追加）

```sql
-- im_conversation / im_conversation_member: 组织一致 AND (我是成员 OR 我是创建者)
-- im_message / im_message_attachment: 组织一致 AND conversation_id IN (本人 ACTIVE 成员会话)
```

策略引用 `app.current_org_id` + `app.current_user_id` 两个 GUC。

## PrismaService 新增

```ts
async withOrgUser<T>(orgId, userId, fn) {
  return this.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  }, { timeout: 30000, maxWait: 10000 });
}
```

## 前端

- 路由：`apps/web/src/app/(app)/im/page.tsx`（左会话列表 + 右聊天窗口，query `?c=convId`）
- 组件：
  - `components/im/ConversationList.tsx` / `ConversationItem.tsx`
  - `components/im/ChatWindow.tsx` / `MessageBubble.tsx` / `MessageComposer.tsx`
  - `components/im/NewConversationModal.tsx`（拉 GET /memberships 选人）
- 状态：`store/im.ts`（zustand：currentConversationId / unreadByConvId / messagesByConvId）
- Hook：`lib/use-im-realtime.ts`（模块级 socket 单例，进 (app) 建立连接，收到 im:message:new 时追加或累加未读）
- Sidebar 增加"消息"入口（icon: MessageSquare, perm: im:view）

## 文件清单

**新建（后端）**
- `apps/api/src/modules/im/im.module.ts`
- `apps/api/src/modules/im/im.controller.ts`
- `apps/api/src/modules/im/dto/im.dto.ts`

**新建（前端）**
- `apps/web/src/app/(app)/im/page.tsx`
- `apps/web/src/components/im/ConversationList.tsx`
- `apps/web/src/components/im/ConversationItem.tsx`
- `apps/web/src/components/im/ChatWindow.tsx`
- `apps/web/src/components/im/MessageBubble.tsx`
- `apps/web/src/components/im/MessageComposer.tsx`
- `apps/web/src/components/im/NewConversationModal.tsx`
- `apps/web/src/lib/use-im-realtime.ts`
- `apps/web/src/store/im.ts`

**修改**
- `apps/api/prisma/schema.prisma` — 新增 4 表 + 4 枚举 + back-relations
- `apps/api/scripts/enable-rls.ts` — 追加 im_* RLS
- `apps/api/src/prisma/prisma.service.ts` — 新增 withOrgUser
- `apps/api/src/modules/realtime/realtime-events.service.ts` — 新增 userRoom/emitToUser/emitToUsers
- `apps/api/src/modules/realtime/collaboration.gateway.ts` — authenticate 后 join user room
- `apps/api/src/app.module.ts` — imports ImModule
- `apps/api/prisma/seed.ts` — 新增 im 菜单权限；可选演示会话
- `apps/web/src/components/Sidebar.tsx` — 增加"消息"入口

## 实施顺序

1. Schema + `npx prisma db push` + enable-rls + withOrgUser
2. seed 增加 im 菜单权限
3. RealtimeEventsService + Gateway 扩展（user room）
4. ImModule 后端全部端点（Swagger 跑通：建私聊→发文本→传图片→拉历史→已读）
5. 前端 store + use-im-realtime + /im 页面
6. 端到端合成数据验证：两浏览器互发 + RLS 跨组织拒绝

## 验收方式

- 编译通过：API 无 TS 错误，Web 无 build 错误
- REST 手工测试：建会话、发消息、传附件、拉历史、标记已读
- WebSocket：两浏览器同组织互发消息实时到达
- 安全：用 A 组织 token + B 组织 conversationId 请求 → 403/404
- RLS：直接连 DB 以应用角色查询，跨组织 message 不可见

## 取舍

- 不做已读回执（只在会话列表显示未读数，聊天页内不显示"对方已读"）
- 不做消息撤回/编辑/搜索
- 群聊改名/转让群主 P0 不做，schema 已留字段
- 附件 20MB 上限，与项目文件一致
