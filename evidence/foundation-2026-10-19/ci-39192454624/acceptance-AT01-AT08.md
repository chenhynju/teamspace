# TeamSpace 端到端验收证据（AT01–AT08）

- 执行时间：2026-10-19T02:59:13.957Z
- API：`http://localhost:3001/api/v1`
- 数据：合成种子数据（密码统一 Passw0rd!）
- 结果：**33/33 通过**

## AT01

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | 本组织成员可读取本组织项目（正常基线） | 200 | 200（项目数 1） | PASS |
| 2 | 携带其它组织 x-organization-id 被应用层拒绝 | 403 NOT_MEMBER | 403 NOT_MEMBER 你不是该组织的成员 | PASS |
| 3 | RLS 防御层：globex 上下文中 acme 项目可见数为 0 | cross=0, own≥1 | cross=0, own=1 | PASS |

## AT02

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | 过期邀请被拒绝 | 410 INVITE_EXPIRED | 410 INVITE_EXPIRED 邀请已过期 | PASS |
| 2 | 已撤销邀请被拒绝 | 410 INVITE_REVOKED | 410 INVITE_REVOKED 邀请已被撤销 | PASS |
| 3 | 待处理邀请可正常加入（正常路径） | 200 accepted=true | 201 {"accepted":true,"organizationId":"cmveo0wvm000ywbbc2598fk56","membershipId":"cmveo15dp000k3at0udutag5x"} | PASS |
| 4 | 同一邀请不可重复使用 | 409 INVITE_USED | 409 INVITE_USED | PASS |

## AT03

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | 未登录访客猜测内部文件 ID 被拒 | 401 | 401 {"code":"UNAUTHORIZED","message":"未登录或登录已过期","request_id":"8i_EqlHAghwSBnNQ","re | PASS |
| 2 | 有效 share 链接可免登录下载（正常路径） | 200 且内容非空 | 200，内容长度 68 字符 | PASS |
| 3 | 过期 share 链接被拒绝 | 410 | 410 SHARE_EXPIRED 共享链接已过期 | PASS |

## AT04

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | 停用前成员可正常访问（基线） | 200 | 200 | PASS |
| 2 | 停用后下一请求立即失效（守卫每请求反查） | 403 MEMBER_SUSPENDED/非 ACTIVE | 403 MEMBERSHIP_INACTIVE 成员状态无效（已暂停或移除） | PASS |
| 3 | 恢复后访问重新放行（恢复路径） | 200 | 200 | PASS |

## AT05

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | 首次事件（带 HMAC 签名）施加权益 | 200 applied=ai_credits+100000，额度 100000 → 200000 | 201 {"received":true,"eventId":"evt-at05-1792378753517","applied":"ai_credits+100000"}；额度 100000 → 200000 | PASS |
| 2 | 重复事件判重且不重复增加权益 | 200 duplicate=true，额度保持 200000 | 201 {"duplicate":true,"eventId":"evt-at05-1792378753517"}；额度 200000 → 200000 | PASS |
| 3 | 无签名事件被拒绝（漏洞修复证据） | 401 WEBHOOK_SIGNATURE_MISSING | 401 WEBHOOK_SIGNATURE_MISSING 缺少 webhook 签名或原始请求体 | PASS |
| 4 | 伪造签名事件被拒绝 | 401 WEBHOOK_SIGNATURE_INVALID | 401 WEBHOOK_SIGNATURE_INVALID | PASS |

## AT06

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | DEPT_AND_CHILD 可见下级部门成员（bug 修复证据） | 列表含 at06child@acme.dev | admin@acme.dev, member@acme.dev, at06child@acme.dev | PASS |
| 2 | DEPT_AND_CHILD 不泄漏范围外兄弟部门 | 列表不含 at06sib@acme.dev | admin@acme.dev, member@acme.dev, at06child@acme.dev | PASS |

## AT07

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | 生命周期执行入口可用（平台超管） | 201 scanned=3 | 201 scanned=3 | PASS |
| 2 | 账期到期 2 天 → PAST_DUE 进入宽限 | PAST_DUE | PAST_DUE | PASS |
| 3 | 宽限期内保留 PRO 权益 | org.planId=PRO | cmveo0wt2000bwbbcaq46xepo | PASS |
| 4 | 场景B 超宽限 → CANCELED | CANCELED | CANCELED | PASS |
| 5 | 场景B 超宽限 组织降回 FREE | planId=FREE | cmveo0wt2000awbbcu5irod6y | PASS |
| 6 | 场景B 超宽限 权益快照重置为 FREE | seats=5 | 5 | PASS |
| 7 | 场景C 主动取消到期 → CANCELED | CANCELED | CANCELED | PASS |
| 8 | 场景C 主动取消到期 组织降回 FREE | planId=FREE | cmveo0wt2000awbbcu5irod6y | PASS |
| 9 | 场景C 主动取消到期 权益快照重置为 FREE | seats=5 | 5 | PASS |

## AT08

| # | 检查项 | 期望 | 实际 | 结果 |
| - | ------ | ---- | ---- | ---- |
| 1 | 两成员加入后项目房间 presence 可见 | ≥2 个不同用户 | users=cmveo0wv8000rwbbcefdco0zl,cmveo0wvf000twbbc3r4pigz4 | PASS |
| 2 | 跨租户成员无法进入他人项目房间 | ack ok=false | {"ok":false,"code":"NOT_MEMBER"} | PASS |
| 3 | 创建任务实时广播给房间其他成员 | taskId=cmveo15qo002k3at0i8u0f31q | cmveo15qo002k3at0i8u0f31q | PASS |
| 4 | 更新任务实时广播 | taskId=cmveo15qo002k3at0i8u0f31q | cmveo15qo002k3at0i8u0f31q | PASS |
| 5 | 删除任务实时广播 | taskId=cmveo15qo002k3at0i8u0f31q | cmveo15qo002k3at0i8u0f31q | PASS |
