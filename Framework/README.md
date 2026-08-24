# Framework

`Framework` 是 GoExample 的公共 Go module，module path 为 `github.com/zbxing/goexample/Framework`。它封装 Fiber v3.5.0 的 HTTP adapter、标准 `net/http` server 生命周期及共享服务基础设施，不包含可执行入口或部署环境文件。

## 包

| 包 | 职责 |
| --- | --- |
| `auth` | 演示 JWT 签发、通用 Bearer/JWKS 验证、受限 refresh/opaque browser session 和 OIDC discovery/PKCE 请求契约 |
| `authorization` | 有界、transport-neutral 的 tenant/resource/action/attribute 授权请求与策略接口 |
| `config` | 环境变量读取、默认值和启动前安全校验 |
| `health` | 并发依赖检查、单次后台刷新、缓存和 draining |
| `httpclient` | 有界标准库出站 HTTP client、W3C trace 传播和低敏 `CLIENT` span |
| `httpapi` | Fiber 初始化、中间件、统一响应、系统路由和项目路由扩展点 |
| `observability` | `slog` 请求日志、HTTP/Go runtime metrics、OpenTelemetry span 与有界 OTLP/HTTP exporter |
| `queueclient` | broker-neutral 有界 publish/process callback、consumer worker 生命周期、W3C 传播和低敏消息 span |
| `queueclient/natsjetstream` | NATS JetStream 同步 publish ack、pull delivery、confirmed ack 与 publish-before-ack DLQ adapter |
| `server` | Fiber/标准 `net/http` listener、连接与超时上限、固定状态观察、readiness 摘流和优雅停机 |
| `sharedstate` | Redis Storage、分布式幂等锁、Lua 原子限流和 readiness 检查 |
| `sqlclient` | 有界 `database/sql` PostgreSQL pool、事务/锁/query 操作和低敏 `CLIENT` span |
| `validation` | go-playground/validator 的 Fiber 适配 |

## 项目扩展

无输入 GET use case 可直接通过 `httpapi.Options.ApplicationQueries` 注册；带 URI/query/header 输入的 GET 使用泛型 `httpapi.NewQuery`，需要认证主体时使用 `httpapi.NewAuthenticatedQuery`，还需角色门禁时使用 `httpapi.NewAuthorizedQuery`；需要返回可信资源版本的 GET 使用对应的 `NewVersionedQuery`、`NewAuthenticatedVersionedQuery` 或 `NewAuthorizedVersionedQuery`。query 默认方法为 GET，需要无 body 探测时可调用 `ApplicationQuery.WithMethod(HEAD)`；HEAD 与 GET 按方法独立校验路径冲突，并复用认证、绑定、ETag 和错误边界。带验证 JSON body 的写操作使用泛型 `httpapi.NewJSONCommand`，认证与角色版本分别使用 `httpapi.NewAuthenticatedJSONCommand`、`httpapi.NewAuthorizedJSONCommand`，乐观并发版本使用对应的 `NewVersionedJSONCommand`、`NewAuthenticatedVersionedJSONCommand` 或 `NewAuthorizedVersionedJSONCommand`。command 默认方法为 POST，PUT/PATCH/DELETE 可调用 `WithMethod`。这些路由都用 `Endpoints` 声明根索引，Example 的生产组合不需要导入 Fiber：

```go
apiOptions := httpapi.Options{
    Name:        "Example API",
    Environment: "development",
}
apiOptions.Endpoints = projectapi.Endpoints(authEnabled)
apiOptions.ApplicationQueries = projectapi.Queries(apiOptions)
apiOptions.ApplicationCommands = projectapi.Commands(apiOptions)
app := httpapi.New(apiOptions)
```

旧式 `ApplicationQuery` handler 只接收 `context.Context`；`NewQuery`/`NewJSONCommand` handler 额外接收编译期确定的 request，authenticated/authorized 版本再接收只包含 subject、username 和 role IDs 的 `ApplicationPrincipal`，token/JWT/Fiber claims 不越过 adapter；authorized 版本声明任一满足（any-of）的精确角色 ID 集合。Framework 内部 Fiber adapter 负责显式输入源绑定、结构校验、认证/授权、JSON media type、幂等请求指纹、`{code,data,msg}` envelope、错误脱敏和既有 middleware。未覆盖的 HTTP method 或定制 middleware 仍可使用高级 `RegisterRoutes` 逃生口；application query/command 不能与该逃生口同时配置。`NewHTTPHandler` 可将组装后的 app 暴露为标准 `net/http.Handler`，Example 默认再由 `server.RunHTTP` 承担标准 listener 生命周期；该标准入口会把 caller deadline、取消和 context value 传入 application context，原生 Fiber listener 仍保留 fasthttp 的断连语义。`httpapi.RegisterDefaultRoutes` 提供认证可选的 echo/validate/delay 路由；本地 `/auth/login` 只有 demo `Auth` 启用时才注册，注入外部 `TokenVerifier` 只注册 Bearer 路由。

typed query request 的每个导出字段必须显式且只能声明一个 `uri`、`query` 或 `header` tag，URI tags 必须与路径中的 `:name` 一一对应；各来源先绑定到隔离的临时值再复制目标字段，query/header 无法覆盖 URI。动态 query 只允许命名参数，通配符、转义、反斜杠、控制字符、重复分隔符、相对段、query/fragment、重复参数及静态/动态重叠都会在启动前失败。旧式 query 与 command 仍要求规范静态路径；同 method 路径和默认 GET/POST 路由碰撞按大小写不敏感及动态匹配语义判断。所有定义会在注册任何 application route 前完成校验，避免 Fiber 注册顺序导致 handler 静默不可达。

authorized query/command 的角色声明会在构造时复制，并在启动时拒绝空列表、重复值、非法 ID 或超过 32 个角色；角色 ID 按大小写敏感的精确值比较。认证通过但没有任何声明角色时，在输入来源/media type/body bind、幂等锁和 application handler 前返回固定 403 与禁缓存响应，并只写入不含 subject、角色、claims、路径或凭据的低敏拒绝审计。受保护 command 的幂等指纹在 Bearer 验证后计算，因此使用已验证 subject 而不是匿名主体。

