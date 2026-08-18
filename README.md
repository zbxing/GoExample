# GoExample

GoExample 是一个多项目工作区。根目录只承载 Node 命令编排和共享工具，`Framework/` 是可复用 Go/Fiber 模块，`Proj/` 存放一个或多个独立服务器工程，`MSFront/` 是独立 Next.js 管理台。

## 目录结构

```text
Framework/      Go 1.25、Fiber v3.5.0 公共框架
Proj/
  Example/      默认示例服务器工程
MSFront/        Next.js 16、React 19 和 TypeScript 管理台
scripts/        根 Node 项目的任务编排
tools/          共享工具和代码生成器
__test__/       根 Node、跨项目集成、契约和 E2E 测试
docs/           评估、优化与项目文档
go.work         Go 多 module 工作区
```

Framework 与项目工程分离：Framework 提供 HTTP、中间件、健康检查、指标、验证、认证示例和生命周期；`Proj/Example` 持有可执行入口、transport adapter、`internal/projectapp` application use case、环境配置和镜像。新增 `Proj/Other` 后可通过 `GO_PROJECT=Other` 使用同一套根命令。

## 环境要求

- Node.js 20.19 或更高版本
- Yarn 1.22.22
- Go 1.25 或更高版本
- Windows race detector 需要 CGO 和 C 编译器

## 安装

```powershell
yarn env
```

`yarn env` 会安装根依赖、检查或下载 `go.work` 指定的 Go 工具链、下载所有 Go module 依赖，并安装 `MSFront` 依赖。根项目没有运行时依赖；`MSFront` 使用独立的 `yarn.lock`。

## 启动

终端一启动管理台：

```powershell
Copy-Item MSFront/.env.example MSFront/.env.local
yarn dev
```

终端二启动默认 Example 服务：

```powershell
Copy-Item Proj/Example/.env.example Proj/Example/.env
yarn dev:server
```

- MSFront：`http://localhost:3000`
- Example Fiber API：`http://localhost:3001`
- 探针：`/livez`、`/readyz`、`/startupz`
- 指标：`/metrics`
- Example 项目信息：`/api/v1/project`

服务默认对 `/api/v1` 启用有界并发和 draining 保护（`HTTP_MAX_IN_FLIGHT=256`），并将 transport 连接并发限制为 `HTTP_MAX_CONNECTIONS=4096`、请求头读取预算限制为 `HTTP_READ_BUFFER_SIZE=16384`。达到在途请求上限或实例开始停机摘流时返回 `503` 和 `Retry-After: 1`；超出连接容量由 transport 返回 `503` 并关闭连接，超出请求头预算返回 `431`，已有业务请求继续完成，探针不占用应用 admission slot。

## 根目录命令

| 命令 | 作用 |
| --- | --- |
| `yarn env` | 安装根目录、Go modules 和 MSFront 的环境依赖 |
| `yarn test` | 依次执行根 Node、Go 服务和 MSFront 测试 |
| `yarn test:node` | 执行根目录 Node 编排脚本测试 |
| `yarn install:front` | 安装 MSFront 依赖 |
| `yarn dev`、`yarn dev:front` | 启动 MSFront |
| `yarn build`、`yarn build:front` | 构建 MSFront |
| `yarn lint`、`yarn typecheck` | 检查 MSFront |
| `yarn test:front` | 执行 MSFront 单元测试和 Route Handler 授权契约 |
| `yarn test:e2e` | 使用隔离数据运行 MSFront 桌面/移动浏览器 E2E 与 axe 可访问性门禁 |
| `yarn test:database` | 使用已配置 PostgreSQL 执行 migration 并发、幂等和约束集成测试；未配置时跳过 |
| `yarn migrate:front` | 对 MSFront PostgreSQL 执行带锁、checksum 和事务的 schema 迁移 |
| `yarn dev:server` | 启动目标 Go 项目 |
| `yarn test:server` | 测试 Framework 和目标项目 |
| `yarn cover:server` | 生成组合覆盖率 |
| `yarn bench:server` | 执行 Framework 基准 |
| `yarn bench:transports` | 在 Linux 目标环境使用真实 TCP 对照 Fiber 与 `net/http`；非 Linux 平台跳过可比 benchmark，但仍运行 TCP 契约测试 |
| `yarn evidence:manifest` | 将当前 `.temp` 证据、输入文件 SHA-256、Git 和 toolchain 元数据归档为机器可读 manifest；未运行的生产边界会标为 `not_recorded` |
| `yarn race:server` | 执行 Framework 和目标项目 race |
| `yarn vuln:server` | 执行 govulncheck |
| `yarn vet:server` | 执行 go vet |
| `yarn build:server` | 构建目标项目到 `.temp/bin` |

