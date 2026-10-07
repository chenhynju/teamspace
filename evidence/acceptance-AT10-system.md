# TeamSpace 系统管理/监控验收证据（AT10）

- 时间：2026-10-07T20:01:06.057Z
- API：http://localhost:3001/api/v1
- 结果：50/50 通过

| 检查项 | 期望 | 实际 | 结论 |
| --- | --- | --- | --- |
| 菜单列表 | 200 且非空 | 200 69 条 | PASS |
| 创建菜单 | 201 + id | 201 | PASS |
| 创建子菜单 | 201 | 201 | PASS |
| 编辑菜单 | 200 + 新名称 | 200 AT验收父菜单(改) | PASS |
| 防环：父级不能是自己 | 400 MENU_PARENT_SELF | 400 MENU_PARENT_SELF | PASS |
| 防环：父级不能是后代 | 400 MENU_PARENT_LOOP | 400 MENU_PARENT_LOOP | PASS |
| 有子菜单时删除父级 | 409 MENU_HAS_CHILD | 409 MENU_HAS_CHILD | PASS |
| 删除已授权菜单 | 409 MENU_IN_USE | 409 MENU_IN_USE | PASS |
| 删除子菜单 | 200 | 200 | PASS |
| 删除父菜单 | 200 | 200 | PASS |
| 创建字典类型 | 201 | 201 | PASS |
| 字典编码格式校验 | 400 | 400 | PASS |
| 创建字典数据 | 201 | 201 | PASS |
| 按编码查字典数据 | 200 且含 1 条 | 200 1 条 | PASS |
| 编辑字典数据 | 200 + 新标签 | 200 | PASS |
| 有数据时删字典类型 | 409 DICT_HAS_DATA | 409 DICT_HAS_DATA | PASS |
| 删除字典数据 | 200 | 200 | PASS |
| 删除字典类型 | 200 | 200 | PASS |
| 创建参数 | 201 | 201 | PASS |
| 编辑参数 | 200 + 新值 | 200 | PASS |
| 删除参数 | 200 | 200 | PASS |
| 删除内置参数 | 409 CONFIG_BUILTIN | 409 CONFIG_BUILTIN | PASS |
| 发布公告 | 201 | 201 | PASS |
| 发布者已读状态 | readByMe=true | readByMe=true | PASS |
| 公告跨组织隔离 | Globex 看不到 | globex 0 条，含该公告=false | PASS |
| 成员可查看公告 | 200 readByMe=false | readByMe=false | PASS |
| 成员标记已读（幂等） | 201/201 + readByMe=true | 201/201, readByMe=true | PASS |
| 成员发布公告 | 403 | 403 | PASS |
| 成员删除公告 | 403 | 403 | PASS |
| 管理员删除公告 | 200 | 200 | PASS |
| 登录日志分页 | 200 含 items/total | 200 total=26 | PASS |
| 登录日志状态过滤 | 全部成功 | 5 条全成功=true | PASS |
| 删除单条登录日志 | 200 | 200 | PASS |
| 服务监控 | 200 含 cpu/memory/node | 200 cpu=62.7% | PASS |
| 数据库会话监控 | 200 含 maxConnections/活动 | 200 max=100 连接=4 | PASS |
| 缓存监控 | 200 含 enabled 字段 | 200 enabled=true | PASS |
| 定时任务列表 | 200 含 billing 任务 | 200 jobs=2, next=2026-10-08T04:02:00.000+08:00 | PASS |
| 手动触发订阅扫描任务 | 201 ok | 201 {"ok":true,"firedAt":"2026-10-07T20:01:04.607Z"} | PASS |
| 在线用户列表含当前连接 | true | 200 users=2 conns=2, 含自己=true | PASS |
| 强制下线 | 200 + 连接已消失 | 200 stillThere=false | PASS |
| MEMBER 拒绝 /menus | 403 | 403 | PASS |
| MEMBER 拒绝 /dict-types | 403 | 403 | PASS |
| MEMBER 拒绝 /configs | 403 | 403 | PASS |
| MEMBER 拒绝 /login-logs | 403 | 403 | PASS |
| MEMBER 拒绝 /monitor/server | 403 | 403 | PASS |
| MEMBER 拒绝 /monitor/database | 403 | 403 | PASS |
| MEMBER 拒绝 /monitor/jobs | 403 | 403 | PASS |
| MEMBER 拒绝 /monitor/online | 403 | 403 | PASS |
| MEMBER 触发定时任务 | 403 | 403 | PASS |
| 清空登录日志 | 201 | 201 | PASS |
