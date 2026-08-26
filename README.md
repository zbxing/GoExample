# GoExample

GoExample 是一个多项目工作区。根目录只承载 Node 命令编排和共享工具，`Framework/` 是可复用 Go/Fiber 模块，`Solutions/` 存放面向具体业务、产品或客户的服务工程，`Services/` 存放可被多个方案复用的独立通用服务，`MSFront/` 是独立 Next.js 管理台。

## 目录结构

```text
Framework/      Go 1.25、Fiber v3.5.0 公共框架
Solutions/
  Example/      默认示例业务方案服务
Services/
  Billing/      可复用 Billing 领域服务
SDK/
  GoExample/    从 OpenAPI 生成的版本化 Go client
support/
  consumer/      独立 SDK 消费者与健康端点迁移演练
  api-contracts/ 外部 OpenAPI 子模块
  deploy/        部署、边缘和告警基线
MSFront/        Next.js 16、React 19 和 TypeScript 管理台
scripts/        根 Node 项目的任务编排
tools/          共享工具和代码生成器
__test__/       根 Node、跨项目集成、契约和 E2E 测试
docs/           评估、优化与项目文档
contracts/      业务方案/通用服务与 OpenAPI 分支/tag/commit 的契约清单
go.work         Go 多 module 工作区
```

Framework 与业务服务工程分离：Framework 提供 HTTP、中间件、健康检查、指标、验证、认证示例和生命周期；`Solutions/Example` 与 `Services/Billing` 是两个独立服务消费者，各自持有 application use case、标准 HTTP 入口和服务契约。生产业务 route 与 composition root 不导入 Fiber，具体 transport 适配留在 Framework；默认入口通过标准 `http.Handler` 与 `server.RunHTTP` 管理 listener 和有界关闭。可通过 `GO_PROJECT=Example` 或 `GO_PROJECT=Billing` 使用同一套根命令。

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
Copy-Item Solutions/Example/.env.example Solutions/Example/.env
yarn dev:server
```

- MSFront：`http://localhost:3000`
- Example Go API：`http://localhost:3001`
- 探针：`/livez`、`/readyz`、`/startupz`
- 指标：`/metrics`
- Example 项目信息：`GET /api/v1/project`；受角色和 tenant/resource 策略保护的 typed preview：`GET /api/v1/project/preview/:audience`；typed command：`POST /api/v1/project/describe`

服务默认对 `/api/v1` 启用有界并发和 draining 保护（`HTTP_MAX_IN_FLIGHT=256`），并将标准 listener 接受的连接并发限制为 `HTTP_MAX_CONNECTIONS=4096`、请求头读取预算限制为 `HTTP_READ_BUFFER_SIZE=16384`。达到在途请求上限或实例开始停机摘流时返回 `503` 和 `Retry-After: 1`；连接容量耗尽时 listener 暂停 `Accept` 直至槽位释放，调用方必须设置连接 timeout，edge 应提供更早的容量拒绝；连接容量、当前打开数和固定状态事件进入 `/metrics`，持续 90% 饱和有告警规则。超出请求头预算返回 `431`，已有业务请求继续完成，探针不占用应用 admission slot。

选定写接口的 `X-Idempotency-Key` 会绑定 method、target、subject、media type 和 body 指纹；相同请求可重放，不同请求复用 key 返回 `409`。Redis 适配器以 Lua 提供跨实例原子限流和 owner-token 幂等锁，并使用与服务一致的 OpenTelemetry provider 创建只含固定命令/结果类别的低敏 `CLIENT` span；两个独立 client/Fiber app 的本地行为契约已覆盖。真实 TCP 契约覆盖 keep-alive、idle timeout、半关闭、慢读写和 shutdown 连接收敛。目标 edge、真实 Redis HA/故障切换和多副本部署仍需在实际环境验证。

Go 服务使用官方 OpenTelemetry SDK 创建 HTTP server、`project.get` application child 和低敏 Redis client span。OTLP/HTTP exporter 默认关闭，可通过 `Solutions/Example/.env.example` 中的 `OTEL_*` 变量启用有界 batch、采样、导出 timeout 和 shutdown flush；HTTP attempt timeout 与 retry 退避均包含在总导出预算内，逐次 attempt 和最终 batch/span 只记录固定成功/失败结果。仓库已验证本地 wire contract、503 retry 恢复和持续故障上限，真实 collector、trace backend 和告警链路仍需目标环境证据。

