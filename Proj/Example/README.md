# Example

`Proj/Example` 是默认示例服务器工程，module path 为 `github.com/zbxing/goexample/Proj/Example`。它通过根 `go.work` 和本地 `replace` 使用 [Framework](../../Framework/README.md)，并持有可执行入口、项目路由、环境示例与容器镜像。

## 结构

```text
cmd/server/                 配置和依赖组装入口
internal/projectapi/        Context-only/typed authorized query、typed JSON command、API 契约与测试专用 transport benchmark
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
yarn soak:transports
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

`yarn bench:transports` 的可比测量仅在 Linux 运行：Fiber 与 `net/http` 共享同一 `projectapp.Service`、JSON envelope 和真实 TCP 路径，固定执行 `steady-c1`（600/1）、`steady-c16`（2000/16）、`steady-c64`（4000/64）及关闭 keep-alive 的 `connection-churn-c16`（800/16）。5 轮原始结构化数据会被报告器校验并汇总。

`TRANSPORT_SOAK_DURATION=30s yarn soak:transports` 会以并发 32 对两个 transport 分别运行有界 loopback soak，5 秒分窗记录吞吐并在清理后检查 heap/goroutine/FD 收敛。该命令仅在 Linux 且显式配置持续时间时执行，允许范围为 1 秒至 10 分钟；CI 报告门禁要求至少 30 秒。内存、GC、goroutine 与 FD 数据是 client/server 同进程 harness 的合并增量，短时门禁不代表目标依赖长稳、生产容量或无泄漏证明。仓库 workflow 和报告入口也不代表已经取得远端 Linux 结论。

## 能力

- 结构化 `slog` 请求日志、Request ID、panic 恢复和统一错误 envelope；客户端 Request ID 限制为 128 字节安全 token，非法值由服务端换发且只累计无标签指标。
- Helmet、安全头、TLS Early Data 防重放、显式 CORS、压缩，以及不会物化流 body 的弱 ETag/304 缓存验证器。
- 请求体、读写、空闲和业务 deadline 限制；真实 TCP 契约验证慢读背压会触发 `HTTP_WRITE_TIMEOUT`，并覆盖 keep-alive 复用与回收、半关闭响应和 shutdown 连接归零。
- `/api/v1` 有界并发 admission；达到 `HTTP_MAX_IN_FLIGHT` 或实例进入 draining 时快速返回 `503`，并在 metrics 中分别累计无标签拒绝计数，健康探针不受影响，已有请求继续完成。
- 标准 listener 接受的连接并发由 `HTTP_MAX_CONNECTIONS=4096` 限制；容量耗尽时停止 `Accept` 新连接直至已有连接关闭，调用方需依靠自身连接 timeout，edge 仍应提供更早的容量拒绝。该等待发生在应用 middleware 前，不计入应用 admission counter。
- composition root 通过 `httpapi.NewHTTPHandler` 将 Fiber 路由适配为标准 `http.Handler`，并默认交给 `server.RunHTTP` 管理 listener、accepted connection/read-header/read/write/idle 上限、固定状态连接指标、draining 和有界关闭；Fiber application shutdown hook 与标准 server 共享停机预算。
- API 与登录独立限流；选定写接口只对相同请求指纹执行幂等重放，同 key 的不同请求返回禁缓存 `409 Conflict`。
- JSON 和 `application/*+json` media type 契约与结构验证。
- 可互斥选择演示 HS256 JWT，或生产 RS256 OIDC/JWKS Bearer 验证；外部模式可显式启用浏览器 Authorization Code + PKCE start/callback/logout 与会话清单/撤销 API，使用 Secure、HttpOnly、SameSite=Lax 的一次性 state 与 opaque session cookie，并校验 ID/access token 主体一致。成功回调固定 204、不回传 provider token；cookie 认证的写请求还要求 Strict CSRF cookie 与 `X-CSRF-Token` 双提交。
- liveness、readiness、startup、draining 和依赖检查缓存。
- Prometheus 文本指标、Go runtime metrics 和受保护 pprof。
- 官方 OpenTelemetry server span 与 `project.get`/`project.preview`/`project.describe` application child span；可选有界 OTLP/HTTP batch exporter，退出时在固定预算内 flush。
- 生产 project query、带 `demo` 角色和 tenant/resource 策略的 typed URI/query/header query 与 typed JSON command、composition root 均不导入 Fiber；Framework adapter 以标准 `context.Context` 和最小 principal 调用 use case，并保留来源隔离、认证/授权、校验、幂等、统一 envelope、trace 与 deadline。preview 可选 `X-Tenant-ID`，describe 可选 `tenantId`；缺省绑定为已认证 subject，显式跨租户固定返回脱敏 403。
- 可测试的随机端口启动、取消与优雅停机。

## 接口

| 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| GET | `/` | 否 | 服务信息与端点索引 |
| GET | `/livez`、`/readyz`、`/startupz` | 否 | 平台探针 |
| GET | `/api/health*` | 否 | 已弃用兼容接口；按 `Deprecation`、`Sunset`、`Link` 迁移到标准探针 |
| GET | `/metrics` | 生产 Bearer | Prometheus 指标 |
| GET | `/debug/pprof/*` | Bearer | 可选 pprof |
| GET | `/api/system/info` | 否 | 受环境控制的构建信息 |
| GET | `/api/v1/project` | 否 | Example 项目路由 |
| GET | `/api/v1/project/preview/:audience?format=...` | Bearer + `demo` role + tenant policy | typed URI/query/header application query；要求 `X-Client-Locale`，可选 `X-Tenant-ID`，跨租户返回 403 |
| POST | `/api/v1/project/describe` | Bearer 或 session+CSRF；`demo` role + tenant policy | 强类型 JSON application command；可选 `tenantId`，资源授权先于幂等状态，返回已验证 `requestedBy` |
| POST | `/api/v1/auth/login` | 否 | 仅 demo 模式注册并签发本地 JWT；OIDC 模式不注册 |
| GET | `/api/v1/auth/oidc/start` | 否 | 仅显式浏览器 OIDC 模式注册；设置 state 绑定 cookie 并跳转到 IdP |
| GET | `/api/v1/auth/oidc/callback` | state cookie | 一次性消费 state，完成 exchange、nonce 与双 token 主体校验，创建 opaque session 并固定返回 204 |
| POST | `/api/v1/auth/oidc/logout` | session + CSRF | 立即撤销 session 并清除 session/CSRF cookie |
| GET | `/api/v1/auth/oidc/sessions` | Bearer 或 session | 返回当前 subject 的有界低敏 session ID、创建时间、到期时间和可选设备名称清单 |
| PATCH | `/api/v1/auth/oidc/sessions/:sessionId` | Bearer 或 session + CSRF | 设置或清除当前 subject session 的有界设备名称；非法名称 400，未知/跨 subject ID 404 |
| DELETE | `/api/v1/auth/oidc/sessions/:sessionId` | Bearer 或 session + CSRF | 仅撤销当前 subject 拥有的 session；非法、不存在和跨 subject ID 统一返回 404 |
| DELETE | `/api/v1/auth/oidc/sessions` | Bearer 或 session + CSRF | 撤销当前 subject 的全部 browser session，并清除浏览器 cookie |
| GET | `/api/v1/auth/me` | Bearer 或 session | 当前已验证用户；demo 或 OIDC 模式注册 |
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
$env:METRICS_TOKEN = "use-an-independent-random-32-character-token"
$env:CORS_ALLOW_ORIGINS = "https://console.example.com"
$env:CORS_ALLOW_CREDENTIALS = "false"
$env:TRUSTED_PROXIES = "10.0.0.0/8"
$env:DEMO_AUTH_ENABLED = "false"
$env:OIDC_AUTH_ENABLED = "true"
$env:OIDC_ISSUER = "https://identity.example.com/tenant"
$env:OIDC_AUDIENCE = "goexample-api"
$env:OIDC_JWKS_URL = "https://identity.example.com/tenant/.well-known/jwks.json"
$env:OIDC_JWKS_HTTP_TIMEOUT = "3s"
$env:OIDC_JWKS_REFRESH_INTERVAL = "5m"
$env:OIDC_MAX_TOKEN_AGE = "15m"
$env:OIDC_BROWSER_ENABLED = "false"
# 启用浏览器流程时再提供 client ID/secret 与精确 HTTPS callback：
# $env:OIDC_REQUIRED_ACR = "urn:example:assurance:mfa"
# $env:OIDC_REQUIRED_AMR = "pwd,otp"
# $env:OIDC_MAX_AUTH_AGE = "10m"
# $env:OIDC_CLIENT_ID = "goexample-browser"
# $env:OIDC_CLIENT_SECRET = "..."
# $env:OIDC_REDIRECT_URL = "https://api.example.com/api/v1/auth/oidc/callback"
$env:OIDC_AUTHORIZATION_TTL = "5m"
$env:OIDC_BROWSER_SESSION_TTL = "15m"
$env:OIDC_BROWSER_MAX_SESSIONS = "10000"
$env:OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT = "10"
$env:SHUTDOWN_DRAIN_DELAY = "5s"
$env:HTTP_MAX_IN_FLIGHT = "256"
$env:HTTP_MAX_CONNECTIONS = "4096"
$env:HTTP_READ_BUFFER_SIZE = "16384"
$env:SHARED_STATE_MODE = "external"
$env:REDIS_TOPOLOGY = "standalone"
$env:REDIS_URL = "rediss://redis-user:redis-password@redis.example.com:6380/0"
$env:REDIS_KEY_PREFIX = "goexample:production:example:"
$env:OTEL_TRACES_EXPORTER = "none"
```

`DEMO_AUTH_ENABLED` 与 `OIDC_AUTH_ENABLED` 互斥。demo 凭据只用于本地模板验证；OIDC 资源服务器模式验证外部签发的 Bearer access token，不提供本地密码登录。`OIDC_BROWSER_ENABLED` 还要求 OIDC 模式、client ID、精确 HTTPS callback、不超过 15 分钟的 state TTL、最多 24 小时且受 access-token `exp` 截断的 session TTL、1 至 10000 的全局 session 上限，以及不超过全局值的正 `OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT`；启动时 discovery/JWKS 任一失败都会拒绝监听。可选 assurance policy 通过 `OIDC_REQUIRED_ACR` 要求精确 `acr`、通过逗号分隔的 `OIDC_REQUIRED_AMR` 要求全部认证方法，并用正值 `OIDC_MAX_AUTH_AGE` 强制 `auth_time` 存在且新鲜；启用时 authorization request 发送同一 `acr_values` 提示，但 callback 仍独立校验所有 claims。三项默认关闭且只能用于浏览器 OIDC；启用前必须先验证目标 IdP 的 claim 映射与 MFA policy。浏览器 callback 会在 exchange 前一次性消费 state 并清除 cookie，缺失、错配、provider error、重放、assurance 不满足、shared store 或上游失败只返回固定错误。开发内存 authorization/session 状态只适合单副本；production browser OIDC 强制 `SHARED_STATE_MODE=external`，同一个 Redis 后端以 state SHA-256 索引和 Lua 原子消费跨副本 authorization request，并用 subject/SessionID SHA-256 索引共享 hash-only session/CSRF 状态、原子单用户限量与清单/单会话/整用户撤销。Example 已将这些操作暴露为条件 HTTP API；响应只含公开随机 ID 和时间，Bearer 与 browser session 共享 subject 边界，cookie DELETE 继续要求 CSRF，inventory 后端异常统一 fail closed。`SHARED_STATE_MODE=external` 同时提供 Redis Storage、分布式幂等锁和原子限流器，启动执行 `PING` 并注册 readiness；配置、原子后端或启动检查缺失时 fail fast。

Sentinel 模式必须让 `REDIS_URL` 保持为空，并配置 `REDIS_SENTINEL_ADDRESSES`（3 至 16 个唯一 `host:port`）、`REDIS_SENTINEL_MASTER_NAME`、数据节点的 `REDIS_USERNAME`/`REDIS_PASSWORD`、Sentinel 的 `REDIS_SENTINEL_USERNAME`/`REDIS_SENTINEL_PASSWORD` 和 `REDIS_DATABASE`。生产 Sentinel 还强制 `REDIS_TLS_ENABLED=true`；可用 `REDIS_TLS_SERVER_NAME` 与不超过 1 MiB 的 `REDIS_TLS_CA_FILE` 提供可信证书链，证书必须覆盖 Sentinel 与数据节点使用的名称。TLS 配置最低为 1.2，证书校验不会被关闭。

默认测试以 `miniredis` 验证 Redis 命令、Lua、TTL、故障和两个 Fiber app 的并发契约，但不把内存替身计为生产 Redis 证据。可对隔离的真实 Redis 显式运行：

```powershell
$env:REDIS_TEST_URL = "redis://127.0.0.1:6379/15"
go test ./Framework/sharedstate -run TestRealRedisIntegration -v
```

该测试使用唯一前缀并只删除自己的键，不执行 `FLUSHDB`；生产仍需验证 TLS/ACL、Sentinel/Cluster/failover、eviction、容量、延迟和告警。

Linux Docker 可执行 `yarn redis:sentinel:contract`。它以固定 Redis 8.2.1 digest 启动一主一从、三个 Sentinel 和分离 ACL，触发 `SENTINEL FAILOVER` 后验证复制状态、两个共享状态 client 重连、原子限流和分布式锁，并始终归档 `.temp/workflow-artifacts/redis-sentinel-contract`。该 loopback 合约不启用 TLS，也不等于目标 TLS/HA、eviction、分区、滚动升级、容量、告警、RPO 或 RTO 已验证。

生产 demo 模式禁止在 `JWT_SECRET`、metrics 和已启用的 pprof 之间复用 secret；OIDC 模式不要求未使用的本地 JWT secret。该启动门禁只能限制静态配置错误，不能替代 KMS/Vault、自动轮换和泄漏响应。

OIDC verifier 只接受 RS256、2048 至 8192 位 RSA key、固定 issuer/audience，以及带 `exp`、`nbf`、`iat`、`jti` 和既有低敏身份/角色字段的 access token。token 最大 16 KiB，JWKS 响应最大 1 MiB/100 keys；进程在监听前同步拉取 JWKS，失败即退出。缓存过期后的刷新失败会 fail closed，未知 `kid` 刷新至少间隔 5 秒且并发请求合并，避免攻击者制造无界上游请求。生产必须为精确 JWKS endpoint 提供受控 DNS/HTTPS egress 和可信 CA，并验证 IdP 密钥轮换。

仓库目前覆盖 Bearer/JWKS、Authorization Code + PKCE、跨副本一次性 state/nonce、refresh token family/reuse detection，以及 opaque 浏览器 session/CSRF/logout 和 HTTP/OpenAPI/SDK 会话清单/集中撤销边界；仍未实现目标 IdP 的 MFA enrollment/challenge、设备元数据与自助管理 UI、目标 IdP 配置、KMS/Vault 托管或生产身份故障演练。

`TRUSTED_PROXIES` 只能配置实际反向代理的明确 IP 或 CIDR。未命中 allowlist 的连接无法通过 `X-Forwarded-For` 改写客户端 IP；production 会拒绝 `0.0.0.0/0` 和 `::/0`，避免明显的全网信任配置削弱基于 IP 的限流。目标 edge 仍必须覆盖并清理入站转发头。

旧 `/api/health*` 别名已进入 2026-08-20 至 2027-02-20 的迁移窗口。新部署应直接使用 `/livez`、`/readyz` 和 `/startupz`；兼容响应的 `Link` 会指向对应 successor，200 与 503 都保留弃用信号。迁移清单见 [health-endpoint-migration.md](../../docs/openapi/health-endpoint-migration.md)。

Tracing 默认使用 `OTEL_TRACES_EXPORTER=none`，仍保留本地 trace/log 关联但不导出。设置为 `otlp` 时必须配置绝对 HTTP(S) `OTEL_EXPORTER_OTLP_ENDPOINT`；endpoint 禁止 credentials、query 和 fragment，base path 会自动追加 `/v1/traces`。`OTEL_TRACES_SAMPLER_ARG` 控制 0 到 1 的 root sample ratio，`OTEL_BSP_EXPORT_TIMEOUT`、`OTEL_BSP_SCHEDULE_DELAY`、`OTEL_BSP_MAX_QUEUE_SIZE` 和 `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` 控制有界批处理。服务退出会在 shutdown 预算内 flush provider；真实 collector、trace backend、outbound/database instrumentation 和告警链路仍需在目标环境部署验证。

## 健康检查与停机

`health.Checker` 可注册数据库、缓存和消息系统检查。缓存 miss 只启动一次后台刷新；调用方可以独立取消，刷新使用统一总预算。检查函数必须响应传入 context，Go 无法强制终止忽略 context 的函数。

收到退出信号后，Framework 先将 readiness 设置为 draining，等待 `SHUTDOWN_DRAIN_DELAY`，再在 `SHUTDOWN_TIMEOUT` 内关闭服务。启动校验要求传播延迟和业务请求预算小于总停机预算。

## Docker

使用仓库根目录作为上下文：

```powershell
docker build -f Proj/Example/Dockerfile -t goexample-api --build-arg VERSION=1.0.0 --build-arg COMMIT=$(git rev-parse --short HEAD) --build-arg BUILD_TIME=$(Get-Date -AsUTC -Format o) .
```

镜像使用固定 digest 的 Go builder 和 distroless nonroot runtime。交付环境仍应生成 SBOM、签名并执行镜像扫描。

仓库根级 `yarn kubernetes:check` 校验 Example 的多副本编排模板；`yarn kubernetes:render` 只接受真实 `@sha256` 镜像引用、精确 HTTPS Origin 和安全的生产 OIDC 参数，并把产物写入 `.temp/deployment`。外部 Secret、JWKS egress、PDB/HPA、探针、资源、安全上下文、NetworkPolicy 和 rollout/rollback 边界见 [Kubernetes 编排基线](../../deploy/kubernetes/README.md)。该本地契约不能替代目标集群演练。

仓库级 [Nginx Edge 基线](../../deploy/edge/README.md) 固定 TLS 1.2/1.3、HTTP/2、16 KiB 单 header、4 MiB body、2 秒上游连接、10 秒上游读写、禁用请求/响应缓冲和非幂等重试，并以 SIGQUIT 保留在途响应。部署时 `TRUSTED_PROXIES` 只能包含真实 edge 地址；静态配置与 GitHub loopback 容器测试都不代表目标 ingress、真实证书或 HTTP/3 已验证。
