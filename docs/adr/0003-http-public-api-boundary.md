# ADR 0003：HTTP 公共 API 与 Fiber 兼容边界

- 状态：已接受
- 日期：2026-09-03
- 范围：`Framework/httpapi`、`Framework/observability`、`Framework/server`、Example 与 Billing 生产入口
- 关联：`docs/待优化/待优化V15.md` V15-05、ADR 0001、ADR 0002

## 背景

Framework 的业务 use case 已通过 `ApplicationQuery`、`ApplicationCommand` 和 `context.Context` 与 Fiber 隔离，默认生产 listener 也已使用 `server.RunHTTP`。但启动代码仍须先接收 `httpapi.New` 返回的 `*fiber.App`，再调用 `NewHTTPHandler`，并把同一对象的 `ShutdownWithContext` 手工配入标准 server。该组合虽然不要求项目源码导入 Fiber，却让正确的 handler/shutdown 所有权配对依赖调用方约定。

当前公开 Fiber 暴露面分为四组：

| 组别 | 现有公开入口 | 决策 |
| --- | --- | --- |
| 应用构造与扩展 | `New`、`NewHTTPHandler`、`Options.RegisterRoutes`、`RouteRegistrar`、`RegisterDefaultRoutes` | 新增标准应用所有权边界；原入口保持兼容 |
| 响应与流 | `Success`、`Failure`、`SendServerSentEvents`、`SendServerSentEventsFromSource` | 保留为 Fiber route adapter；事件、source 与生命周期契约继续保持 transport-neutral |
| 中间件与观测 | `RequestLogger`、`TraceMiddleware*`、`Metrics.Handler/Middleware` | 保留为 Fiber adapter 实现 API；标准入口继续通过 `Options` 获得默认栈，并可在外层组合 `net/http` middleware |
| 原生 listener | `server.Options`、`server.Run` | 保留兼容；生产默认与新增服务使用 `HTTPOptions`、`RunHTTP` |

## 决策

### 标准生产通道

新增 `httpapi.HTTPApplication` 和 `NewHTTPApplication`。该类型直接实现 `http.Handler`，并提供 `Shutdown(context.Context) error`；内部 Fiber app、官方 adaptor 和 pre-shutdown hook 不对调用方暴露。构造函数仍复用同一 `Options`、中间件、路由、错误、SSE 和 request-context bridge，因此不是第二套 HTTP 实现。

Example 与 Billing 生产入口统一把同一个 `HTTPApplication` 实例分别传给 `server.HTTPOptions.Handler` 和 `ApplicationShutdown`。静态守卫要求两个入口不导入 Fiber，也不得退回手工持有 `*fiber.App` 的组合。

业务路由优先使用 `ApplicationQuery` 和 `ApplicationCommand`。它们提供 typed input、认证授权、前置条件、幂等和统一 envelope，并只把 `context.Context` 与最小 principal 交给项目代码。需要标准 middleware 的部署可以在 `HTTPApplication` 外层包装任意 `net/http.Handler`。

### Fiber 原生兼容通道

`New`、`NewHTTPHandler`、`RouteRegistrar`、Fiber response/SSE helpers、observability middleware 以及 `server.Run` 保持兼容，不在当前 `0.1.x` 行删除或修改签名。明确选择 Fiber listener、定制 Fiber middleware 或高级 `fiber.Ctx` 响应控制的调用方仍可使用这些入口。

本轮不把一个标准 `http.Handler` 再反向适配进 Fiber route 后重新适配回 `net/http`。双重适配会模糊 caller context、写期限、flush、hijack 和断连所有权，不能作为可替换性优化。自定义 SSE 已通过新增 `ApplicationEventStream` transport-neutral descriptor 落地：它复用现有 `ServerSentEventSource`、认证/角色边界和生命周期实现，不修改现有 SSE 签名；其它需要不同 wire contract 的流仍须经过同一评估门槛。

## 兼容与迁移

标准服务可从：

```go
app := httpapi.New(options)
handler, err := httpapi.NewHTTPHandler(app)
```

迁移为：

```go
application, err := httpapi.NewHTTPApplication(options)
```

随后将 `application` 作为 `http.Handler`，并将 `application.Shutdown` 作为 application shutdown hook。现有 `Options`、路由行为、wire contract、超时、SSE 和 shutdown 预算不变；迁移是加法 API，不要求调用方立即变更。

## 后续决策门槛

是否进一步收缩 Fiber 公共面仍由 ADR 0001 的固定 Linux、真实 payload、依赖、TLS edge、取消和容量证据决定。没有外部消费者迁移窗口与符合 SemVer 的版本变更，不删除兼容通道。目标 edge、WebSocket、HTTP/3、远端性能和生产容量继续保持 `not_recorded`。

## 验证

- `HTTPApplication` 的标准 handler、context bridge、统一响应和 shutdown 行为测试；
- nil/零值生命周期失败边界；
- Example/Billing 生产入口编译与静态源码守卫；
- 公共 API snapshot 与向后兼容比较；
- 全量 test、race、vet、build 与 evidence verifier。
