# 测试目录

根目录 `__test__/` 只承载根 Node 工具测试和跨项目黑盒测试。各 Go package 的
`*_test.go`、benchmark 继续与被测源码同目录，以保留 Go 的包可见性、`internal`
规则、覆盖率统计和 `go test ./...` 自动发现能力。

```text
__test__/
  node/                  根目录 Node 编排脚本测试
  integration/server/    通过 HTTP 或进程接口验证 Go 服务
  integration/msfront/   MSFront 跨模块集成测试
  contract/              前后端 API 与授权契约测试（当前含 MSFront 路由授权契约）
  e2e/                   浏览器和完整业务流程测试
  fixtures/              跨测试套件共享的非敏感固定数据
  reports/               覆盖率、E2E、性能等生成报告，不提交 Git
```

MSFront 自身的 Vitest 单元测试位于 `MSFront/__tests__/unit/`。运行所有当前测试：

```powershell
yarn test
```

也可以分别运行 `yarn test:node`、`yarn test:server` 和 `yarn test:front`。

数据库集成测试位于 `integration/msfront/database-migration.mjs`。本地设置 `MSFRONT_DATABASE_URL` 后运行 `yarn test:database`；未设置连接时会明确报告跳过，CI 使用 PostgreSQL service 强制执行。

浏览器端到端测试位于 `e2e/msfront/`。先完成 MSFront production build，再运行 `yarn test:e2e`；启动器会复制演示数据到系统临时目录，并在结束后清理，不会改写 `MSFront/data`。测试覆盖桌面和移动 Chromium、登录/退出/404 恢复、横向溢出以及 critical/serious 级 WCAG 违规，报告写入 `reports/playwright/`。

## 约束

- `node/` 测试根 Node 项目的 `scripts/` 和 `tools/`，不放 MSFront 单元测试。
- `integration/`、`contract/` 和 `e2e/` 只通过公开 API、HTTP 或进程边界测试系统。
- 不在根目录导入 `Proj/*/internal`；内部包测试必须保留在所属 Go module 内。
- 固定测试数据不得包含口令、令牌、生产数据库导出或其他敏感信息。
- `reports/` 仅保留忽略规则，测试生成物应可随时重新生成。
