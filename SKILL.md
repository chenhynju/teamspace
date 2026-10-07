---
name: f-u01
description: Implement or review the F-U01 product workflow, its state transitions, domain invariants, and acceptance evidence.
---

# TeamSpace：企业项目协作云 专项实施技能

适用于本方向的实现、审查和扩展。按 README 选择 P0，随后读 REQUIREMENTS 的需求追溯、DESIGN 的模型/契约与 AT；只加载当前路径相关的内容。

## 先决定正确性边界

产品场景：一家 50 人咨询公司同时服务多个客户；管理员隔离客户工作区，员工协作交付，财务管理席位。以项目与交付物作为租户能力的具体业务载体。

写出状态表 **Invitation: pending → accepted / revoked / expired；Membership: active → suspended → removed；Project: draft → active → delivered → archived**，为每个动作定义前置条件、执行主体、持久变更、外部副作用和失败恢复。先让下面的专项规则可执行：

1. 所有业务查询必须带服务端验证的 organization_id，数据库 RLS 为防御层。
2. 不能删除最后一个有效 owner。
3. 审计记录 actor、资源、前后差异和 trace_id，敏感字段脱敏。

## 从规则到代码

- 用 NestJS + TypeScript 和 PostgreSQL 完成核心状态路径；专项工具 Prisma、PostgreSQL RLS、WorkOS、Stripe Billing。
- 按本题业务约束选择最小必要生态。
- 为 DESIGN 表内实体建立 schema/集合/合约状态；通过迁移、唯一约束、版本或链上规则实现业务约束，不能只在 UI 禁用按钮。
- 根据接口表实现输入输出和稳定错误；外部 adapter 有契约测试与故障 fixture。模型和第三方资料均不改变授权。
- 选一个 P0 用户路径贯通到持久结果，再加重复/并发、拒绝和一次真实恢复演练；失败或 unknown 不悄悄转换成成功。

## 验证与迭代

执行 DESIGN 中每个 AT 对应行为并保存证据；让失败场景破坏一个明确规则，确认实现会拒绝或恢复。记录数据规模、环境、运行命令与结果，检查本题核心业务不变量。

增加第三方服务、k8s 或额外语言前说明具体瓶颈和取舍。若原文/本次推导与实际用户要求冲突，修订 BR/D/AT 并保持历史原文，不用既有模板扩大范围。

## 完成标准

核心产品路径与错误反馈可演示；专项规则有执行证据；运行/迁移/回滚说明可由另一人复现。分别标记代码、模拟器、真实供应商、付款/资产完成与生产验证。