Framework 的 broker-neutral worker 支持保留原 fail-fast receive 模式，或显式选择带私有 ack/DLQ callback 的可靠投递模式。可靠模式限制 handler 尝试次数、指数退避和结算时长，重试时重新克隆消息，耗尽或不可重试时写入 adapter 提供的死信路径；结算错误、超时或 panic 会脱敏并停止 worker group。`Client.MinimumDeliveryLease` 在默认静态模式计算 handler/retry/backoff/ack 或 DLQ 结算及安全余量；显式配置续租 interval/timeout 后，worker 在处理与退避期间周期调用私有 `ExtendLease`，在结算前停止，失败/超时/panic 会取消 handler、禁止结算并返回固定错误。`Framework/queueclient/natsjetstream.PreflightConsumer` 从服务端 `ConsumerInfo` 校验 explicit ack，以及实际 `AckWait` 或覆盖它的全部 `BackOff` interval；adapter 将续租映射到 `InProgress`。单节点 file-backed JetStream 已实测短 lease 拒绝、足额 lease preflight、同步 publish ack、运行中 `NumDelivered >= 2` 重投、WorkerGroup confirmed ack、永久错误 DLQ 和源 pending 归零；新增动态续租合约以 800ms `AckWait` 执行 1.5 秒 handler，要求只交付一次、续租失败为零并最终 confirmed ack。真实进程强制终止/同 store 重启合约进一步证明 3 条消息、durable consumer 与相同 stream sequence 恢复，实测 `NumDelivered` 跨该重启重置。三节点合约再为 source/DLQ stream 和 consumer 配置 3 副本；独立业务连接只从实际 stream leader 建立并通过集群 INFO 发现其他节点，终止该 leader 后必须观察 disconnect/reconnect 回调，并在不替换原连接、JetStream handle、consumer 或 adapter 的情况下完成重新选主、同 sequence 重投、在线 lease 校准、publish、ack/DLQ/pending 收敛。随后以原 file store 和端口恢复首个失效节点，等待全部 stream/consumer 回到 3 个 current replicas，再留下第 5 条消息未确认并终止第一次选出的新 leader；同一连接、handle 和 adapter 必须完成第二次重新选主、相同 sequence 且 `NumDelivered >= 2` 的重投、再次 lease preflight，以及第 6 条消息的发布和确认。第二个失效节点保持离线时，测试再留下 sequence 7 未确认并终止当前 leader，使两个节点的离线窗口重叠；Core 连接必须留在唯一存活节点，而 JetStream publish 必须在 3 秒内有界失败。恢复保存 sequence 7 的节点后，同一会话完成重投、lease preflight 和第 8 条消息 publish/ack，最后恢复另一节点并等待全部 3 副本追平。完整恢复后，schema v5 场景再留下 sequence 9 未确认，通过同一屏障同步终止实际 leader 与另一副本并限制停止启动偏差为 250ms；唯一 Core survivor、无 quorum 有界拒绝、同序重投、lease preflight、第 10 条消息和最终三副本均由报告及 verifier 强制校验。adapter 不管理 stream/consumer，DLQ publish 与源 ack 非原子，去重 ID 只在 duplicate window 内降低重复风险；本地进程级并发终止也不代表远端 job、目标延迟安全余量、目标 broker、网络分区、磁盘损坏、生产身份权限、基础设施同时故障或 exactly-once 已完成。