需要 tenant/resource 级策略时，使用 `NewResourceAuthorizedQuery`、`NewResourceAuthorizedVersionedQuery`、`NewResourceAuthorizedJSONCommand` 或 `NewResourceAuthorizedVersionedJSONCommand`。resolver 只接收 typed request 和最小 `ApplicationPrincipal`，输出 `authorization.Resource`；Framework 会验证 subject、角色、tenant、resource type/ID、action 和最多 16 个有界 attribute，再以默认 100ms、最大 1s 的 `ResourceAuthorizationTimeout` 调用 `authorization.Authorizer`。query 顺序为 Bearer -> role -> bind/validation -> resource policy -> handler；resource command 为 Bearer -> role -> media type -> bind/validation -> resource policy -> precondition/idempotency -> handler，因此拒绝不会创建幂等状态或 application span。deny、非法 decision、backend error、timeout 和 panic 均折叠为固定禁缓存 403，不暴露 tenant/resource/backend 细节；非法 resource 固定为 400。策略实现必须遵守 context，部署仍需提供真实的关系/属性数据、缓存失效、跨副本一致性和策略变更审计。

versioned query handler 返回数据与未加引号的资源 tag；Framework 使用与写侧相同的受限格式验证 tag，并输出强 `ETag` 与禁缓存头。GET/HEAD 的 `If-None-Match` 按 HTTP 弱比较处理，支持强/弱标签、列表和通配符；匹配当前版本时返回保留 ETag 的空体 304，未匹配时返回正常 envelope。认证和角色授权仍先于参数绑定与 handler，非法响应 tag 折叠为固定 500 且不会泄漏 tag 或应用数据。该条件读取逻辑只位于 versioned query adapter，不会把 versioned PATCH 等写响应错误转换为 304。

versioned command 在认证与授权之后、media type/幂等/body bind 之前要求精确一个受限强 `If-Match`：缺失返回 428，弱标签、通配符、列表、未加引号或非法 token 返回固定 400。handler 接收去引号的 `ApplicationPrecondition.EntityTag`，成功时返回新的去引号 tag；Framework 输出强 `ETag` 和禁缓存响应。应用将 `sqlclient.ErrOptimisticConflict` 等持久化冲突映射为 `ErrPreconditionFailed` 后得到固定 412。versioned command 的幂等指纹额外绑定 `If-Match`，同 key/同 tag 可回放并保留 ETag，同 key/不同 tag 固定冲突，普通 command 的既有指纹不变。应用仍须在自己的 OpenAPI 中声明 `If-Match`、`ETag`、400/412/428。

## Bearer 验证

`auth.TokenVerifier` 将 HTTP Bearer 验证与 demo 密码登录/HS256 签发解耦。`httpapi.Options.TokenVerifier` 显式注入时优先于 demo `Auth`；外部 verifier 可启用 `/auth/me`、private 和 authenticated/authorized application routes，但不会暴露必然失败的本地 `/auth/login`。所有验证失败在 HTTP 边界折叠为固定 `ErrInvalidToken`/401，不记录上游 URL、响应、token、claims 或原始错误。

`auth.NewJWKSVerifier` 在构造时同步获取 JWKS，并仅接受 RS256、2048 至 8192 位 RSA key、固定 issuer/audience、必需 `exp`/`nbf`/`iat`/`jti` 与现有有界身份/角色 claims。token 最大 16 KiB；JWKS 响应最大 1 MiB、最多 100 keys，HTTP timeout、刷新周期和 token 最大 age 均有硬上限。缓存到期刷新失败时 fail closed；未知 `kid` 的刷新至少间隔 5 秒，并通过互斥刷新合并并发 miss。`VerifyIDToken` 复用同一签名/JWKS 边界，额外要求非空 subject、匹配授权请求 nonce、有效 `auth_time`/`iat` 年龄，以及多 audience 时匹配的 `azp`。可选 `RequiredACR`/`RequiredAMR`/`MaxAuthAge` 策略会要求精确 `acr`、全部指定 `amr` 和存在且新鲜的 `auth_time`；claim 数量、长度、重复与格式均有界，失败统一返回私有 invalid-token。零值保持原行为。调用方仍必须在 composition root 校验生产 HTTPS endpoint、DNS/egress、代理和 CA 策略。
上述 verifier 是资源服务器基础，所有生产身份接入仍必须由 composition root 显式配置和审计。

`auth.NewOIDCClient` 提供有界 OIDC discovery/token exchange：它在构造时获取并验证 `/.well-known/openid-configuration`，只接受 `code` 与 `S256` 能力、非空 authorization/token/JWKS endpoint、精确 issuer 和 JSON 响应；discovery 与 token exchange 均禁止重定向，响应分别限制为 64 KiB，HTTP timeout 不超过 10 秒，客户端 secret 不进入 query 或错误文本。`ExchangeCode` 只接受 `AuthorizationCode` 返回的 code/verifier/nonce，提交固定 authorization_code、redirect URI、client ID 和 PKCE verifier，并验证 Bearer、access token、ID token、expires_in、refresh token 和 scope 边界。调用方仍须将返回的 ID token 与 `AuthorizationCode.Nonce` 一起交给 `VerifyIDToken`；loopback HTTP 只用于测试，生产必须使用 HTTPS、受信 CA/egress 和目标 IdP。

`auth.CompleteOIDCCallback` 将 callback state 一次性消费、token exchange 和 nonce-bound `VerifyIDToken` 组合为一个 transport-neutral 操作；state 即使在 exchange 或 claims 验证失败后也不会再次接受，provider 错误只返回固定 sentinel，不暴露响应内容。`httpapi.NewOIDCBrowser` 再提供条件注册的浏览器 start/callback：start 将 state 的 SHA-256 绑定值写入 `__Host-`、Secure、HttpOnly、SameSite=Lax cookie，callback 先一次性消费 state，再以 constant-time 比较 cookie，并完成 exchange、ID-token nonce 和 access-token subject 一致性校验。显式 assurance policy 还会让 authorization request 发送同一 `acr_values` 提示，并在 callback 强制验证而不信任提示本身。`NewOIDCBrowserWithSessions` 在成功 callback 后额外建立不透明应用 session，固定 204 不返回 provider token；session 使用 Secure/HttpOnly/SameSite=Lax `__Host-` cookie，写请求还必须把独立 Strict `__Host-` CSRF cookie 回显到 `X-CSRF-Token`，两层均 constant-time 校验。logout 原子撤销后清除两枚 cookie。session-enabled composition 还条件注册清单、subject 绑定的单会话撤销和整用户撤销 HTTP API；Bearer 或 browser session 均可调用，cookie 认证的 DELETE 继续强制 CSRF。callback/session/CSRF 凭据不进入 body、日志或 span；该边界仍不提供设备名称/指纹或管理 UI，也不替代目标 IdP、真实 MFA enrollment/challenge 或生产身份部署。

