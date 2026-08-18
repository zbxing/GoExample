# MSFront

`MSFront` 是 GoExample 的 Next.js 16 管理台，负责项目、服务、环境、集成、安全治理、用户、角色和系统配置界面。所有页面、React 组件、前端 API 与 Node 服务端数据访问代码均保留在本目录。

## 目录

```text
app/         Next.js App Router 页面、布局和 Route Handler
components/  React 管理界面组件
data/        本地项目、RBAC 和 Fiber API 清单
lib/api/     API 客户端与后端适配器
lib/server/  Node 服务端仓储和数据访问
providers/   登录、语言、主题和项目 Context
public/      静态图片资源
__tests__/   Vitest 测试，按 unit、integration 等层次分类
```

## 启动

可从仓库根目录统一执行：

```powershell
yarn install:front
yarn dev
```

也可直接进入本目录：

```powershell
cd MSFront
Copy-Item .env.example .env.local
yarn install
yarn dev
```

- 默认地址：`http://localhost:3000`
- Fiber API：`http://localhost:3001`
- 演示登录：`admin` / `admin123`

## 环境变量

- `NEXT_PUBLIC_MSFRONT_API_BASE_URL`：Fiber API 地址。
- `NEXT_PUBLIC_MSFRONT_ENABLE_LIVE_PROBES`：是否启用浏览器侧实时探测。
- `MSFRONT_ENABLE_LIVE_PROBES`：是否启用 Node 服务端实时探测。
- `MSFRONT_PROJECT_STORAGE_DRIVER`：`auto`、`database` 或 `file`。
- `MSFRONT_DATABASE_URL`、`DATABASE_URL`：PostgreSQL 连接地址。
- `MSFRONT_DB_POOL_MAX`：Node 进程最大 PostgreSQL 连接数，默认 10，范围 1-100。
- `MSFRONT_DB_CONNECT_TIMEOUT_MS`、`MSFRONT_DB_IDLE_TIMEOUT_MS`：连接建立和空闲连接超时。
- `MSFRONT_DB_STATEMENT_TIMEOUT_MS`、`MSFRONT_DB_QUERY_TIMEOUT_MS`：服务端 statement 和客户端 query 超时。
- `MSFRONT_SYSTEM_BACKEND`：默认 `local`；`fiber` 是远端 RBAC 扩展点。
- `MSFRONT_JWT_SECRET`：管理台本地会话签名密钥；生产环境必须使用至少 32 字符的非默认随机值。
- `MSFRONT_DATA_DIR`：文件存储数据根目录；未设置时使用 `MSFront/data`，目标目录必须可写。
- `MSFRONT_TRUSTED_ORIGINS`：允许携带 Cookie 调用写接口的额外 Origin，逗号分隔；默认仅允许请求自身 Origin。
- `MSFRONT_PROBE_ALLOWED_ORIGINS`：生产环境允许服务端健康探测访问的额外 HTTP(S) Origin，逗号分隔。

默认文件模式读取 `data/`。数据库模式需要设置数据库连接地址；Fiber 服务当前负责健康、诊断和示例 JWT API，管理台自身的用户与 RBAC Route Handler 仍使用本地实现。

数据库首次使用前从仓库根目录执行 `yarn migrate:front`。迁移文件位于 `MSFront/database/migrations/`，runner 使用 advisory lock、SHA-256 和单文件事务；`yarn migrate:front --status` 查看状态，`--dry-run` 可离线检查迁移清单。

配置 `MSFRONT_DATABASE_URL` 后可执行 `yarn test:database`，验证两个并发 migration runner、重复执行、状态记录、业务表和大小写不敏感项目 code 唯一约束。MSFront CI 使用固定 digest 的 PostgreSQL 16 service 执行该测试。

从仓库根目录先执行 `yarn build:front`，再执行 `yarn test:e2e`，可运行 production server 上的桌面/移动 Chromium 登录、退出、404 恢复、横向溢出和 axe 可访问性门禁。运行器使用系统临时目录中的数据副本，不会修改 `MSFront/data`。

管理台会在生产环境签发或校验会话前拒绝缺失、默认占位或少于 32 字符的 `MSFRONT_JWT_SECRET`。会话 Cookie 使用 HttpOnly、Secure（生产）、SameSite=Lax 和 Path=/；Proxy 只做乐观校验，Route Handler 仍通过服务端仓储执行会话与权限检查。

所有使用 Cookie 身份的写请求都会校验 `Origin`。生产探针默认只访问 `NEXT_PUBLIC_MSFRONT_API_BASE_URL` 的 Origin；部署在反向代理或需要探测其他服务时，应使用上述 allowlist 显式放行，且仍需用网络出口策略限制 DNS rebinding 与私有网段访问。

所有 JSON 写接口使用 Zod 运行时 schema，默认最多读取 1 MiB，并区分媒体类型、体积、JSON 语法和字段校验错误。未知服务端异常不会把原始 `Error.message` 返回客户端。Next.js 响应统一包含防嵌入、MIME 嗅探、Referrer/Permissions Policy、有限 CSP 和 HSTS 等安全头，并关闭 `X-Powered-By`。

## 检查

```powershell
yarn test
yarn lint
yarn typecheck
yarn build
```

`yarn test` 执行 `__tests__/unit/` 中的 Vitest 单元测试，并使用 TypeScript AST 校验 management/system Route Handler 的服务端授权契约及 schema-based JSON parsing。跨项目测试统一放在仓库根目录 `__test__/`，不与 MSFront 单元测试混放。

该目录从 `I:\Projects\NestServer\MSFront` 同步通用前端功能，但不依赖原仓库外部的 `@nest-server/openapi-sdk`。GoExample 使用本地 API 客户端、Fiber 适配器，并直接读取根目录 `docs/openapi/openapi.json` 作为 API inventory。
