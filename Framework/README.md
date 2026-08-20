# Framework

`Framework` 是 GoExample 的公共 Go module，module path 为 `github.com/zbxing/goexample/Framework`。它封装 Fiber v3.5.0 的服务器基础设施，不包含可执行入口或部署环境文件。

## 包

| 包 | 职责 |
| --- | --- |
| `auth` | 示例 JWT 签发、验证和演示用户模型 |
| `config` | 环境变量读取、默认值和启动前安全校验 |
| `health` | 并发依赖检查、单次后台刷新、缓存和 draining |
| `httpapi` | Fiber 初始化、中间件、统一响应、系统路由和项目路由扩展点 |
| `observability` | `slog` 请求日志、HTTP/Go runtime metrics、OpenTelemetry span 与有界 OTLP/HTTP exporter |
| `server` | listener、readiness 摘流、传播等待和优雅停机 |
| `validation` | go-playground/validator 的 Fiber 适配 |

## 项目扩展

无请求体的项目 GET use case 优先通过 `httpapi.Options.ApplicationQueries` 注册，并用 `Endpoints` 声明根索引。Example 的生产组合不需要导入 Fiber：

```go
apiOptions := httpapi.Options{
    Name:        "Example API",
    Environment: "development",
}
apiOptions.Endpoints = projectapi.Endpoints(authEnabled)
apiOptions.ApplicationQueries = projectapi.Queries(apiOptions)
app := httpapi.New(apiOptions)
```

`ApplicationQuery` handler 只接收 `context.Context` 并返回结构化数据或错误；Framework 内部 Fiber adapter 负责 `{code,data,msg}` envelope、错误脱敏和既有 middleware。它刻意只覆盖当前真实的 bodyless GET 需求。带 path/query/body/header 或定制 middleware 的路由仍可使用高级 `RegisterRoutes` 逃生口；两种模式不能同时配置。`httpapi.RegisterDefaultRoutes` 提供演示认证和 echo/validate/delay 路由。

`httpapi.Options` 支持注入 Fiber `Storage` 与幂等 `Locker`。应用入口应在生产使用 `httpapi.ValidateSharedState` 校验 `external` 模式，并为 limiter、认证 limiter 和每个幂等路由保留独立命名空间。Framework 只定义 Fiber 存储边界，不把内存替身或 Fiber 的读改写 limiter 算法当作跨节点原子 Redis 实现。

幂等写请求会把 `X-Idempotency-Key` 绑定到 method、原始 target、认证 subject、规范化 Content-Type 和原始 body 的 SHA-256 指纹。相同 key 与相同指纹可回放缓存响应并设置 `X-Idempotency-Replayed: true`；相同 key 用于不同请求时返回禁缓存的 `409 Conflict`，且不会执行 handler 或覆盖旧响应。存储仅保留摘要，不保存原始凭据或请求体；生产多实例仍必须注入具备跨节点原子语义的实现。

`httpapi.Options.MaxInFlight` 为 `/api/v1` 提供非阻塞 admission control，默认值为 256。容量耗尽时请求快速返回 `503`、`Retry-After: 1` 和 `Cache-Control: no-store`，避免无界排队放大延迟；实例进入 draining 后，新业务请求同样快速返回 `503`，已有请求不被 gate 中断，顶层健康探针不经过该限制。生产应结合 Linux 压测、下游预算和实例资源调节 `HTTP_MAX_IN_FLIGHT`，它不替代跨实例限流或共享状态。

`httpapi.Options.MaxConnections` 映射 Fiber/fasthttp 的 transport 连接并发上限，默认值为 4096，可通过 `HTTP_MAX_CONNECTIONS` 配置。连接容量耗尽时 transport 直接返回 `503` 并关闭连接，可能被标准客户端报告为连接错误；它发生在应用 middleware 之前，不带 `Retry-After`。真实 TCP 契约另行覆盖请求头/请求体 `ReadTimeout`、慢读客户端触发 `WriteTimeout`、keep-alive 复用与空闲回收、半关闭响应，以及 shutdown 后空闲连接归零。

`httpapi.Options.ReadBufferSize` 显式控制 Fiber 请求头读取预算，默认 16 KiB，配置范围为 4 KiB 至 1 MiB。超限请求由 transport 返回 `431 Request Header Fields Too Large`；生产应结合认证头、Cookie、代理注入头和目标 edge 配置共同设定，不应仅依赖默认值。

## API 生命周期

`/api/health`、`/api/health/ready` 和 `/api/health/startup` 是已弃用的兼容别名，分别迁移到 `/livez`、`/readyz` 和 `/startupz`。兼容路由在成功与错误响应都返回 `Deprecation: @1787184000`、`Sunset: Sat, 20 Feb 2027 00:00:00 GMT` 和带 `rel="successor-version"` 的 `Link`，并通过 CORS 暴露这些字段。标准探针不返回弃用头；完整窗口与消费者检查项见 `docs/openapi/health-endpoint-migration.md`。

## 可观测性

`httpapi.Options.TracerProvider` 可注入官方 OpenTelemetry `TracerProvider`。请求中间件创建 `SERVER` span，严格传播 W3C `traceparent`/`tracestate`，并只记录 method、route template 和 status 等有界属性；raw URL、请求体、token、任意错误文本和用户输入不会写入 span attribute。未注入 provider 时仍生成不导出的本地 span，以保持 trace/log 关联契约。

`observability.NewTracerProvider` 默认关闭 exporter。启用 `otlp` 后使用 OTLP/HTTP protobuf、ParentBased ratio sampler 和非阻塞的有界 `BatchSpanProcessor`；queue、batch、schedule delay 与 export timeout 均有配置校验。调用方必须在退出路径以固定 timeout 执行 `Shutdown`，刷新已排队 span。仓库行为测试只验证本地假 collector 的 wire contract、慢 collector 不阻塞请求和 shutdown flush；真实 collector、outbound/database instrumentation、drop/retry 指标、dashboard 与告警演练仍属于部署工作。

## 生命周期

`server.Run` 接受组装后的 `*fiber.App`、监听地址、health checker、logger 和 shutdown 预算。收到取消信号后先设置 draining，再等待可选传播延迟，最后在总预算内停止 listener。项目入口只负责加载自身配置和依赖。

## 验证

从仓库根目录执行：

```powershell
yarn test:server
yarn cover:server
yarn race:server
yarn vet:server
yarn vuln:server
yarn bench:server
```

Framework 不默认开启 `Prefork`、`Immutable`、`ReduceMemoryUsage` 或自定义 concurrency。此类选项必须在目标 Linux、TLS、代理和真实 I/O 压测后决定。