`auth.NewSessionManager` 提供 transport-neutral 的本地 refresh session 基础：`SessionConfig` 约束 refresh/absolute TTL 和 family 数量，`Start`/`Rotate` 只向调用者返回原始 token，内部仅保存 SHA-256 token hash。rotation 保留旧 hash 以检测重放并撤销整个 family；每个 family 的历史 hash 还有固定上限，避免长寿命 family 无限增长；`RevokeFamily`、`RevokeUser` 和 `ActiveFamilies` 覆盖 family/user 级撤销与查询，所有状态访问均有互斥保护，绝对 TTL 到期会清理状态。该 manager 是有界的单进程内存组件，不替代跨副本共享存储或生产密钥托管。

`auth.NewBrowserSessionManager` 建立有界应用 session：配置 TTL 会被已验证 access token 的 `exp` 截断，claims 在存储前复制，原始 session/CSRF 凭据只返回一次并且只以 SHA-256 持久化，另签发可公开的随机 `SessionID`；安全方法可使用 HttpOnly session，非安全方法必须额外提交绑定 CSRF。全局上限之外，`MaxSessionsPerSubject` 约束单个 subject，零值保持既有调用兼容。manager 的 `ListForSubject`、`RevokeForSubject` 和 `RevokeAllForSubject` 只接受可信 subject 边界，返回有界低敏清单，并防止跨 subject 撤销；无 Store 模式提供相同语义。可选 `BrowserSessionInventoryStore` 不扩大旧 `BrowserSessionStore` 的方法集合；Redis 实现使用 subject/SessionID SHA-256 索引和 Lua 原子执行跨副本全局/单用户限量、单会话/整用户撤销，后端故障不回退内存。HTTP adapter 只公开 `SessionID`、`CreatedAt`、`ExpiresAt`，非法、不存在和跨 subject 单项撤销统一 404，inventory 后端错误统一 503。双 client 与 HTTP 测试覆盖跨实例清单/撤销、Bearer/cookie、CSRF、跨 subject、并发单用户上限、到期、篡改与 outage；该能力仍不含设备元数据或管理 UI，也不代表目标 Redis HA/TLS/ACL 或身份平台已经部署。

该 verifier、OIDC client、浏览器 callback adapter 和两类 session manager 是资源服务器、仓库内 discovery/token exchange、ID token assurance claims、会话清单与集中撤销基础，并已提供低敏自助 HTTP/OpenAPI/SDK 边界；但不执行 IdP 侧 MFA enrollment/challenge、设备命名/指纹、自助管理 UI、KMS/Vault 或目标身份提供方部署。仓库内 `httptest` discovery/token/JWKS/ID token、state-cookie/回调、CSRF、session 与双 Redis client 行为测试只证明本地协议行为；生产仍需目标 IdP、Redis HA/TLS/ACL、密钥轮换和故障演练证据。

`auth.SessionManager` 可通过 `SessionConfig.Store` 注入 `auth.SessionStore`。`sharedstate.Redis` 实现该契约：family 元数据、token hash 索引、用户索引和有限历史在 namespace 内保存；创建、rotation、family/user revoke 和 active-family 查询使用 Lua/有界 Redis 操作，rotation 在共享 Redis 上线性化，重放触发 family 撤销。Redis 错误不会回退到本地状态；manager 的无 Store 模式仍是有界单进程内存。双 client 的 `miniredis` 测试覆盖跨实例 rotation/reuse、集中 user revoke、family limit 和后端停止 fail-closed，但这不代表生产 Redis HA、Sentinel/Cluster、TLS/ACL、容量、RPO/RTO 或已部署的会话撤销平台。

`auth.NewAuthorizationRequestManager` 提供仓库内 OIDC Authorization Code + PKCE 请求契约：它为每次跳转生成随机 `state`、`nonce` 和 code verifier，构造固定 `response_type=code`、`code_challenge_method=S256` 的 HTTPS 授权 URL，并以有界 TTL/待处理数量保存 hash-keyed 状态。可选且有界的 `ACRValues` 会按 OIDC 标准写入 `acr_values`，但只作为 IdP 请求提示，最终信任仍由 ID-token assurance policy 决定。`StartContext`/`CompleteContext` 可通过 `AuthorizationRequestConfig.Store` 注入共享后端，原 `Start`/`Complete` 保持兼容；`sharedstate.Redis` 只以 state 的 SHA-256 建 key/index，保存恢复 token exchange 所需的有界 verifier/nonce payload，通过 Lua 原子执行全局数量门禁及一次性读取/删除。双 manager/client 测试覆盖并发仅一次成功、过期、tamper、上限、raw state 不落 Redis 与 outage fail-closed。`ValidateAuthorizationNonce` 仍使用 constant-time 比较；这些本地契约不等于目标 IdP MFA、profile 映射或生产 Redis HA 已部署。

## 兼容治理

`VERSION`、`COMPATIBILITY.md`、`CHANGELOG.md` 和 `api-snapshot.json` 定义当前 `0.1.x` 公共兼容边界。`yarn api:compat` 要求工作 snapshot 与所有可导入生产包的导出 API 完全一致；PR 还会对 target branch snapshot 执行新增允许、删除/改签名拒绝的比较。pre-1.0 破坏性变更必须提升 minor，稳定版本必须提升 major，并同步 changelog 与迁移说明。公共 API 有意变更后使用 `yarn api:snapshot` 更新基线。

`httpapi.Options` 支持注入 Fiber `Storage` 与幂等 `Locker`。`sharedstate.NewRedis` 使用 go-redis 提供带前缀的 Storage、启动/就绪 `PING`、有限 I/O 和连接池、owner-token Lua 解锁及 Lua 固定窗口限流。`RedisConfig.TracerProvider` 为连接、命令和 pipeline 创建低敏 `CLIENT` span，只记录固定 operation/result、Redis system 和上限为 1000 的 batch size；不记录 URL/host、key/prefix、value、owner token、命令参数、caller 路径或任意错误文本。`httpapi.ValidateSharedState` 在 `external` 模式除 Storage/Locker 外还要求原子 limiter，避免 Fiber 进程内 mutex 包裹普通 Redis 读改写造成双实例同时放行。limiter、认证 limiter、锁、请求指纹和各幂等路由使用隔离命名空间；Reset 只删除当前配置前缀，不执行全库 flush。

