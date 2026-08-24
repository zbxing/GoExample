# ADR 0001：Example HTTP transport 选择与测量门槛

- 状态：评估中
- 日期：2026-08-18
- 范围：`Proj/Example` 的项目 API transport
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

`Proj/Example/internal/projectapp` 提供不依赖 HTTP 框架的 typed query/result。`internal/projectapi/transport_benchmark_test.go` 使用同一个 service 启动 Fiber 与标准 `net/http`，通过真实 `net.Listener` 对比响应契约。根命令为：

```text
yarn bench:transports
```

该命令在固定 Linux runner 上运行 5 轮 benchmark；Windows/macOS 只执行真实 TCP 契约测试，benchmark 会明确跳过，不能产生可比结论。容量矩阵固定为 `steady-c1`（600 请求/并发 1/keep-alive）、`steady-c16`（2000/16/keep-alive）、`steady-c64`（4000/64/keep-alive）和 `connection-churn-c16`（800/16/关闭 keep-alive），两个 transport 使用相同 application service、响应字段和值及真实 TCP client。

`.github/workflows/go-transport-benchmark.yml` 固定使用 `ubuntu-24.04` 和 `GOMAXPROCS=2`，采集 runner、内核、CPU、Go、commit、进程 CPU/RSS、前后 socket/网络/内存/FD limit 快照、CPU/heap profile 及文本摘要。每轮结构化记录 payload、throughput、p50/p95/p99、连接获取 p95、拨号、在途峰值、alloc/malloc、GC、goroutine 和 Linux FD；其中内存、GC、goroutine 与 FD 是 loopback client/server 共处的 harness 进程增量，不能解释为服务端独占成本。报告器严格要求 5 轮、4 × 2 完整矩阵、零错误与稳定 payload，再输出中位数和 Fiber/`net/http` 方向比；标准 Go benchmark 行另存为后续趋势输入。

workflow 还以并发 32 对每个 transport 执行 30 秒有界 loopback soak。5 秒窗口必须全部有请求且零错误，最低窗口吞吐不得低于窗口中位数的 50%；关闭 idle connection、执行 GC 并等待后，报告器限制 goroutine、heap in-use 和 FD 的粗粒度残留增长。该短时 harness 门禁只能捕获明显回归，不证明无泄漏、目标依赖长稳、生产资源隔离或 RPO/RTO。

workflow 存在不等于已经获得 Linux 结果。当前仓库内固定 workload、报告门禁和制品路径已完成，但没有可引用的远端 artifact、目标 payload/依赖/edge、容量拐点或长稳数据。

真实 TCP 生命周期实验还确认：主动 deadline 和 server shutdown 可以取消协作式 application context，但客户端关闭连接不会及时传播。该限制及迁移条件记录在 `docs/adr/0002-http-request-lifecycle-and-protocol-boundary.md`。

## 结果与复评

截至 2026-08-22，尚无固定 Linux runner 的成功原始 artifact，因此 ADR 保持“评估中”。收集到完整结果后，补充 run URL、原始 artifact、统计摘要、profile、容量拐点和“保留 Fiber/迁移/延后决策”结论，再更新评估分数。