schema v6 在上述恢复链后增加三进程存活的本地 route 网络分区：三个 TCP proxy 分离实际 cluster listener 与 advertised route，sequence 11 未确认时同步关闭全部活动 route，并逐一验证三个 Core 端点和原业务连接仍存活。source leader 被定向到非业务连接节点，分区 publish 有界失败；恢复 route 后先断言消息数仍为 11，阻止超时请求迟到提交，再由原连接/handle/adapter 完成 sequence 11 重投、lease、sequence 12 确认及全部三副本追平。schema v6 报告、manifest/verifier 和 Node 守卫绑定这些条件；本机固定 NATS 2.14.5 修复迟到提案歧义后连续 3 次通过。本地 loopback proxy 证据仍不代表目标 broker、生产身份、跨主机/跨区网络设备或基础设施级分区。

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
| `yarn test:server` | 测试 `go.work` 中的全部 Go modules |
| `yarn cover:server` | 生成组合覆盖率 |
| `yarn bench:server` | 执行 Framework 基准 |
| `yarn bench:transports` | 在 Linux 目标环境以 5 轮真实 TCP 对照 Fiber 与 `net/http`，覆盖固定并发/连接 churn 容量矩阵及大响应、认证拒绝、依赖延迟场景；非 Linux 平台跳过可比测量但仍运行 TCP 契约测试 |
| `yarn soak:transports` | 在 Linux 显式设置 `TRANSPORT_SOAK_DURATION` 后运行双 transport 有界 loopback soak；非 Linux 或未配置时明确跳过 |
| `yarn postgres:recovery:contract` | 在 Linux Docker 中运行固定 PostgreSQL 16 的真实 serialization/deadlock/versioned update/HTTP versioned GET、If-Match/412、If-None-Match/304/锁测试与逻辑备份/隔离恢复契约，并归档备份、报告、日志、状态和哈希；不替代目标 PITR/RPO/RTO |
| `yarn openapi:compat --base-ref <git-ref>` | 将当前 OpenAPI 与指定 Git 基线结构化比较，并拒绝破坏兼容性的变化 |
| `yarn contracts:check` | 校验所有 `Solutions/<名称>` 和 `Services/<名称>` 的 OpenAPI 仓库/ref/document/SDK 映射，默认离线 |
| `yarn contracts:resolve --project <项目>` | 检查外部 OpenAPI branch/tag 是否仍指向清单中的 `resolvedCommit` |
| `yarn contracts:materialize --project <项目> --fetch` | 将锁定 commit 的外部 OpenAPI 文档 materialize 到 `.temp/contracts/` |
| `yarn api:compat` | 校验 Framework 当前公共 API 与版本化 snapshot 一致；CI 另与 PR target branch 比较 |
| `yarn api:snapshot` | 在审阅公共 API 变更后重新生成 Framework snapshot |
| `yarn sdk:generate` | 从 OpenAPI 生成无第三方运行时依赖的版本化 Go SDK |
| `yarn sdk:check --project <项目>` | 按 `contracts/projects.json` 重新生成并逐字节校验指定项目 SDK，阻断 contract/version 漂移 |
| `yarn evidence:manifest` | 将当前 `.temp` 证据、输入文件 SHA-256、Git 和 toolchain 元数据归档为机器可读 manifest；未运行的生产边界会标为 `not_recorded` |
| `yarn evidence:verify` | 只读校验 manifest 结构、Git 状态、输入与制品的大小/SHA-256 及安全路径；不等同于签名或来源证明 |
| `yarn drill:server` | 执行 Redis、OTel、HTTP 生命周期和出站超时四组有界本地故障演练，并归档原始输出与机器可读结果 |
| `yarn release:server:build` | 使用 `go.work` 固定的精确 Go patch 工具链生成 CGO-free Linux/amd64 服务 ELF、严格 release manifest 和 SHA256SUMS |
| `yarn release:server:verify` | 只读复核发布 manifest schema、ELF64/amd64、大小与 SHA-256；本地校验不等同签名 provenance |
| `yarn race:server` | 对 `go.work` 中的全部 Go modules 执行 race |
| `yarn vuln:server` | 对 `go.work` 中的全部 Go modules 执行 govulncheck |
| `yarn vet:server` | 对 `go.work` 中的全部 Go modules 执行 go vet |
| `yarn build:server` | 构建目标项目到 `.temp/bin` |

默认分支的 `server-release-provenance` CI job 会在上述本地校验通过后，使用固定 commit 的 `actions/attest-build-provenance` 为 SHA256SUMS 中唯一服务二进制生成 GitHub Sigstore/SLSA build provenance，再以 `gh attestation verify` 复核并归档 bundle、URL、原始验证输出、状态和 evidence manifest。只有远端 job 成功且制品齐全时 `signedRelease` 才能记为 `recorded`；本地生成的 binary/checksum 继续保持 `not_recorded`。

Linux transport workflow 固定 `steady-c1/c2/c4/c8/c16/c32/c64/c128` 和 `connection-churn-c16` 九种容量 workload，并独立执行 `response-32k-c16`、`auth-reject-c16` 与 `dependency-delay-5ms-c32` 三种场景。容量矩阵采集 throughput、p50/p95/p99、连接获取、拨号、在途峰值、alloc/malloc、GC、goroutine、FD、进程 CPU/RSS 及前后网络/内存/socket 快照；场景矩阵通过完整 Framework middleware 分别覆盖至少 32 KiB 响应、无效 Bearer 在 application handler 前返回 401，以及可取消的 5ms 依赖延迟。`scripts/transport-benchmark-report.mjs` 只接受完整 5 轮、零错误和稳定 payload 的 9 × 2 容量矩阵及 3 × 2 场景矩阵，生成中位数、方向比和每个 transport 首次达到观测峰值吞吐 90% 的经验饱和并发。通过 `--baseline .temp/transport-benchmark/baseline.json` 可启用固定跨运行门禁：容量和场景的吞吐下降超过 10%、p95 上升超过 20% 或 p99 上升超过 25% 都会失败。schema v4 的 `environmentFingerprint` 记录 runner OS/arch/image、CPU、Go 和 `GOMAXPROCS=2` 并校验规范字段 SHA-256；只有当前与历史指纹一致才执行阈值，环境差异会优先明确标记 `not_checked`。CI 只从同仓库默认分支成功的 push/manual run 自动选择未过期 `baseline-candidate.json`，校验 schema/scope、两组完整矩阵和 GitHub Actions/Linux 指纹，并记录 run、commit、artifact、候选及环境摘要；PR 制品不会成为基线，缺失时报告保持 `not_checked`。这些合成场景、经验饱和点和回归阈值只描述固定 loopback harness，不是目标 payload、目标 IdP、目标依赖、TLS edge 或生产容量证据。