Redis 默认 `standalone` 拓扑保持兼容并只接受 `REDIS_URL`。`sentinel` 拓扑改用 3 至 16 个唯一 `host:port`、安全 master name、独立数据节点/Sentinel ACL、数据库号和克隆后的 TLS 配置，并通过 go-redis failover client 发现主节点；所有 I/O/连接池预算继续生效，TLS 最低为 1.2。Example 的生产 Sentinel 配置强制 TLS 及两套 ACL，CA 文件最大 1 MiB 且不削弱证书校验。

锁使用 `SET NX PX` 和 compare-and-delete 脚本；`REDIS_LOCK_TTL` 必须大于请求预算，等待和重试均有界。Redis 命令失败时 limiter/idempotency fail closed，外部模式启动失败时服务不监听。默认测试用两个独立 client 和两个 Fiber app 连接 `miniredis`，覆盖严格限流、同请求单次执行、冲突 409、TTL、后端停止和旧 owner 安全；这不算生产 Redis 证据。设置 `REDIS_TEST_URL` 可执行 opt-in 真实 Redis 集成测试，测试只清理唯一 key prefix，不 FlushDB。

`yarn redis:sentinel:contract` 在 Linux Docker 上使用固定 Redis 8.2.1 digest 启动一主一从和三个 Sentinel，以分离 ACL 触发显式 failover，并验证两个 client 的复制状态、重连、限流和锁。成功或失败都会归档环境、原始测试输出、容器日志、状态与 SHA-256。该 loopback 合约故意不启用 TLS，只证明仓库客户端与 Sentinel 的 ACL/failover 契约，不证明目标 Redis HA、TLS、eviction、网络分区、滚动升级、容量、告警、RPO 或 RTO。

幂等写请求会把 `X-Idempotency-Key` 绑定到 method、原始 target、认证 subject、规范化 Content-Type 和原始 body 的 SHA-256 指纹。相同 key 与相同指纹可回放缓存响应并设置 `X-Idempotency-Replayed: true`；相同 key 用于不同请求时返回禁缓存的 `409 Conflict`，且不会执行 handler 或覆盖旧响应。存储仅保留摘要，不保存原始凭据或请求体；生产多实例仍必须注入具备跨节点原子语义的实现。

`httpapi.Options.MaxInFlight` 为 `/api/v1` 提供非阻塞 admission control，默认值为 256。容量耗尽时请求快速返回 `503`、`Retry-After: 1` 和 `Cache-Control: no-store`，避免无界排队放大延迟；实例进入 draining 后，新业务请求同样快速返回 `503`，已有请求不被 gate 中断，顶层健康探针不经过该限制。生产应结合 Linux 压测、下游预算和实例资源调节 `HTTP_MAX_IN_FLIGHT`，它不替代跨实例限流或共享状态。

`HTTP_MAX_CONNECTIONS` 同时映射 Fiber app 配置和 Example 默认的 `server.HTTPOptions.MaxConnections`，默认值为 4096。标准 listener 达到上限后暂停 `Accept` 直至已有连接关闭，调用方必须设置连接 timeout，edge 应提供更早的容量拒绝；Fiber direct-listener 对照在相同边界返回 `503`。两种行为都发生在应用 middleware 前，不带 application admission 的 `Retry-After`。Example 向 `server.HTTPConnectionObserver` 注入共用 Metrics，公开无动态标签的连接容量、当前打开数和固定状态事件；observer panic 不改变请求或停机结果。真实 TCP 契约另行覆盖连接观察、请求头/请求体 `ReadTimeout`、慢读客户端触发 `WriteTimeout`、keep-alive 复用与空闲回收、半关闭响应，以及 shutdown 后连接归零。

`httpapi.Options.ReadBufferSize` 显式控制 Fiber 请求头读取预算，默认 16 KiB，配置范围为 4 KiB 至 1 MiB。超限请求由 transport 返回 `431 Request Header Fields Too Large`；生产应结合认证头、Cookie、代理注入头和目标 edge 配置共同设定，不应仅依赖默认值。

## API 生命周期

`/api/health`、`/api/health/ready` 和 `/api/health/startup` 是已弃用的兼容别名，分别迁移到 `/livez`、`/readyz` 和 `/startupz`。兼容路由在成功与错误响应都返回 `Deprecation: @1787184000`、`Sunset: Sat, 20 Feb 2027 00:00:00 GMT` 和带 `rel="successor-version"` 的 `Link`，并通过 CORS 暴露这些字段。标准探针不返回弃用头；完整窗口与消费者检查项见 `docs/openapi/health-endpoint-migration.md`。

## 可观测性

`httpapi.Options.TracerProvider` 可注入官方 OpenTelemetry `TracerProvider`。请求中间件创建 `SERVER` span，严格传播 W3C `traceparent`/`tracestate`，并只记录 method、route template 和 status 等有界属性；raw URL、请求体、token、任意错误文本和用户输入不会写入 span attribute。未注入 provider 时仍生成不导出的本地 span，以保持 trace/log 关联契约。

服务器资产、数据分类、信任边界、STRIDE 威胁、自动证据和生产残余风险统一维护在 `docs/security/server-threat-model.md`；该模型明确排除 MSFront，也不把本地门禁当作目标 edge、正式身份、共享状态或密钥平台已经部署。

登录成功/失败/限流、Bearer 缺失/无效以及 metrics/pprof 授权成功/拒绝会写入 `security_audit` 结构化事件，并以 request/trace/span ID 关联请求。事件不记录提交的用户名、密码、token、Authorization、body、raw URL、客户端 IP 或任意错误文本；只有登录成功可记录已验证的稳定 subject。`goexample_security_events_total` 只公开固定 event/outcome 矩阵，未知输入折叠为 `_OTHER`。可通过 `httpapi.Options.SecurityAuditSink` 注入外部交付适配器；低敏 `SecurityAuditRecord` 使用默认 100ms context 预算，sink 错误、超时或 panic 不改变请求结果，只进入固定 `success/failure` 指标。该接口不等于不可篡改存储、SIEM、留存或 paging 已部署，完整字段、告警处置和生产边界见 `docs/security/server-audit-events.md`。