Windows 执行 `yarn race:server` 需要 GCC。runner 会依次检查 `CC`、`GCC_ROOT`、`E:\DevTools\GCC\mingw64\bin\gcc.exe` 和常见 MinGW 路径，并自动为 race 子进程启用 CGO。

Go 编排脚本是 [scripts/go-project.mjs](./scripts/go-project.mjs)。默认目标为 Example；切换项目：

```powershell
$env:GO_PROJECT = "Other"
yarn test:server
yarn dev:server
```

项目名只允许字母、数字、下划线和连字符，并且必须存在于 `Proj/` 且包含 `go.mod`。Go 脚本优先使用 `yarn env` 安装到 `.temp/toolchain` 的工具链，未找到时再调用 PATH 中的 `go`；也可指定：

```powershell
$env:GO_BINARY = "C:\path\to\go.exe"
yarn test:server
```

`yarn vuln:server` 优先使用 `GOVULNCHECK_BINARY` 或 `.temp/bin/govulncheck`，没有本地扫描器时才通过固定版本的 `go run` 获取工具。扫描器仍需要访问 Go 漏洞数据库；离线结果只能使用本机已有数据库快照。

Windows race detector 可使用当前安装的 WinLibs GCC：

```powershell
$env:Path = "E:\DevTools\GCC\mingw64\bin;$env:Path"
$env:CC = "E:\DevTools\GCC\mingw64\bin\gcc.exe"
$env:CXX = "E:\DevTools\GCC\mingw64\bin\g++.exe"
$env:CGO_ENABLED = "1"
yarn race:server
```

## Docker

Example 镜像使用仓库根目录作为构建上下文，因为构建同时需要 Framework 和 Example module：

```powershell
docker build -f Proj/Example/Dockerfile -t goexample-api --build-arg VERSION=1.0.0 --build-arg COMMIT=$(git rev-parse --short HEAD) --build-arg BUILD_TIME=$(Get-Date -AsUTC -Format o) .
```

builder 与 distroless runtime 都固定到 OCI digest。根 `.dockerignore` 只允许 Framework、Example 和 `go.work` 进入上下文。

## API 与供应链契约

- `docs/openapi/openapi.json` 是 Example Fiber API 与 MSFront API inventory 的 OpenAPI 3.1 单一事实源；Go 测试会把它与 Fiber 实际路由表比较。
- `yarn migrate:front --dry-run` 可在不连接数据库时检查迁移顺序与 SHA-256；正式执行需要 `MSFRONT_DATABASE_URL` 或 `DATABASE_URL`。
- `supply-chain.yml` 使用固定 commit SHA 的 Syft/Anchore action 生成 CycloneDX SBOM，并以 High 为失败阈值运行 Grype。`security-analysis.yml` 对 Go 与 JavaScript/TypeScript 执行 CodeQL，PR 还会执行 dependency review。
- 根 Node 契约禁止 workflow action 和 service image 使用可变 tag。只有远端 workflow 成功记录才能作为交付证据。

## 文档

- [Framework](./Framework/README.md)
- [Example](./Proj/Example/README.md)
- [MSFront](./MSFront/README.md)
- [架构与性能评估](./docs/评估/项目架构与性能评估.md)
- [HTTP transport 选择 ADR](./docs/adr/0001-http-framework-selection.md)
- [待优化 V4](./docs/待优化/待优化V4.md)
- [待优化 V5](./docs/待优化/待优化V5.md)
- [待优化 V6](./docs/待优化/待优化V6.md)
- [待优化 V7](./docs/待优化/待优化V7.md)
- [待优化 V8](./docs/待优化/待优化V8.md)
- [待优化 V9](./docs/待优化/待优化V9.md)
- [Tools](./tools/README.md)