同一 workflow 还会以并发 32 对两个 transport 各运行 30 秒有界 soak，按 5 秒分窗检查零错误、吞吐不塌陷，并在关闭 idle connection、GC 和短暂等待后检查 heap/goroutine/FD 粗粒度收敛。可用 `TRANSPORT_SOAK_DURATION=30s yarn soak:transports` 在 Linux 显式复现。所有内存、GC、goroutine 和 FD 都是同一 loopback client/server harness 进程的合并数据，不是服务端独占值；30 秒门禁也不等于目标依赖长稳、无泄漏证明或生产 soak。当前仍无可引用的远端 Linux artifact、目标负载容量拐点或长稳结论。

Windows 执行 `yarn race:server` 需要 GCC。runner 会依次检查 `CC`、`GCC_ROOT`、`E:\DevTools\GCC\mingw64\bin\gcc.exe` 和常见 MinGW 路径，并自动为 race 子进程启用 CGO。

Go 编排脚本是 [scripts/go-project.mjs](./scripts/go-project.mjs)。默认目标为 Example；切换项目：

```powershell
$env:GO_PROJECT = "Other"
yarn test:server
yarn dev:server
yarn sdk:check --project Other
```

项目名只允许字母、数字、下划线和连字符，并且必须在契约清单中解析到 `Solutions/` 或 `Services/` 下包含 `go.mod` 的目录。Go 脚本优先使用 `yarn env` 安装到 `.temp/toolchain` 的工具链，未找到时再调用 PATH 中的 `go`；也可指定：

```powershell
$env:GO_BINARY = "C:\path\to\go.exe"
yarn test:server
```

`yarn vuln:server` 优先使用 `GOVULNCHECK_BINARY` 或 `.temp/bin/govulncheck`，没有本地扫描器时才通过固定版本的 `go run` 获取工具。扫描器仍需要访问 Go 漏洞数据库；离线结果只能使用本机已有数据库快照。

OpenAPI 项目绑定见 [docs/openapi/project-contracts.md](./docs/openapi/project-contracts.md)。每个
项目可以使用同一外部仓库的不同 branch 或 tag，但生产构建必须把 ref 解析后的 commit
写入清单；SDK 和兼容性检查只使用已 materialize 的内容。当前 Example 仍使用仓库内文档，
不会把现有 `support/api-contracts` 子模块误认为 Example 契约。

Windows race detector 可使用当前安装的 WinLibs GCC：

```powershell
$env:Path = "E:\DevTools\GCC\mingw64\bin;$env:Path"
$env:CC = "E:\DevTools\GCC\mingw64\bin\gcc.exe"
$env:CXX = "E:\DevTools\GCC\mingw64\bin\g++.exe"
$env:CGO_ENABLED = "1"
yarn race:server
```

## Docker

Example 镜像使用仓库根目录作为构建上下文，因为构建同时需要 Framework 和 Solutions/Example module；Billing 使用同一套 workspace 约束：

```powershell
docker build -f Solutions/Example/Dockerfile -t goexample-api --build-arg VERSION=1.0.0 --build-arg COMMIT=$(git rev-parse --short HEAD) --build-arg BUILD_TIME=$(Get-Date -AsUTC -Format o) .
```

builder 与 distroless runtime 都固定到 OCI digest。根 `.dockerignore` 只允许 Framework、Solutions/Example、Services/Billing 和 `go.work` 进入上下文。

Kubernetes 基线不会提交伪造镜像摘要或 Secret。使用真实 registry digest 和 HTTPS Origin 渲染 `.temp/deployment` 产物：