`httpapi.NewHashChainAuditSink` 提供仓库内可复核的 SHA-256 链式 JSON 适配器，`VerifyHashChain` 可校验序列、前链摘要、记录白名单、未知字段和篡改。`httpapi.NewEncryptedAuditWriter` 可置于其 writer 边界，以 AES-256-GCM、随机 96-bit nonce 和显式 key ID 加密每条记录；`RotateKey` 不重置链，`VerifyEncryptedHashChain` 通过 keyring 支持轮换读取并拒绝未知 key、重复 nonce、格式错误和密文篡改。默认单行上限 16 KiB，写入串行且支持等待阶段的 context cancellation。密钥托管、访问控制、持久不可变存储、留存删除、SIEM/paging 和恢复仍由部署适配器负责。

`observability.NewTracerProvider` 默认关闭 exporter。启用 `otlp` 后使用 OTLP/HTTP protobuf、ParentBased ratio sampler 和官方 `BatchSpanProcessor`；每次 HTTP attempt、retry 初始/最大退避和最大 elapsed time 都从总 export timeout 派生，避免官方默认 5 秒首次退避超过项目 3 秒总预算而实际无法重试。自有 transport 对 connect、TLS、response header、总 attempt、连接池和响应头字节设置有限预算，TLS 下限为 1.2，并在 provider shutdown 时关闭 idle connections。前置的非阻塞容量门按 queue 加当前 batch 的上限精确接纳 span，queue、batch、schedule delay 与 export timeout 均有配置校验。HTTP 服务共用的 `Metrics` 同时实现标准 server 连接观察，`/metrics` 公开连接 capacity/open gauge、固定 `new/active/idle/hijacked/closed/_OTHER` 事件，以及 exporter enabled、固定 `success/failure` attempt/batch/span、queue-drop 和 processor pending/capacity/high-water；所有指标均不包含地址、连接 ID、endpoint、响应体、错误文本、凭据或动态标签。调用方必须在退出路径以固定 timeout 执行 `Shutdown`，刷新已排队 span。仓库行为测试使用真实标准 listener 和本地假 collector 验证连接收敛、observer panic 隔离、wire contract、慢 collector 不阻塞请求、shutdown flush、同一 batch 首次 503 后 retry 成功及持续 503 的最终失败；确定性 burst 测试还会阻塞 exporter，证明 100 个新 span 能快速结束，停滞时 pending/capacity/high-water 均为 5、96 个超量 span 被精确计数，恢复后 pending 回到 0。Redis、`database/sql` 与 broker-neutral queue instrumentation 已由同一 provider 注入并通过本地隐私契约；真实 collector、真实 PostgreSQL/queue/业务调用链、dashboard 与告警演练仍属于部署工作。

## 关系数据库

`sqlclient.New` 接管调用方创建的 `*sql.DB`，统一设置有限 operation/transaction timeout、最大 open/idle connections、connection lifetime 和 idle time；构造过程不执行 I/O，`Check` 可显式用于 startup/readiness。生产 package 的 driver 选择、DSN 解析和凭据读取仍归项目 composition root，`sqlclient` 运行时代码不导入或固定 PostgreSQL driver，也不会观察 DSN。仓库的 opt-in 集成测试单独固定 pgx，仅用于验证真实 PostgreSQL 契约。

`Client` 提供 `Check`、`Exec`、`ExecVersioned`、`Query`、`ScanRow`、`LockRow`、`Transaction`、`RetryTransaction`、`Stats` 和幂等 `Close`。`Transaction` 独占 commit/rollback，在 callback 错误、取消、超时或 panic 时回滚；`Tx` 提供相同的有界 exec/versioned update/query/scan/lock 操作。`Query` 在 consumer 返回或 panic 时都关闭 rows，调用方不得在 callback 外保留 rows。

```go
database, err := sql.Open("pgx", dsn)
if err != nil {
    return err
}
client, err := sqlclient.New(database, sqlclient.Config{TracerProvider: provider})
```

`RetryTransaction` 是显式 opt-in，只在错误链实现 `SQLState() string` 且状态为 `40001`（serialization failure）或 `40P01`（deadlock detected）时重试。默认最多 3 次、硬上限 10 次，使用有限指数抖动退避；所有 attempt 和退避共享同一个 `TransactionTimeout`，rollback 出现非 `sql.ErrTxDone` 错误时立即停止。callback 可能执行多次，必须可安全重放；外部副作用应自行幂等或使用 outbox，不能依赖该方法提供 exactly-once。

`ExecVersioned` 用于 caller-owned 乐观更新：SQL 必须在 `WHERE` 中比较预期版本，并在同一 UPDATE 中推进版本。恰好一行受影响才成功；零行统一返回 `ErrOptimisticConflict`，不额外查询并区分记录不存在或版本过期，避免 TOCTOU 和存在性泄漏；多行或 driver 不支持 `RowsAffected` 视为失败。它不解析 SQL；application handler 必须显式将该冲突映射为 `httpapi.ErrPreconditionFailed`，versioned command adapter 才会形成 HTTP `If-Match`/412/`ETag` 边界。

每个操作创建固定 `postgresql.check|exec|update|query|lock|transaction` 的 `CLIENT` span，只记录 `db.system.name=postgresql`、固定 operation 和固定 `success/conflict/not_found/canceled/timeout/failure` 结果。DSN、SQL、SQLSTATE、参数、行值和原始 driver error 不进入 span。仓库默认测试使用标准库假 driver 验证 pool、事务、versioned update 的零/一/多行结果、serialization/deadlock callback 与 commit 重试、尝试上限、共享 deadline、不安全 rollback 停止、超时、取消、`sql.ErrNoRows`、rows 清理、panic 回滚和隐私。

设置 `POSTGRES_TEST_URL` 后，固定 pgx v5.7.6 的 opt-in 测试会在真实 PostgreSQL 上制造 serializable 并发更新，证明 driver 的 `40001` 能触发安全重试；另一个测试让两个 `RetryTransaction` 分别锁住不同行再交叉请求，要求真实 `40P01` victim 自动重试、两个事务最终提交且两行结果一致；versioned update 测试让两个 writer 使用同一预期版本并发更新，要求恰好一个成功、一个返回 `ErrOptimisticConflict` 且版本只增加一次；HTTP 组合测试先通过 versioned GET 读取初始 ETag，再要求强 `If-Match` 更新返回新 ETag，过期 tag 经真实 `ExecVersioned` 映射为 412 且不能覆盖新值，并以 `If-None-Match` 验证当前版本得到保留 ETag 的空体 304；行锁测试持有真实 `FOR UPDATE`，验证 caller deadline 截断等待且释放后可恢复。测试只创建并清理进程唯一表，不删除 schema 或其他数据：

