# Example

`Proj/Example` 是默认示例服务器工程，module path 为 `github.com/zbxing/goexample/Proj/Example`。它通过根 `go.work` 和本地 `replace` 使用 [Framework](../../Framework/README.md)，并持有可执行入口、项目路由、环境示例与容器镜像。

## 结构

```text
cmd/server/                 配置和依赖组装入口
internal/projectapi/        Example Fiber transport adapter、契约与真实 TCP benchmark
internal/projectapp/        不依赖 HTTP 框架的 typed application use case
.env.example                项目运行配置
Dockerfile                  多 module 镜像构建
go.mod / go.sum             独立 module 依赖
```

## 启动与检查

从仓库根目录执行：

```powershell
yarn dev:server
yarn test:server
yarn cover:server
yarn bench:server
yarn bench:transports
yarn race:server
yarn vuln:server
yarn vet:server
yarn build:server
```

也可直接使用 Go workspace：

```powershell
go run ./Proj/Example/cmd/server
go test ./Framework/... ./Proj/Example/...
```

服务默认监听 `http://localhost:3001`。

## 能力

- 结构化 `slog` 请求日志、Request ID、panic 恢复和统一错误 envelope。
- Helmet、安全头、TLS Early Data 防重放、显式 CORS、ETag 和压缩。
- 请求体、读写、空闲和业务 deadline 限制。
- `/api/v1` 有界并发 admission；达到 `HTTP_MAX_IN_FLIGHT` 或实例进入 draining 时快速返回 `503`，并在 metrics 中分别累计无标签拒绝计数，健康探针不受影响，已有请求继续完成。
- transport 连接并发由 `HTTP_MAX_CONNECTIONS=4096` 限制；容量耗尽由 Fiber/fasthttp 在应用 middleware 前返回 `503` 并关闭连接，不计入应用 admission counter。
- API 与登录独立限流、选定写接口幂等重放。
- JSON 和 `application/*+json` media type 契约与结构验证。
- 演示 HS256 JWT 和 Bearer 中间件。
- liveness、readiness、startup、draining 和依赖检查缓存。
- Prometheus 文本指标、Go runtime metrics 和受保护 pprof。
- 可测试的随机端口启动、取消与优雅停机。

## 接口

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/` | 否 | 服务信息与端点索引 |
| GET | `/livez`、`/readyz`、`/startupz` | 否 | 平台探针 |
| GET | `/api/health*` | 否 | 兼容健康接口 |
| GET | `/metrics` | 生产 Bearer | Prometheus 指标 |
| GET | `/debug/pprof/*` | Bearer | 可选 pprof |
| GET | `/api/system/info` | 否 | 受环境控制的构建信息 |
| GET | `/api/v1/project` | 否 | Example 项目路由 |
| POST | `/api/v1/auth/login` | 否 | 获取演示 JWT |
| GET | `/api/v1/auth/me` | Bearer | 当前演示用户 |
| GET | `/api/v1/example/hello` | 否 | 查询示例 |
| POST | `/api/v1/example/echo` | 否 | JSON 回显 |
| POST | `/api/v1/example/validate` | 否 | 结构验证 |
| GET | `/api/v1/example/delay` | 否 | deadline 示例 |
| GET | `/api/v1/example/private` | Bearer | 受保护示例 |

成功响应为：

```json
{"code":0,"data":{},"msg":"success"}
```

## 配置与安全边界

完整变量见 [.env.example](./.env.example)。`APP_ENV` 只接受 `development`、`test` 或 `production`。生产环境至少需要：

```powershell
$env:APP_ENV = "production"
$env:JWT_SECRET = "use-a-random-secret-with-at-least-32-characters"
$env:METRICS_TOKEN = "use-an-independent-random-32-character-token"
$env:CORS_ALLOW_ORIGINS = "https://console.example.com"
$env:CORS_ALLOW_CREDENTIALS = "false"
$env:TRUSTED_PROXIES = "10.0.0.0/8"
$env:DEMO_AUTH_ENABLED = "false"
$env:SHUTDOWN_DRAIN_DELAY = "5s"
$env:HTTP_MAX_IN_FLIGHT = "256"
$env:HTTP_MAX_CONNECTIONS = "4096"
$env:HTTP_READ_BUFFER_SIZE = "16384"
$env:SHARED_STATE_MODE = "external"
```

`DEMO_AUTH_ENABLED` 和内置凭据只用于模板验证，不替代正式用户存储、密码哈希、OIDC、令牌撤销和 RBAC。`SHARED_STATE_MODE=external` 要求 composition root 注入共享 Storage 与分布式 Locker；生产入口在依赖缺失时 fail fast。只有明确设置 `ALLOW_IN_MEMORY_SHARED_STATE=true` 才允许生产降级到单实例内存语义。

## 健康检查与停机

`health.Checker` 可注册数据库、缓存和消息系统检查。缓存 miss 只启动一次后台刷新；调用方可以独立取消，刷新使用统一总预算。检查函数必须响应传入 context，Go 无法强制终止忽略 context 的函数。

收到退出信号后，Framework 先将 readiness 设置为 draining，等待 `SHUTDOWN_DRAIN_DELAY`，再在 `SHUTDOWN_TIMEOUT` 内关闭服务。启动校验要求传播延迟和业务请求预算小于总停机预算。

## Docker

使用仓库根目录作为上下文：

```powershell
docker build -f Proj/Example/Dockerfile -t goexample-api --build-arg VERSION=1.0.0 --build-arg COMMIT=$(git rev-parse --short HEAD) --build-arg BUILD_TIME=$(Get-Date -AsUTC -Format o) .
```

镜像使用固定 digest 的 Go builder 和 distroless nonroot runtime。交付环境仍应生成 SBOM、签名并执行镜像扫描。
