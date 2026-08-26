# ADR 0001：Example HTTP transport 选择与测量门槛

- 状态：评估中
- 日期：2026-08-18
- 范围：`Solutions/Example` 的业务方案 API transport
- 关联：`docs/待优化/待优化V9.md` V9-01、V9-02、V9-03

## 背景

当前服务使用 Fiber v3。Fiber 的低分配和吞吐优势必须在本项目的真实请求模型中得到证明，不能直接引用各框架官方的 hello-world benchmark。与此同时，项目业务不应依赖 `fiber.Ctx`，否则 transport 选择会变成业务扩展契约。

本 ADR 先固定比较口径，再收集结果。没有 Linux 目标环境的运行记录时，不做保留或迁移结论。

## 决策门槛

在目标负载和相同业务语义下，只有同时满足以下条件，才保留 Fiber 作为默认 transport：

1. 在至少 5 轮运行中，Fiber 的 p95/p99 延迟和吞吐优势方向一致，不接受单轮噪声结论。
2. 相比 `net/http` 基线，Fiber 在目标并发下至少有 20% 的 p99 改善，或至少有 15% 的 CPU 降低；收益必须位于 HTTP/序列化热路径，而不是被数据库或日志差异解释。
3. 断连取消、超时、keep-alive、TLS/edge 和目标部署协议没有额外失败语义。
4. 若未达到门槛，优先选择 `net/http` 生态（必要时使用 Chi/Gin/Echo），并保留已完成的 application 边界。

门槛不能在查看结果后调整。若目标流量模型发生变化，必须新建 ADR 修订并记录原因。

## 固定工作负载

基准必须使用同一个 `projectapp.Service` 和同一 JSON envelope，逐步覆盖：

- 纯 JSON 项目查询（当前已实现的真实 TCP 基线）；
- JSON 校验失败和带认证请求；
- 5/20/50 ms 模拟数据库或 RPC 延迟；
- keep-alive、不同并发度、客户端提前断连和请求取消；
- TLS 或真实 edge 代理路径。

每次结果至少记录 throughput、p50/p95/p99、错误率、CPU、RSS、alloc/op、GC、连接数和取消后的残留任务，并保存硬件、内核、Go、框架版本和完整命令。

## 当前实现与命令

`Solutions/Example/internal/projectapp` 提供不依赖 HTTP 框架的 typed query/result。`internal/projectapi/transport_benchmark_test.go` 使用同一个 service 启动 Fiber 与标准 `net/http`，通过真实 `net.Listener` 对比响应契约。根命令为：

```text
yarn bench:transports
```

该命令在固定 Linux runner 上运行 5 轮 benchmark；Windows/macOS 只执行真实 TCP 契约测试，benchmark 会明确跳过，不能产生可比结论。容量矩阵固定为 keep-alive 并发 1/2/4/8/16/32/64/128 的八级阶梯和 `connection-churn-c16`（800/16/关闭 keep-alive）。独立场景矩阵通过完整 Framework middleware 固定执行 `response-32k-c16`（至少 32 KiB）、`auth-reject-c16`（无效 Bearer、401、application handler 零调用）和 `dependency-delay-5ms-c32`（可取消的 5ms 依赖延迟），两个 transport 均使用真实 TCP client。

`.github/workflows/go-transport-benchmark.yml` 固定使用 `ubuntu-24.04` 和 `GOMAXPROCS=2`，采集 runner、内核、CPU、Go、commit、进程 CPU/RSS、前后 socket/网络/内存/FD limit 快照、CPU/heap profile 及文本摘要。容量测量结构化记录 payload、throughput、p50/p95/p99、连接获取 p95、拨号、在途峰值、alloc/malloc、GC、goroutine 和 Linux FD；其中内存、GC、goroutine 与 FD 是 loopback client/server 共处的 harness 进程增量，不能解释为服务端独占成本。报告器严格要求 5 轮、9 × 2 容量矩阵和 3 × 2 场景矩阵、零错误与稳定 payload，再输出中位数、Fiber/`net/http` 方向比，并分别计算首次达到观测峰值吞吐 90% 的经验饱和并发、峰值并发、相对 c1 的吞吐/p95 变化和末端吞吐保持率。若提供上一轮 schema v4 报告，容量和场景均固定比较吞吐/p95/p99 10%/20%/25% 阈值；`environmentFingerprint` 规范化记录 runner OS/arch/image、CPU model/logical CPUs、Go version 与 `GOMAXPROCS=2`，其 SHA-256 由报告器生成并由准入器复算，只有当前与历史字段一致才执行阈值，环境差异会优先列出 mismatch 并标记 `not_checked`。workflow 只从同仓库默认分支成功的 push/manual run 选择未过期候选，排除 PR 来源；准入器校验来源、2 MiB 上限、schema/scope、两组完整矩阵、median 与 GitHub Actions/Linux 指纹，并记录 run/commit/artifact、候选及环境摘要，缺失时清理陈旧 baseline。这三种场景是固定 loopback 合成契约，不代表目标 payload、目标 IdP、目标依赖或 TLS edge；经验饱和点和回归阈值也不是生产容量上限。

workflow 还以并发 32 对每个 transport 执行 30 秒有界 loopback soak。5 秒窗口必须全部有请求且零错误，最低窗口吞吐不得低于窗口中位数的 50%；关闭 idle connection、执行 GC 并等待后，报告器限制 goroutine、heap in-use 和 FD 的粗粒度残留增长。该短时 harness 门禁只能捕获明显回归，不证明无泄漏、目标依赖长稳、生产资源隔离或 RPO/RTO。

workflow 存在不等于已经获得 Linux 结果。当前仓库内固定容量/场景 workload、经验饱和点、受信历史制品自动选择、环境可比性校验、跨运行回归报告门禁及制品路径已完成，但没有可引用的远端 artifact 或已选择且指纹可比的历史 baseline，也没有目标 payload/IdP/依赖/TLS edge、目标负载容量拐点或长稳数据。

真实 TCP 生命周期实验还确认：主动 deadline 和 server shutdown 可以取消协作式 application context，但客户端关闭连接不会及时传播。该限制及迁移条件记录在 `docs/adr/0002-http-request-lifecycle-and-protocol-boundary.md`。

## 结果与复评

截至 2026-08-25，尚无固定 Linux runner 的成功原始 artifact，因此 ADR 保持“评估中”。收集到完整结果后，补充 run URL、原始 artifact、统计摘要、profile、容量拐点和“保留 Fiber/迁移/延后决策”结论，再更新评估分数。