```powershell
$env:POSTGRES_TEST_URL = "postgres://user:password@127.0.0.1:5432/database?sslmode=disable"
go -C Framework test -v -count=1 -run '^TestRealPostgres' ./sqlclient
```

`yarn postgres:recovery:contract` 在 Linux Docker 上启动固定 digest 的 PostgreSQL 16，先执行上述真实 serialization/deadlock/versioned update/HTTP precondition/锁测试，再创建 1000 行确定性恢复点并生成 custom-format 逻辑备份。备份完成后源库追加一行，演练器将备份恢复到隔离数据库；独立报告器要求恢复库精确匹配恢复点且不包含备份后的写入，同时复核备份大小、SHA-256、PostgreSQL LSN 和两分钟总预算。`postgres-contract` CI job 始终归档原始输出、容器日志、备份、状态、报告、runner/commit 元数据、SHA-256 和 evidence manifest。

该演练只证明一次性单节点容器的逻辑备份/恢复契约。它不等于远端 job 已成功，也不证明目标 PostgreSQL 的物理备份、WAL 归档、PITR、复制/failover、目标数据量、RPO/RTO 或操作响应。

## 消息队列

`queueclient.New` 创建不绑定 broker SDK 的消息边界。`Config.System` 只接受 Kafka、NATS、RabbitMQ、AWS SQS 或 GCP Pub/Sub 的固定枚举；publish/process timeout、message body、header 总字节和 header 数量都有有限默认值。`Publish` 与 `Process` 都克隆 body/header，避免 instrumentation 或 callback 改写调用方输入；header 名称必须是可打印 ASCII，重复大小写键、CR/LF/NUL 和越界消息在 callback 前拒绝。调用方可用 `errors.Is` 区分 `ErrMessageTooLarge`、`ErrHeadersTooLarge` 和 `ErrInvalidHeader`。

```go
queue, err := queueclient.New(queueclient.Config{
    System:         queueclient.SystemKafka,
    TracerProvider: provider,
})
err = queue.Publish(ctx, message, func(ctx context.Context, message queueclient.Message) error {
    return kafkaAdapter.Publish(ctx, message)
})
```

发布创建固定 `messaging.send` `PRODUCER` span，并替换调用方提供的 trace header 后注入当前 W3C Trace Context；处理只从接收消息提取 `traceparent`/`tracestate`，不提取 baggage，再创建固定 `messaging.process` `CONSUMER` span。span 只记录固定 system、operation 和 `success/canceled/timeout/failure`，不记录 destination、body、header、message ID 或原始 backend error。`Client` 本身不拥有连接池或投递结算；具体 broker adapter 仍负责连接、持久化、顺序、去重及 exactly-once 能力。

`NewWorkerGroup` 在现有 `Client.Process` 边界之上提供有界 consumer worker 生命周期。`Workers` 默认为 1，最大为 64；`Start` 只能成功一次，父 context 取消或 `Shutdown` 会取消所有 receive/handler 调用，首个非取消错误或 panic 会取消其他 worker，`Wait` 返回首个失败。`WorkerConfig.Receive` 保持原 fail-fast 模式，确认、重试和死信完全由 adapter 负责。互斥的 `ReceiveDelivery` 模式要求每个 `Delivery` 携带私有 `Acknowledge`/`DeadLetter` callback；启用动态 lease extension 时还必须提供私有 `ExtendLease` callback。Framework 对 handler 执行默认最多 3 次、硬上限 10 次的有限指数退避，成功后确认，耗尽、消息非法或 handler 返回 `ErrDeliveryNotRetryable` 时写死信。每次 handler 调用都会重新克隆消息，业务副作用必须可重放或自行幂等。

ack/DLQ callback 使用独立有限 `SettlementTimeout`；返回错误、超时或 panic 均折叠为 `ErrDeliverySettlement` 并停止整个 group，不暴露 backend 原文。handler 或退避期间取消不会开始确认或写死信；结算期间取消会取消 callback context，并按正常停机收敛，不记录结算成功或失败。默认零值不启用续租，此时 `Client.MinimumDeliveryLease` 仍使用实际 `ProcessTimeout`、全部 retry/backoff、一次结算和正安全余量计算静态下限。显式同时配置 `LeaseExtensionInterval`/`LeaseExtensionTimeout` 后，worker 在 handler 和 retry backoff 期间周期调用 `ExtendLease`，并在 ack/DLQ 前停止；错误、超时或 panic 折叠为 `ErrDeliveryLeaseExtension`，取消当前 handler、禁止结算并使 group fail closed。此时最小服务端 lease 为续租间隔、续租/结算两者较慢值及安全余量之和。Go 无法强制终止忽略 context 的 callback，因此所有预算都依赖 handler 和 callback 尊重 context；该模式仍不提供顺序、持久化、原子 settlement 或 exactly-once。

`WorkerConfig.Observer` 可选接收固定基数的 `WorkerStarted`、`WorkerStopped` 和 `WorkerFailed` 生命周期事件；`DeliveryObserver` 只接收 `acknowledged/retried/dead_lettered/settlement_failed` 四种固定结果，`DeliveryLeaseObserver` 只接收 `extended/failure`。observer 必须快速返回，panic 会被隔离且不改变 worker 结果。`Wait` 和成功的 `Shutdown` 只会在 `WorkerStopped` 完成后返回。将同一 `observability.Metrics` 注入三个 observer 后，`/metrics` 公开无标签 active gauge 和固定事件 counter，不包含 broker、destination、message、interval、attempt 或错误文本。

```go
workers, err := queueclient.NewWorkerGroup(queue, queueclient.WorkerConfig{
    Workers: 4,
    Receive: adapter.Receive,
    Handle: func(ctx context.Context, message queueclient.Message) error {
        return application.Process(ctx, message.Body)
    },
})
if err != nil {
    return err
}
if err := workers.Start(ctx); err != nil {
    return err
}
defer workers.Shutdown(shutdownContext)
```

