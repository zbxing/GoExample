# Framework

`Framework` 是 GoExample 的公共 Go module，module path 为 `github.com/zbxing/goexample/Framework`。它封装 Fiber v3.5.0 的服务器基础设施，不包含可执行入口或部署环境文件。

## 包

| 包 | 职责 |
| --- | --- |
| `auth` | 示例 JWT 签发、验证和演示用户模型 |
| `config` | 环境变量读取、默认值和启动前安全校验 |
| `health` | 并发依赖检查、单次后台刷新、缓存和 draining |
| `httpapi` | Fiber 初始化、中间件、统一响应、系统路由和项目路由扩展点 |
| `observability` | `slog` 请求日志、HTTP histogram 和 Go runtime metrics |
| `server` | listener、readiness 摘流、传播等待和优雅停机 |
| `validation` | go-playground/validator 的 Fiber 适配 |

## 项目扩展

项目通过 `httpapi.Options.RegisterRoutes` 注册自己的 `/api/v1` 路由，并用 `Endpoints` 声明根索引。Example 的模式如下：

```go
apiOptions := httpapi.Options{
    Name:        "Example API",
    Environment: "development",
}
apiOptions.Endpoints = projectapi.Endpoints(authEnabled)
apiOptions.RegisterRoutes = func(v1 fiber.Router) {
    projectapi.Register(v1, apiOptions)
}
app := httpapi.New(apiOptions)
```

`httpapi.RegisterDefaultRoutes` 提供演示认证和 echo/validate/delay 路由；真实项目可以完全替换该注册器。`httpapi.Success` 和 `httpapi.Failure` 用于保持统一 `{code,data,msg}` 契约。

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
