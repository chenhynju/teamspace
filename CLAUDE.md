# F-U01 — TeamSpace：企业项目协作云

先读 [README.md](README.md) → [REQUIREMENTS.md](REQUIREMENTS.md) → [DESIGN.md](DESIGN.md)。本题实现约束见 [AGENTS.md](AGENTS.md)，专项流程见 [SKILL.md](SKILL.md)。

当前 P0：P0 实现两组织、两工作区、成员邀请、项目交付、权限和套餐沙盒；不实现完整项目管理套件。

采用 NestJS + TypeScript 与 PostgreSQL，以 DESIGN 的 AT 检查每项业务规则。用户需求变更时同步 P/BR/D/AT，保留原始来源。交付明确运行命令、测试结果、外部集成与未验证边界。