可靠投递模式由 adapter 把 broker acknowledgement handle 封装在 callback 中：

```go
workers, err := queueclient.NewWorkerGroup(queue, queueclient.WorkerConfig{
    ReceiveDelivery: adapter.ReceiveDelivery,
    Handle: func(ctx context.Context, message queueclient.Message) error {
        return application.Process(ctx, message.Body)
    },
    Observer:         metrics,
    DeliveryObserver: metrics,
    LeaseObserver:    metrics,
    Retry: queueclient.DeliveryRetryConfig{
        MaxAttempts:           3,
        InitialBackoff:        100 * time.Millisecond,
        MaxBackoff:            2 * time.Second,
        SettlementTimeout:     3 * time.Second,
        LeaseExtensionInterval: 10 * time.Second,
        LeaseExtensionTimeout:  time.Second,
    },
})
```

`queueclient/natsjetstream` 将真实 JetStream SDK 隔离在 broker-neutral 核心之外。adapter 等待服务端 publish ack，以有限 pull 接收预先配置的 explicit-ack durable consumer，并把 `InProgress`、`DoubleAck` 和 DLQ publish 封装为 `ReceiveDelivery` callback；它不创建、修改或删除 stream/consumer。DLQ 必须先发布成功再确认源消息，源 stream/consumer/sequence 派生的 SHA-256 `Nats-Msg-Id` 只在目标 stream 的 duplicate window 内降低结算重试导致的重复；DLQ publish 与源 ack 不是原子事务。JetStream publish 控制头不会进入应用或从应用转发，多值 NATS header 会 fail closed，SDK 错误折叠为固定 sentinel。

Worker 启动前必须调用 `natsjetstream.PreflightConsumer`。该 preflight 通过服务端新鲜 `ConsumerInfo` 要求 explicit ack，并验证实际 `AckWait`；若配置了覆盖 `AckWait` 的 JetStream `BackOff`，则每个 interval 都必须不小于 `MinimumDeliveryLease`。静态模式覆盖完整处理路径；续租模式覆盖首次/相邻续租、续租 callback 以及停止续租后的最终结算窗口。短 lease 返回固定 `ErrAckWaitTooShort`，读取或配置异常返回不含 SDK 原文的固定错误。调用方仍须自行配置 `MaxDeliver`、容量、retention、duplicate window、权限和监控；续租只在显式配置时启用，也不提供 exactly-once。

```go
retry := queueclient.DeliveryRetryConfig{
    MaxAttempts:           3,
    InitialBackoff:        100 * time.Millisecond,
    MaxBackoff:            2 * time.Second,
    SettlementTimeout:     3 * time.Second,
    LeaseExtensionInterval: 10 * time.Second,
    LeaseExtensionTimeout:  time.Second,
}
requiredLease, err := natsjetstream.PreflightConsumer(
    startupContext, sourceConsumer, queue, retry, time.Second,
)
```

设置 `NATS_TEST_URL` 后，`go test -v -count=1 -run '^TestRealNATS' ./queueclient/...` 会同时执行 Core NATS trace 合约和运行中 JetStream 合约；后者使用单节点 file-backed stream，先证明短 `AckWait` 被拒绝，再把服务端 consumer 更新为足额 lease，通过 preflight 后验证未确认消息 `NumDelivered >= 2`、WorkerGroup confirmed ack、永久错误进入 DLQ、body/header/去重 ID 及源 consumer pending 归零。合约随后将 `AckWait` 设为 800ms，以 100ms interval/50ms timeout 执行 `InProgress`，要求 1.5 秒 handler 仍只交付一次、confirmed ack 成功、续租失败为零且 pending 归零。

设置 `NATS_SERVER_BINARY` 后，独立的重启合约会在隔离端口启动真实 server，写入 3 条消息并留下第 1 条未确认，然后强制终止进程并以同一 file store 重启。门禁要求 stream 保留 3 条消息、相同 stream sequence/body/header 再次交付，随后将短 lease 更新为足额值并通过服务端 preflight，才启动 WorkerGroup 完成 confirmed ack、永久错误 DLQ 和源 pending 归零；可选 `NATS_RESTART_EVIDENCE_DIR` 会保存重启前后日志与 `restart-report.json`，报告记录短 lease 拒绝、最小预算和实际 worker `AckWait`。本机固定 NATS 2.14.5 已连续 10 次通过，新增校准路径也已通过本机实跑。实测 `NumDelivered` 在强制重启后从 1 重新报告为 1，因此它不能作为跨重启累计计数，恢复判断必须同时使用 stream sequence 和业务幂等边界。CI 从固定 digest 容器复制同一 NATS binary，显式启用 `-js -sd /data`，并始终归档 raw/status、主 server log/inspect、两阶段重启日志、结构化报告、binary hash、cleanup 和 SHA-256。Core NATS 不提供持久化 ack/retry/DLQ；该单节点本地恢复也不等于远端 job 已成功、目标 broker 已部署、目标延迟安全余量已校准或生产端到端链路已经完成。

同一 binary 还启用独立的 file-stream 快照恢复合约。测试先确认 sequence 1、保留 sequence 2 未确认及 sequence 3 pending，以 `jsck` 校验消息并将 durable consumer 纳入快照；随后写入恢复点后的 sequence 4、删除原 stream，再通过 JetStream 分块 request/reply 协议恢复。恢复后的 stream 必须精确回到 3 条消息，排除恢复点后写入，consumer 必须保留 `ack pending=1/messages pending=1`，sequence 2 同序重投后确认，sequence 3 再完成 DLQ，最终 pending 归零。`NATS_SNAPSHOT_EVIDENCE_DIR` 保存原始 snapshot、server log 和严格报告；本地 verifier 重新校验 archive 大小/SHA-256、篡改拒绝和 15 秒恢复预算。该单节点逻辑快照不等于磁盘损坏恢复、跨主机备份、目标容量、生产权限、原子 settlement 或 RPO/RTO。