```powershell
yarn kubernetes:check
yarn kubernetes:render --image ghcr.io/owner/goexample-api@sha256:<64-hex-digest> --allowed-origin https://console.example.com --oidc-issuer https://identity.example.com/tenant --oidc-audience goexample-api --oidc-jwks-url https://identity.example.com/tenant/.well-known/jwks.json
```

多副本、PDB、HPA、探针、资源、安全上下文、拓扑分散、NetworkPolicy、外部 Secret 和 rollout/rollback 步骤见 [Kubernetes 编排基线](./support/deploy/kubernetes/README.md)。静态模板和本地渲染不代表目标集群部署或恢复已验证。

固定 Nginx edge 基线提供 TLS 1.2/1.3、HTTP/2、header/body/timeout、无缓冲流式代理和 SIGQUIT drain 契约：

```powershell
yarn edge:check
yarn edge:render --server-name api.example.com --upstream-host goexample-api --upstream-port 80
```

固定镜像、TLS Secret 路径、431/502/503/504、上传中断、真实 Docker 合约及目标环境边界见 [Nginx Edge 基线](./support/deploy/edge/README.md)。当前本机没有 Docker，且仓库内/CI loopback 合约均不替代目标 edge 或 HTTP/3 证据。

## API 与供应链契约

- `docs/openapi/openapi.json` 是 Example Fiber API 与 MSFront API inventory 的 OpenAPI 3.1 单一事实源；Go 测试会把它与 Fiber 实际路由表比较。
- `SDK/GoExample` 与 `SDK/Billing` 分别由各自 OpenAPI 契约生成并保持版本一致；`support/consumer/HealthProbe` 使用 Example SDK 完成本地 readiness 弃用迁移演练，`Services/Billing` 作为可复用的独立 Framework 服务进入 workspace、契约和 SDK 门禁，版本与证据边界见 `docs/openapi/consumer-matrix.md`。
- 旧 `/api/health*` 别名已标记弃用，运行时与 OpenAPI 同步返回/声明 `Deprecation`、`Sunset` 和 successor `Link`；迁移映射见 `docs/openapi/health-endpoint-migration.md`。
- `yarn migrate:front --dry-run` 可在不连接数据库时检查迁移顺序与 SHA-256；正式执行需要 `MSFRONT_DATABASE_URL` 或 `DATABASE_URL`。
- `supply-chain.yml` 使用固定 commit SHA 的 Syft/Anchore action 生成 CycloneDX SBOM，并以 High 为失败阈值运行 Grype。`security-analysis.yml` 对 Go 与 JavaScript/TypeScript 执行 CodeQL，PR 还会执行 dependency review。
- 根 Node 契约禁止 workflow action 和 service image 使用可变 tag。只有远端 workflow 成功记录才能作为交付证据。

## 文档

- [Framework](./Framework/README.md)
- [Example](./Solutions/Example/README.md)
- [Billing](./Services/Billing/README.md)
- [MSFront](./MSFront/README.md)
- [架构与性能评估](./docs/评估/项目架构与性能评估.md)
- [OpenAPI 兼容性政策](./docs/openapi/compatibility-policy.md)
- [健康接口迁移](./docs/openapi/health-endpoint-migration.md)
- [API 消费者与 SDK 矩阵](./docs/openapi/consumer-matrix.md)
- [Nginx Edge 基线](./support/deploy/edge/README.md)
- [Kubernetes 编排基线](./support/deploy/kubernetes/README.md)
- [HTTP transport 选择 ADR](./docs/adr/0001-http-framework-selection.md)
- [待优化 V4](./docs/待优化/待优化V4.md)
- [待优化 V5](./docs/待优化/待优化V5.md)
- [待优化 V6](./docs/待优化/待优化V6.md)
- [待优化 V7](./docs/待优化/待优化V7.md)
- [待优化 V8](./docs/待优化/待优化V8.md)
- [待优化 V9](./docs/待优化/待优化V9.md)
- [待优化 V10](./docs/待优化/待优化V10.md)
- [待优化 V11](./docs/待优化/待优化V11.md)
- [待优化 V12](./docs/待优化/待优化V12.md)
- [待优化 V13](./docs/待优化/待优化V13.md)
- [待优化 V10](./docs/待优化/待优化V10.md)
- [待优化 V11（非 MSFront）](./docs/待优化/待优化V11.md)
- [待优化 V12（已完成，非 MSFront）](./docs/待优化/待优化V12.md)
- [待优化 V13（当前，非 MSFront）](./docs/待优化/待优化V13.md)
- [Tools](./tools/README.md)
