# ADR 0002：HTTP 请求生命周期与协议边界

- 状态：已接受（默认标准入口已桥接取消；原生 Fiber listener 限制保留）
- 日期：2026-08-18
- 范围：`Framework/httpapi`、`Framework/server` 与 Example 部署边界
- 关联：`docs/待优化/待优化V9.md` V9-03

## 决策

1. 应用 use case 只接收 `context.Context`。Fiber adapter 必须传递 `c.Context()`，不能把可复用的 `fiber.Ctx` 保存到 handler 生命周期之外。
2. API 请求 context 同时受 `HTTP_REQUEST_TIMEOUT` 和服务停机控制。`httpapi.New` 创建独立的应用生命周期 context，Fiber `OnPreShutdown` hook 会先取消该 context，再进入 listener shutdown；`requestDeadline` 从它派生请求 context，因此停机可取消仍在运行的协作式下游任务，且不依赖 fasthttp `RequestCtx` 的内部并发行为。
3. `NewHTTPHandler` 用不可预测、一次性且仅进程内解析的令牌把原始 `http.Request.Context()` 交给 Framework 的第一个 middleware；令牌在任何日志、路由或业务 handler 前从请求删除。caller deadline、主动取消、标准 middleware value 和标准 listener 的真实 TCP 断连因此会进入 application context。
4. 原生 Fiber/fasthttp listener 仍不承诺客户端断开后及时取消下游任务。保留的真实 TCP 对照固定了该限制：客户端发送请求后关闭 socket，不会在 100 ms 内关闭应用 context；该兼容入口仍由主动 request deadline 或 server shutdown 兜底，不用于依赖即时断连取消的大上传、昂贵查询或长流式请求。
5. Example 默认由 `server.RunHTTP` 的标准 listener 承载经 Fiber adaptor 组装的 handler；accepted connection、read-header/read/write/idle/header、request cancellation、draining 和 shutdown 均有本地契约。Fiber direct listener 的 HTTP/1.1/TLS 行为和标准 `net/http` TLS/HTTP/2、loopback reverse proxy 另有对照。仓库现固定 Nginx 1.30.4 edge 配置与真实容器 CI 入口，但这仍不代表目标 Nginx/Ingress 已运行或 HTTP/3 已支持；在完成目标 edge 的握手、header、buffering、timeout 和断连传播测试前不得宣称为生产能力。

## 已验证行为

`Framework/httpapi/lifecycle_contract_test.go` 使用真实 `net.Listener` 和 TCP socket 验证：

- 主动 request deadline 在 500 ms 上限内终止协作式 handler，并返回 HTTP 408；
- server shutdown 在 500 ms 上限内取消活动 handler，应用 context 返回 `context.Canceled`；
- `NewHTTPHandler` 保留 caller 的较短 deadline 与 middleware context value；主动取消和标准 TCP 客户端直接关闭 socket 都会使 application context 返回 `context.Canceled`，伪造的内部桥接 header 在原生/标准入口都不会到达路由；
- Fiber `tls.Listener` 能完成受信任证书的 HTTPS/HTTP/1.1 请求并在 shutdown 时清理；
- Fiber `SendStreamWriter` 能按 flush 顺序发送最小多块响应；受控慢读客户端会制造 socket 背压，并证明 `HTTP_WRITE_TIMEOUT` 安装的写截止时间终止底层写入和流生产；该契约仍不代表 SSE/WebSocket 已获得完整生命周期支持；
- `/api/v1` 的 `HTTP_MAX_IN_FLIGHT` 提供非阻塞应用 admission：容量耗尽返回 `503` 与 `Retry-After`，顶层健康探针不占用业务 slot；这不是传输层慢客户端背压的替代品；
- readiness 进入 draining 后，新的 `/api/v1` 请求返回 `503` 与 `Retry-After`，已经开始的 handler 不被该 gate 中断；容量拒绝和摘流拒绝分别计数；
- `HTTP_READ_BUFFER_SIZE` 显式限定请求头读取预算（默认 16 KiB，4 KiB–1 MiB），真实 TCP 超限请求返回 431；该上限必须与 edge、认证头和 Cookie 预算一致；
- `HTTP_READ_TIMEOUT` 会限制请求头和请求体读取阶段；真实 TCP 只发送不完整请求头或声明长度后停止上传时返回 408，业务 handler 不执行；
- `HTTP_MAX_CONNECTIONS` 在 Example 默认 `server.RunHTTP` 路径限制标准 listener 已接受的连接数；容量耗尽时暂停 `Accept` 直到已有连接关闭，因此调用方必须设置连接 timeout，edge 应提供更早的容量拒绝。Fiber direct-listener 对照仍验证容量耗尽时返回 503；两种行为都发生在应用 middleware 前，不带 application admission 的 `Retry-After` 或 metrics counter；
- 同一 HTTP/1.1 TCP 连接可连续完成两个请求，短 `IdleTimeout` 会回收空闲 keep-alive 连接；
- 客户端发送完整请求后半关闭写端，服务端仍会返回完整响应并关闭连接；计数 listener 证明 shutdown 后空闲 keep-alive 连接从 active 1 收敛到 0；
- 原生 Fiber listener 下客户端强制关闭 TCP 连接不会及时取消应用 context，这是兼容入口的已知限制；Example 默认标准 listener 的断连取消由独立契约覆盖。

`Solutions/Example/internal/projectapi/transport_benchmark_test.go` 额外验证标准 `net/http` TLS/HTTP/2，以及 loopback HTTP/2 edge 到 Fiber HTTP/1.1 upstream 的 envelope 一致性；这些测试不替代目标平台代理演练。

`support/deploy/edge/goexample-nginx.contract.json` 固定 Nginx 1.30.4 digest、TLS 1.2/1.3、HTTP/2、header/body/timeouts、无请求/响应缓冲、禁上游重试和 SIGQUIT drain。`scripts/nginx-edge-contract.mjs` 的 Linux Docker 入口验证 trace/request-ID、431/502/503/504、上传中断和在途 drain，并归档原始日志与 hash；GitHub runner loopback artifact 仍不是目标 edge 证据。

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

- 目标 edge-to-client 真实证书 TLS/HTTP/2 与 HTTP/3 自动握手测试；
- 目标 edge-to-app timeout、buffering、header 与断连传播实验；仓库固定容器入口不替代目标平台；
- 目标 edge 下的慢上传、慢响应、半关闭、连接容量和断连传播测试；应用直连 TCP 与固定 Nginx loopback 只覆盖基础行为；
- SSE/WebSocket 的背压、心跳、断连清理和停机契约；当前通用流响应测试不代表这些协议已受支持；
- 目标 edge 到标准入口的断连取消与长请求清理证据；本地直连标准 TCP 契约不替代目标平台代理行为。