同一 `NATS_SERVER_BINARY` 还启用三节点连续 leader failover 与 quorum 恢复合约：三个 server 使用独立 file store、client/route 端口，source/DLQ stream 和两个 durable consumer 均显式设置 3 副本。控制连接先确定实际 source stream leader；独立业务连接只以该 leader 为初始地址，并要求通过集群 INFO 发现其余两个节点。测试留下首条消息未确认后终止业务连接所在的 leader，必须观察 disconnect/reconnect callback、连接状态恢复且 server identity 切换到存活节点，同时不关闭或替换原 `*nats.Conn`、JetStream、stream/consumer handle 和 adapter。新 leader 必须不同，相同 sequence/body/header 必须以 `NumDelivered >= 2` 重投；原 adapter 随后在线更新 consumer lease 并通过 preflight，再完成故障后同步 publish、两次 WorkerGroup confirmed ack、一次永久错误 DLQ 及 source pending 归零。测试随后以原 file store/端口重启首个失效节点，要求两个 stream 和两个 consumer 全部恢复 3 个 current replicas；留下第 5 条消息未确认后，再终止第一次选出的新 leader，同一会话必须完成第二次不同 leader 选举、sequence 5 的重投、再次 lease preflight，以及第 6 条消息的发布和确认。第二个失效节点不恢复，测试留下 sequence 7 未确认并终止当前 leader，形成两个节点同时离线的重叠窗口；业务连接仍须连接唯一 Core 节点，JetStream publish 则必须在 3 秒内返回固定失败。随后恢复保存 sequence 7 的节点以重建 quorum，同一会话完成 sequence 7 重投、再次 lease preflight、第 8 条消息 publish/ack；最后恢复另一节点，两个 stream 和两个 consumer 必须全部回到 3 个 current replicas。完整恢复后再留下 sequence 9 未确认，由同一 release channel 屏障同步释放实际 leader 与另一副本的停止 goroutine，停止启动偏差不得超过 250ms；原连接必须落到唯一 survivor，JetStream 再次有界拒绝无 quorum 写入。只恢复原 leader 后，同一连接/handle/adapter 完成 sequence 9 重投、lease preflight 与 sequence 10 publish/ack，最后恢复另一副本并要求全部资源追平。`NATS_CLUSTER_EVIDENCE_DIR` 保存三份追加式 server 日志和 schema v5 `cluster-failover-report.json`，manifest/verifier 强制校验顺序及并发停止身份、偏差预算、两个 quorum 拒绝窗口、sequence 7/9 恢复、最终 10 条消息、三副本追平及八次日志启动标记；CI 将该目录一并归档。schema v4 阶段本机固定 NATS 2.14.5 已连续 10 次通过；schema v5 重复运行捕获并修复初始业务 handle 的短暂 metadata 404，修复后连续 3 次共 140.891 秒通过。该本地进程级并发故障不替代远端成功 job、目标 broker、网络分区/磁盘损坏、基础设施同时故障、生产身份与权限、目标延迟下安全余量、原子 DLQ/source settlement、顺序、exactly-once 或 RPO/RTO 证据。

schema v6 在该恢复链末尾增加三个可控 TCP route proxy。sequence 11 未确认且四个资源均为 3 个 current replicas 时，测试确保 stream leader 不在原业务连接节点，再同步禁用三个 proxy、关闭全部活动 route；三个 NATS 进程/Core 端口和原业务连接必须保持可用，而 JetStream publish 在 3 秒内失败。route 恢复后先要求 source 仍精确为 11 条，排除客户端超时请求迟到提交，再用原连接/handle/adapter 完成 sequence 11 重投、lease preflight、sequence 12 publish/ack、pending 归零和三副本追平。报告、manifest/verifier 与 Node 守卫强制验证 route 数量、节点身份分离、三个 Core 探针、同会话和最终 12 条消息；修复首轮孤立 leader 提案歧义后，本机固定 NATS 2.14.5 连续 3 次通过。该 loopback route 分区不替代目标 broker、跨主机/跨区网络设备、生产身份权限、磁盘损坏或基础设施级分区证据。

## 出站 HTTP

`httpclient.New` 构造基于标准库 `net/http` 的可复用客户端。默认总请求、连接、TLS handshake、响应头、`Expect: 100-continue` 和 idle connection 均有有限 timeout；全局 idle、每主机 idle/总连接与响应头字节也有上限，并启用 HTTP/2 与 TLS 1.2 下限。负值、不一致的连接池和低于 TLS 1.2 的配置会在启动阶段返回错误。私有 CA/mTLS 可通过 `TLSConfig` 注入，Framework 会克隆顶层配置后应用最低版本；调用方不得在 `New` 返回后修改其引用的证书池等共享对象。自定义代理选择可通过 `Proxy` 注入。

```go
client, err := httpclient.New(httpclient.Config{TracerProvider: provider})
```

每次传输创建 `CLIENT` span 并传播 W3C Trace Context，只记录规范化 method、status 和有界错误类别，非标准 method 统一记为 `_OTHER`；不记录 raw URL/query、body、credentials、header 或任意 transport 错误文本。span 在 response body 读完或关闭后结束，从而覆盖响应体读取耗时和错误。transport 克隆请求 header 后注入传播字段，不改写调用方请求；调用方仍必须关闭每个非 nil response body。当前仓库没有真实业务出站消费者，因此该包只计为已验证 Framework 能力，不代表 collector 或端到端调用链已经闭环。

## 生命周期

`server.RunHTTP` 接受标准 `http.Handler`、监听地址、health checker、logger、accepted connection/read-header/read/write/idle/header 上限、可选 `HTTPConnectionObserver` 和 shutdown 预算。收到取消信号后先设置 draining，再等待可选传播延迟；标准 server shutdown 与可选 application shutdown hook 共享一个总预算，超时后强制关闭连接以保证返回。连接 observer 只接收容量和固定 `net/http` 状态，panic 被隔离。Example 默认使用该路径。原 `server.Run` Fiber listener API 保留兼容。

`httpapi.NewHTTPHandler` 提供标准 `net/http.Handler` 组合边界。它用每请求随机 128-bit、一次性、仅进程内可解析的令牌跨越 Fiber 官方 adaptor；令牌在第一个 Framework middleware 中删除，原始 `http.Request.Context()` 本身不会序列化到 header、日志或响应。caller 的较短 deadline、取消和 middleware context value 会进入 application context，真实标准 TCP 客户端断开也会取消协作式 handler；原生 Fiber listener 不经过该桥，仍依赖有限 `RequestTimeout`。Example 另把原 `*fiber.App` 的 `ShutdownWithContext` 作为 `HTTPOptions.ApplicationShutdown` 注入，使 Framework pre-shutdown hook 与标准 server 关闭共享预算并取消所有正在运行的 application work。

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
