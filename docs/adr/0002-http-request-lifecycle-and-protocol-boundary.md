# ADR 0002：HTTP 请求生命周期与协议边界

- 状态：已接受（客户端断连限制待解除）
- 日期：2026-08-18
- 范围：`Framework/httpapi`、`Framework/server` 与 Example 部署边界
- 关联：`docs/待优化/待优化V9.md` V9-03

## 决策

1. 应用 use case 只接收 `context.Context`。Fiber adapter 必须传递 `c.Context()`，不能把可复用的 `fiber.Ctx` 保存到 handler 生命周期之外。
2. API 请求 context 同时受 `HTTP_REQUEST_TIMEOUT` 和服务停机控制。`httpapi.New` 创建独立的应用生命周期 context，Fiber `OnPreShutdown` hook 会先取消该 context，再进入 listener shutdown；`requestDeadline` 从它派生请求 context，因此停机可取消仍在运行的协作式下游任务，且不依赖 fasthttp `RequestCtx` 的内部并发行为。
3. 当前 Fiber/fasthttp 链路不承诺客户端断开后取消下游任务。真实 TCP 实验固定了该限制：客户端发送请求后关闭 socket，不会在 100 ms 内关闭应用 context；任务仍由主动 request deadline 或 server shutdown 兜底。
4. 在该限制解除或获得经批准的 edge 补偿前，不把 Fiber 用于依赖即时断连取消的大上传、昂贵查询或长流式请求。若目标业务需要该语义，迁移到基于 `net/http` 的 transport 是 V9-01 的框架判定条件。
5. 当前 Fiber application listener 的已验证协议是 HTTP/1.1，真实 TLS listener 握手已有本地契约。标准 `net/http` 和 loopback reverse proxy 另有 TLS/HTTP/2 对照，但它们不代表 Fiber listener 或 Nginx/Envoy 生产 edge 已支持 HTTP/2/3；在完成目标 edge 的握手、header、buffering、timeout 和断连传播测试前不得宣称为生产能力。

## 已验证行为

`Framework/httpapi/lifecycle_contract_test.go` 使用真实 `net.Listener` 和 TCP socket 验证：

- 主动 request deadline 在 500 ms 上限内终止协作式 handler，并返回 HTTP 408；
- server shutdown 在 500 ms 上限内取消活动 handler，应用 context 返回 `context.Canceled`；
- Fiber `tls.Listener` 能完成受信任证书的 HTTPS/HTTP/1.1 请求并在 shutdown 时清理；
- Fiber `SendStreamWriter` 能按 flush 顺序发送最小多块响应；该测试不覆盖背压、慢 reader/writer 或断连清理；
- `/api/v1` 的 `HTTP_MAX_IN_FLIGHT` 提供非阻塞应用 admission：容量耗尽返回 `503` 与 `Retry-After`，顶层健康探针不占用业务 slot；这不是传输层慢客户端背压的替代品；
- readiness 进入 draining 后，新的 `/api/v1` 请求返回 `503` 与 `Retry-After`，已经开始的 handler 不被该 gate 中断；容量拒绝和摘流拒绝分别计数；
- `HTTP_READ_BUFFER_SIZE` 显式限定请求头读取预算（默认 16 KiB，4 KiB–1 MiB），真实 TCP 超限请求返回 431；该上限必须与 edge、认证头和 Cookie 预算一致；
- `HTTP_READ_TIMEOUT` 会限制请求头读取阶段；真实 TCP 只发送不完整请求头时返回 408，业务 handler 不执行；该契约不代表慢响应 reader/writer 或传输级背压已经完成；
- `HTTP_MAX_CONNECTIONS` 映射 Fiber/fasthttp transport 连接并发上限；真实 TCP 在容量耗尽时返回 503 状态行并关闭连接，拒绝发生在应用 middleware 前，不带应用 admission 的 `Retry-After` 或 metrics counter；
- 客户端强制关闭 TCP 连接不会及时取消应用 context，这是已知限制而不是成功能力。

`Proj/Example/internal/projectapi/transport_benchmark_test.go` 额外验证标准 `net/http` TLS/HTTP/2，以及 loopback HTTP/2 edge 到 Fiber HTTP/1.1 upstream 的 envelope 一致性；这些测试不替代目标平台代理演练。

本地复现命令：

```text
yarn test:server
```

## 超时预算

默认预算保持以下严格关系：

```text
downstream timeout < HTTP_REQUEST_TIMEOUT (8s) < HTTP_WRITE_TIMEOUT (10s)
SHUTDOWN_DRAIN_DELAY + HTTP_REQUEST_TIMEOUT < SHUTDOWN_TIMEOUT (20s)
```

生产 edge 的单次请求 timeout 必须大于应用 `HTTP_REQUEST_TIMEOUT`，同时小于调用方总预算。负载均衡器摘除传播时间计入 `SHUTDOWN_DRAIN_DELAY`；配置校验继续拒绝 drain 与活动请求预算超过总停机预算。

## 未完成项

- 目标 edge-to-client TLS/HTTP/2 或 HTTP/3 自动握手测试；
- edge-to-app timeout、buffering、header 与断连传播实验；
- 慢上传、慢响应 reader/writer、SSE/WebSocket、传输级背压和连接容量测试；请求头读取超时已有契约，但不覆盖这些场景；
- 客户端断连的可控取消实现，或迁移到具备标准取消语义的 transport。
