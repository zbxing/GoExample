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
| `observability` | 具备日志级别快路径和固定属性缓冲的 `slog` 请求日志、HTTP/Go runtime metrics、OpenTelemetry span 与有界 OTLP/HTTP exporter |
| `queueclient` | broker-neutral 有界 publish/process callback、consumer worker 生命周期、W3C 传播和低敏消息 span |
| `queueclient/natsjetstream` | NATS JetStream 同步 publish ack、full-payload pull delivery、confirmed ack 与 publish-before-ack DLQ adapter |
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

Custom transport-neutral routes can additionally assign `ApplicationRoutes`; handlers receive a defensive request snapshot and return bounded status/headers/body responses. SSE use cases can assign `ApplicationEventStreams` with `NewEventStream` (or its authenticated/authorized variants); each source receives only `context.Context` and a bounded `Last-Event-ID`.

旧式 `ApplicationQuery` handler 只接收 `context.Context`；`NewQuery`/`NewJSONCommand` handler 额外接收编译期确定的 request，authenticated/authorized 版本再接收只包含 subject、username 和 role IDs 的 `ApplicationPrincipal`，token/JWT/Fiber claims 不越过 adapter；authorized 版本声明任一满足（any-of）的精确角色 ID 集合。`ApplicationRoute` handler 接收带 caller deadline、断连和应用 shutdown 的 `context.Context` 与防御性 method/path、query、headers、body 快照，响应状态、headers、body 受固定上限约束。`ApplicationEventStream`/`NewEventStream`、`NewAuthenticatedEventStream` 与 `NewAuthorizedEventStream` 提供固定 GET 的 transport-neutral SSE source，source 只接收带 caller deadline、断连和应用 shutdown 的 `context.Context` 与受限 `Last-Event-ID`；Framework 复用既有有界 SSE 编码、心跳、超时和取消生命周期。自定义 route/事件流路径必须是 canonical static path，不能与默认路由、GET/HEAD query、command 或其它 descriptor 重叠；descriptor 不能与 `RegisterRoutes` 混用。Framework 内部 Fiber adapter 负责显式输入源绑定、结构校验、认证/授权、JSON media type、幂等请求指纹、`{code,data,msg}` envelope、错误脱敏和既有 middleware。未覆盖的 HTTP method 或定制 middleware 仍可使用高级 `RegisterRoutes` 逃生口；application query/command/route/event stream 不能与该逃生口同时配置。`NewHTTPHandler` 可将组装后的 app 暴露为标准 `net/http.Handler`，Example 默认再由 `server.RunHTTP` 承担标准 listener 生命周期；该标准入口会把 caller deadline、取消和 context value 传入 application context，原生 Fiber listener 仍保留 fasthttp 的断连语义。`httpapi.RegisterDefaultRoutes` 提供认证可选的 echo/validate/delay 路由；本地 `/auth/login` 只有 demo `Auth` 启用时才注册，注入外部 `TokenVerifier` 只注册 Bearer 路由。

typed query request 的每个导出字段必须显式且只能声明一个 `uri`、`query` 或 `header` tag，URI tags 必须与路径中的 `:name` 一一对应；各来源先绑定到隔离的临时值再复制目标字段，query/header 无法覆盖 URI。动态 query 只允许命名参数，通配符、转义、反斜杠、控制字符、重复分隔符、相对段、query/fragment、重复参数及静态/动态重叠都会在启动前失败。旧式 query 与 command 仍要求规范静态路径；同 method 路径和默认 GET/POST 路由碰撞按大小写不敏感及动态匹配语义判断。所有定义会在注册任何 application route 前完成校验，避免 Fiber 注册顺序导致 handler 静默不可达。

authorized query/command 的角色声明会在构造时复制，并在启动时拒绝空列表、重复值、非法 ID 或超过 32 个角色；角色 ID 按大小写敏感的精确值比较。认证通过但没有任何声明角色时，在输入来源/media type/body bind、幂等锁和 application handler 前返回固定 403 与禁缓存响应，并只写入不含 subject、角色、claims、路径或凭据的低敏拒绝审计。受保护 command 的幂等指纹在 Bearer 验证后计算，因此使用已验证 subject 而不是匿名主体。

需要 tenant/resource 级策略时，使用 `NewResourceAuthorizedQuery`、`NewResourceAuthorizedVersionedQuery`、`NewResourceAuthorizedJSONCommand` 或 `NewResourceAuthorizedVersionedJSONCommand`。resolver 只接收 typed request 和最小 `ApplicationPrincipal`，输出 `authorization.Resource`；Framework 会验证 subject、角色、tenant、resource type/ID、action 和最多 16 个有界 attribute，再以默认 100ms、最大 1s 的 `ResourceAuthorizationTimeout` 调用 `authorization.Authorizer`。query 顺序为 Bearer -> role -> bind/validation -> resource policy -> handler；resource command 为 Bearer -> role -> media type -> bind/validation -> resource policy -> precondition/idempotency -> handler，因此拒绝不会创建幂等状态或 application span。deny、非法 decision、backend error、timeout 和 panic 均折叠为固定禁缓存 403，不暴露 tenant/resource/backend 细节；非法 resource 固定为 400。策略实现必须遵守 context，部署仍需提供真实的关系/属性数据、缓存失效、跨副本一致性和策略变更审计。

versioned query handler 返回数据与未加引号的资源 tag；Framework 使用与写侧相同的受限格式验证 tag，并输出强 `ETag` 与禁缓存头。GET/HEAD 的 `If-None-Match` 按 HTTP 弱比较处理，支持强/弱标签、列表和通配符；匹配当前版本时返回保留 ETag 的空体 304，未匹配时返回正常 envelope。认证和角色授权仍先于参数绑定与 handler，非法响应 tag 折叠为固定 500 且不会泄漏 tag 或应用数据。该条件读取逻辑只位于 versioned query adapter，不会把 versioned PATCH 等写响应错误转换为 304。

versioned command 在认证与授权之后、media type/幂等/body bind 之前要求精确一个受限强 `If-Match`：缺失返回 428，弱标签、通配符、列表、未加引号或非法 token 返回固定 400。handler 接收去引号的 `ApplicationPrecondition.EntityTag`，成功时返回新的去引号 tag；Framework 输出强 `ETag` 和禁缓存响应。应用将 `sqlclient.ErrOptimisticConflict` 等持久化冲突映射为 `ErrPreconditionFailed` 后得到固定 412。versioned command 的幂等指纹额外绑定 `If-Match`，同 key/同 tag 可回放并保留 ETag，同 key/不同 tag 固定冲突，普通 command 的既有指纹不变。应用仍须在自己的 OpenAPI 中声明 `If-Match`、`ETag`、400/412/428。

## Bearer 验证

`auth.TokenVerifier` 将 HTTP Bearer 验证与 demo 密码登录/HS256 签发解耦。`httpapi.Options.TokenVerifier` 显式注入时优先于 demo `Auth`；外部 verifier 可启用 `/auth/me`、private 和 authenticated/authorized application routes，但不会暴露必然失败的本地 `/auth/login`。所有验证失败在 HTTP 边界折叠为固定 `ErrInvalidToken`/401，不记录上游 URL、响应、token、claims 或原始错误。

`auth.NewJWKSVerifier` 在构造时同步获取 JWKS，并仅接受 RS256、2048 至 8192 位 RSA key、固定 issuer/audience、必需 `exp`/`nbf`/`iat`/`jti` 与现有有界身份/角色 claims。token 最大 16 KiB；JWKS 响应最大 1 MiB、最多 100 keys，HTTP timeout、刷新周期和 token 最大 age 均有硬上限。缓存到期刷新失败时 fail closed；未知 `kid` 的刷新至少间隔 5 秒，并通过互斥刷新合并并发 miss。`VerifyIDToken` 复用同一签名/JWKS 边界，额外要求非空 subject、匹配授权请求 nonce、有效 `auth_time`/`iat` 年龄，以及多 audience 时匹配的 `azp`。新增的 `VerifyIDTokenWithAccessToken` 在保持旧方法兼容的前提下，若 ID token 声明可选 `at_hash`，会把实际 access token 绑定到 RS256 对应的 SHA-256 左半摘要；缺失 claim 兼容，声明后的空值、错误类型、非规范编码或 mismatch fail closed。可选 `RequiredACR`/`RequiredAMR`/`MaxAuthAge` 策略会要求精确 `acr`、全部指定 `amr` 和存在且新鲜的 `auth_time`；claim 数量、长度、重复与格式均有界，失败统一返回私有 invalid-token。零值保持原行为。调用方仍必须在 composition root 校验生产 HTTPS endpoint、DNS/egress、代理和 CA 策略。
上述 verifier 是资源服务器基础，所有生产身份接入仍必须由 composition root 显式配置和审计。

`auth.NewOIDCClient` 提供有界 OIDC discovery/token exchange：它在构造时获取并验证 `/.well-known/openid-configuration`，只接受 `code` 与 `S256` 能力、非空 authorization/token/JWKS endpoint、精确 issuer 和 JSON 响应；discovery 与 token exchange 均禁止重定向，响应分别限制为 64 KiB，HTTP timeout 不超过 10 秒。客户端认证在 discovery 时固定：配置 secret 的 confidential client 只使用 `client_secret_basic`，并在 provider 省略 `token_endpoint_auth_methods_supported` 时采用 OIDC 默认值；无 secret 的 public client 必须看到 provider 显式声明 `none`。显式不兼容、null、空、错误类型或过量方法列表均 fail closed，且不会回退到 `client_secret_post`、JWT 或 mTLS。`ExchangeCode` 只接受 `AuthorizationCode` 返回的 code/verifier/nonce；Basic client ID/secret 按 RFC 6749 Appendix B 编码并只进入 Authorization，form 不重复 client ID 且永不包含 secret；public client 不发送 Authorization，只在 form 提交 client ID。两种方式都提交固定 authorization_code、redirect URI 和 PKCE verifier，并验证 Bearer、access token、ID token、expires_in、refresh token 和 scope 边界。callback composition 应将返回的 ID token、access token 和 `AuthorizationCode.Nonce` 一起交给 `VerifyIDTokenWithAccessToken`；loopback HTTP 只用于测试，生产必须使用 HTTPS、受信 CA/egress 和目标 IdP。

在 discovery 和 token response 解码前，OIDC client 还递归扫描有界 JSON，拒绝 exact、转义后以及大小写折叠后的重复 object key；malformed JSON 和多个顶层值同样 fail closed。这样避免 Go `encoding/json` 的后值覆盖安全字段，同时保留正常单 key JSON 与未知字段兼容。scanner 只运行在一次 discovery 和一次 token exchange 的 64 KiB body 上，不进入普通 API 热路径。

OIDC discovery/token exchange 与 JWKS 初始化、刷新和 cached token verification 还统一执行 caller context 完成态检查：入口已取消或已到单调 deadline 时不访问 provider、不解析 token；transport/body 返回的迟到有效响应会关闭并折叠为既有固定 sentinel，迟到 JWKS 不会替换共享 key cache。并发 JWKS refresh 仍最多一个访问 provider，但等待者可按自己的 cancellation 退出，不再被另一个调用方的完整 HTTP timeout 阻塞。live context 检查保持零分配，也不增加网络往返、后台 goroutine 或刷新 timer。取消无法撤销 IdP 已收到的 code/token 请求，因此超时仍是未知结果，不能作为无条件重试 authorization code 的依据。

`auth.CompleteOIDCCallback` 将 callback state 一次性消费、token exchange 和 nonce/`at_hash`-bound `VerifyIDTokenWithAccessToken` 组合为一个 transport-neutral 操作；state 即使在 exchange 或 claims 验证失败后也不会再次接受，provider 错误只返回固定 sentinel，不暴露响应内容。`httpapi.NewOIDCBrowser` 再提供条件注册的浏览器 start/callback：start 将 state 的 SHA-256 绑定值写入 `__Host-`、Secure、HttpOnly、SameSite=Lax cookie，callback 先一次性消费 state，再以 constant-time 比较 cookie，并完成 exchange、ID-token nonce/`at_hash` 与 access-token subject 一致性校验。显式 assurance policy 还会让 authorization request 发送同一 `acr_values` 提示，并在 callback 强制验证而不信任提示本身。`NewOIDCBrowserWithSessions` 在成功 callback 后额外建立不透明应用 session，固定 204 不返回 provider token；session 使用 Secure/HttpOnly/SameSite=Lax `__Host-` cookie，写请求还必须把独立 Strict `__Host-` CSRF cookie 回显到 `X-CSRF-Token`，两层均 constant-time 校验。logout 原子撤销后清除两枚 cookie。session-enabled composition 还条件注册清单、subject 绑定的单会话撤销和整用户撤销 HTTP API；Bearer 或 browser session 均可调用，cookie 认证的 DELETE 继续强制 CSRF。callback/session/CSRF 凭据不进入 body、日志或 span；该边界仍不提供设备名称/指纹或管理 UI，也不替代目标 IdP、真实 MFA enrollment/challenge 或生产身份部署。

`auth.NewSessionManager` 提供 transport-neutral 的本地 refresh session 基础：`SessionConfig` 约束 refresh/absolute TTL 和 family 数量，`Start`/`Rotate` 只向调用者返回原始 token，内部仅保存 SHA-256 token hash。rotation 保留旧 hash 以检测重放并撤销整个 family；每个 family 的历史 hash 还有固定上限，避免长寿命 family 无限增长；`RevokeFamily`、`RevokeUser` 和 `ActiveFamilies` 覆盖 family/user 级撤销与查询，所有状态访问均有互斥保护，绝对 TTL 到期会清理状态。该 manager 是有界的单进程内存组件，不替代跨副本共享存储或生产密钥托管。

`auth.NewBrowserSessionManager` 建立有界应用 session：配置 TTL 会被已验证 access token 的 `exp` 截断，claims 在存储前复制，原始 session/CSRF 凭据只返回一次并且只以 SHA-256 持久化，另签发可公开的随机 `SessionID`；安全方法可使用 HttpOnly session，非安全方法必须额外提交绑定 CSRF。全局上限之外，`MaxSessionsPerSubject` 约束单个 subject，零值保持既有调用兼容。manager 的 `ListForSubject`、`RevokeForSubject` 和 `RevokeAllForSubject` 只接受可信 subject 边界，返回有界低敏清单，并防止跨 subject 撤销；无 Store 模式提供相同语义。可选 `BrowserSessionInventoryStore` 不扩大旧 `BrowserSessionStore` 的方法集合；Redis 实现使用 subject/SessionID SHA-256 索引和 Lua 原子执行跨副本全局/单用户限量、单会话/整用户撤销，后端故障不回退内存。HTTP adapter 只公开 `SessionID`、`CreatedAt`、`ExpiresAt`，非法、不存在和跨 subject 单项撤销统一 404，inventory 后端错误统一 503。双 client 与 HTTP 测试覆盖跨实例清单/撤销、Bearer/cookie、CSRF、跨 subject、并发单用户上限、到期、篡改与 outage；该能力仍不含设备元数据或管理 UI，也不代表目标 Redis HA/TLS/ACL 或身份平台已经部署。

V71 优化将 Redis inventory 的读取路径收敛为一次有界 Lua 快照：过期索引清理、最多 `limit` 个 token 选择和 payload 读取在 Redis 单线程命令内完成，消除 `ZRANGE + N*GET` 的往返与半份清单窗口。Go 端仍完整校验 payload、subject、expiry、`SessionID` 和 device metadata；本地命令数测试只证明仓库行为，不代表生产 Redis 延迟、吞吐、HA 或容量。

V72 优化将 Redis refresh-session rotation 与 family revoke 的 token 映射读取和状态变更分别收敛为单次有界 Lua 调用，消除 `GET + EVALSHA` 的额外往返与两命令状态窗口；旧 token 映射仍保留至 TTL 以检测 replay，malformed family 映射 fail closed。预热脚本缓存后的本地 telemetry 测试只证明各路径一个 `redis.evalsha`，不代表生产 Redis 延迟、吞吐、HA、容量或跨主机恢复。

V73 优化将 Redis browser-session 的 token revoke 与 subject-bound public-ID revoke 分别收敛为单次有界 Lua 调用。脚本在派生 key 前校验 owner/token/session-ID 的 SHA-256 hex 形状与双向索引一致性，再原子删除 payload、映射和 global/subject 索引；malformed、cross-subject 或篡改状态均 fail closed。预热后的本地 telemetry 测试只证明每条撤销路径一个 `redis.evalsha`，不代表生产 Redis 延迟、吞吐、HA、容量、eviction 或恢复。

V74 优化为 Redis browser-session 整 subject 撤销增加绝对 10,000 成员的前置 `ZCARD` 上限，并逐项校验 subject/token/session-ID 的小写 SHA-256 hex 形状及 metadata/ID 双向映射。全部成员验证通过后才在同一 Lua 调用内删除；第一段保存已验证 session-ID，使反向 mapping 读取替代第二段重复 metadata 读取。异常状态不会部分删除 active session，预热后的本地 telemetry 仍只证明一个 `redis.evalsha`，不代表生产容量、延迟、HA、TLS/ACL、eviction 或恢复。

V75 优化为 Redis refresh-session 的 user-wide revoke 与 active-family count 增加绝对 10,000 成员上限，并在派生 family key 前校验 32 字符小写 hex ID。两个 Lua 脚本先完整核对 family owner、时间/revoked 字段以及 active family 的 global/user 索引 score，再进入 cleanup、revoke 或 count 阶段；污染状态 fail closed 且不会留下部分修改。`CreateSession` 在访问 Redis 前维护相同的 ID 与上限边界。公开 API、配置和 Redis schema 不变；本地测试不代表生产 Redis 容量、延迟、HA、TLS/ACL、eviction 或恢复。

V76 优化为 Redis refresh-session 的单 family rotation 与 revoke 增加完整状态和双向索引验证。两个 Lua 脚本先核对 owner/current 的小写 SHA-256 hex、正整数时间及顺序、revoked/expired 状态关系、active family 的 global/user score，并在最多 1,024 个 used token 内验证 current/used 到 family 的反向 mapping；伪造 incoming mapping 或已占用的新 token mapping 均 fail closed，不会撤销或覆盖合法 family。`RotateSession`/`RevokeFamily` 在 Redis I/O 前拒绝 nil context、相同 old/new hash 与非法 history limit。正常路径仍各为一个 Lua；公开 API、配置和 Redis schema 不变，本地测试不代表生产 Redis 容量、延迟、HA、TLS/ACL、eviction 或恢复。

V77 优化为 Redis authorization-request 的 payload key 与全局 expiry zset 建立双对象完整性约束。create 在 expiry cleanup 前拒绝超过 10,000 的全局 index，并拒绝接管已有 orphan member；consume 在一个 Lua 命令内取得 payload 与 score、一次性删除目标两边，Go 只接受严格 payload expiry 与整数 score 完全一致的 state。缺失、错配或 malformed 的目标状态 fail closed 且不能重放，不影响其他 pending request。非法毫秒输入在 Redis I/O 前拒绝，正常 create/consume 仍各为一个 Lua；公开 API、配置与 key schema 不变，本地测试不代表生产 Redis 容量、延迟、HA、TLS/ACL、eviction 或恢复。

V78 优化把 Redis browser-session 的 payload、global/subject expiry index、token metadata 与 public-ID mapping 视为一个完整认证状态。create 在任何 cleanup 前拒绝超过 10,000 的 global/subject index，且不会用新 payload 接管目标 orphan member；read 在单次 Lua 中以有界长度和正 TTL 读取双向 mapping 与两个 score，Go 只接受严格 JSON、重新计算的 subject/session-ID hash 和完全相同的整数 expiry。异常目标 session fail closed 且不修改其他 session，预热后的 create/read 仍各为一个 `redis.evalsha`；公开 API、配置、payload 与 key schema 不变，本地测试不代表生产 Redis 容量、延迟、HA、TLS/ACL、eviction 或恢复。

V79 优化把同一五对象完整性约束扩展到 Redis browser-session inventory 与 device-name update。list 在 cleanup 前拒绝超过 10,000 的 subject index，并在单次 Lua 中为每个入选 member 核对有界 payload、三个正 TTL、双向 mapping 与两个 expiry score；Go 严格重算 subject/session-ID hash 并只接受与 payload 一致的整数 expiry。device update 改为完整只读快照 Lua 加全状态 CAS Lua，快照后 payload、mapping、index、score 或 TTL 丢失均不会覆盖状态；非法 direct-store 输入零 Redis I/O，预热正常路径固定为两个 `redis.evalsha`。公开 API、配置、payload 与 key schema 不变，本地命令数不代表生产 Redis 性能或可用性。

该 verifier、OIDC client、浏览器 callback adapter 和两类 session manager 是资源服务器、仓库内 discovery/token exchange、ID token assurance claims、会话清单与集中撤销基础，并已提供低敏自助 HTTP/OpenAPI/SDK 边界；但不执行 IdP 侧 MFA enrollment/challenge、设备命名/指纹、自助管理 UI、KMS/Vault 或目标身份提供方部署。仓库内 `httptest` discovery/token/JWKS/ID token、state-cookie/回调、CSRF、session 与双 Redis client 行为测试只证明本地协议行为；生产仍需目标 IdP、Redis HA/TLS/ACL、密钥轮换和故障演练证据。

`auth.SessionManager` 可通过 `SessionConfig.Store` 注入 `auth.SessionStore`。`sharedstate.Redis` 实现该契约：family 元数据、token hash 索引、用户索引和有限历史在 namespace 内保存；创建、rotation、family/user revoke 和 active-family 查询使用 Lua/有界 Redis 操作，rotation 在共享 Redis 上线性化，重放触发 family 撤销。Redis 错误不会回退到本地状态；manager 的无 Store 模式仍是有界单进程内存。双 client 的 `miniredis` 测试覆盖跨实例 rotation/reuse、集中 user revoke、family limit 和后端停止 fail-closed，但这不代表生产 Redis HA、Sentinel/Cluster、TLS/ACL、容量、RPO/RTO 或已部署的会话撤销平台。

`auth.NewAuthorizationRequestManager` 提供仓库内 OIDC Authorization Code + PKCE 请求契约：它为每次跳转生成随机 `state`、`nonce` 和 code verifier，构造固定 `response_type=code`、`code_challenge_method=S256` 的 HTTPS 授权 URL，并以有界 TTL/待处理数量保存 hash-keyed 状态。可选且有界的 `ACRValues` 会按 OIDC 标准写入 `acr_values`，但只作为 IdP 请求提示，最终信任仍由 ID-token assurance policy 决定。`StartContext`/`CompleteContext` 可通过 `AuthorizationRequestConfig.Store` 注入共享后端，原 `Start`/`Complete` 保持兼容；`sharedstate.Redis` 只以 state 的 SHA-256 建 key/index，保存恢复 token exchange 所需的有界 verifier/nonce payload，通过 Lua 原子执行全局数量门禁及一次性读取/删除。payload 与 expiry index 必须双边存在且具有相同毫秒 expiry，全局 index 在 cleanup 前受 10,000 绝对上限约束；双 manager/client 测试覆盖并发仅一次成功、过期、payload/index tamper、上限、raw state 不落 Redis 与 outage fail-closed。`ValidateAuthorizationNonce` 仍使用 constant-time 比较；这些本地契约不等于目标 IdP MFA、profile 映射或生产 Redis HA 已部署。

## 兼容治理

`VERSION`、`COMPATIBILITY.md`、`CHANGELOG.md` 和 `api-snapshot.json` 定义当前 `0.1.x` 公共兼容边界。`yarn api:compat` 要求工作 snapshot 与所有可导入生产包的导出 API 完全一致；PR 还会对 target branch snapshot 执行新增允许、删除/改签名拒绝的比较。pre-1.0 破坏性变更必须提升 minor，稳定版本必须提升 major，并同步 changelog 与迁移说明。公共 API 有意变更后使用 `yarn api:snapshot` 更新基线。

`httpapi.Options` 支持注入 Fiber `Storage` 与幂等 `Locker`。`sharedstate.NewRedis` 使用 go-redis 提供带前缀的 Storage、启动/就绪 `PING`、有限 I/O 和连接池、owner-token Lua 解锁及 Lua 固定窗口限流。`RedisConfig.TracerProvider` 为连接、命令和 pipeline 创建低敏 `CLIENT` span，只记录固定 operation/result、Redis system 和上限为 1000 的 batch size；不记录 URL/host、key/prefix、value、owner token、命令参数、caller 路径或任意错误文本。统一 hook 在底层返回 nil 后复核 caller cancellation 与单调 deadline：迟到 connection 会在进入 pool 前关闭，迟到 command/pipeline nil 会返回原 context error 并使用既有 canceled/timeout 分类；显式 backend error 保持权威。该边界不能撤销 Redis 已接受的命令，写入 timeout 代表结果未知，不能作为无条件重试许可。`httpapi.ValidateSharedState` 在 `external` 模式除 Storage/Locker 外还要求原子 limiter，避免 Fiber 进程内 mutex 包裹普通 Redis 读改写造成双实例同时放行。limiter、认证 limiter、锁、请求指纹和各幂等路由使用隔离命名空间；Reset 只删除当前配置前缀，不执行全库 flush。

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

`Client` 提供 `Check`、`Exec`、`ExecVersioned`、`Query`、`ScanRow`、`LockRow`、`Transaction`、`RetryTransaction`、`Stats` 和幂等 `Close`。`Transaction` 独占 commit/rollback，在 callback 错误、取消、超时或 panic 时回滚；`Tx` 提供相同的有界 exec/versioned update/query/scan/lock 操作，并额外提供只能在当前事务内使用的 `EnqueueOutbox`。普通操作只在 driver 返回 nil 后复核 operation context：截止后的迟到 nil 不会记录为成功，`QueryContext` 迟到返回的 rows 会关闭且不会进入 consumer；显式 driver/consumer/rows 错误保持原有权威。`Query` 在 consumer 返回或 panic 时都关闭 rows，调用方不得在 callback 外保留 rows。该边界不能撤销已经由非事务 driver 执行的 SQL；timeout 代表结果未知，调用方必须通过幂等键、乐观版本、事务/outbox 或业务查证决定是否重试。

```go
database, err := sql.Open("pgx", dsn)
if err != nil {
    return err
}
client, err := sqlclient.New(database, sqlclient.Config{TracerProvider: provider})
```

`RetryTransaction` 是显式 opt-in，只在错误链实现 `SQLState() string` 且状态为 `40001`（serialization failure）或 `40P01`（deadlock detected）时重试。默认最多 3 次、硬上限 10 次，使用有限指数抖动退避；所有 attempt 和退避共享同一个 `TransactionTimeout`，rollback 出现非 `sql.ErrTxDone` 错误时立即停止。callback 可能执行多次，必须可安全重放；外部副作用不能依赖该方法提供 exactly-once。

`Tx.EnqueueOutbox` 执行调用方拥有的 outbox INSERT，并且只在 `RowsAffected() == 1` 时成功。nil result、受影响行数不可用、零行或多行都返回可由 `errors.Is(err, sqlclient.ErrOutboxEnqueue)` 识别的错误，使拥有该 callback 的 `Transaction`/`RetryTransaction` 回滚业务更新。该方法故意不出现在 `Client`：脱离业务事务单独写 outbox 不能满足原子提交目标。调用方仍拥有表结构、SQL、序列化、稳定唯一 event ID、dispatcher、清理、分区、积压监控和消费者幂等；Framework 不解析 SQL，也不提供 broker 原子 settlement 或 exactly-once。真实 PostgreSQL serialization 合同会先在待回滚 attempt 写入 event，再触发冲突，要求 retry 后业务值正确且稳定 event ID 最终恰好一行；重复 event 的 `ON CONFLICT DO NOTHING` 零行和一次插入多行也必须使同事务业务更新回滚。

`ExecVersioned` 用于 caller-owned 乐观更新：SQL 必须在 `WHERE` 中比较预期版本，并在同一 UPDATE 中推进版本。恰好一行受影响才成功；零行统一返回 `ErrOptimisticConflict`，不额外查询并区分记录不存在或版本过期，避免 TOCTOU 和存在性泄漏；多行或 driver 不支持 `RowsAffected` 视为失败。它不解析 SQL；application handler 必须显式将该冲突映射为 `httpapi.ErrPreconditionFailed`，versioned command adapter 才会形成 HTTP `If-Match`/412/`ETag` 边界。

每个操作创建固定 `postgresql.check|exec|update|outbox|query|lock|transaction` 的 `CLIENT` span，只记录 `db.system.name=postgresql`、固定 operation 和固定 `success/conflict/not_found/canceled/timeout/failure` 结果。DSN、SQL、SQLSTATE、参数、payload、event ID、行值和原始 driver error 不进入 span。仓库默认测试使用标准库假 driver 验证 pool、事务、versioned update 的零/一/多行结果、outbox 的 nil/未知/零/多行失败关闭、serialization/deadlock callback 与 commit 重试、尝试上限、共享 deadline、不安全 rollback 停止、driver 内取消后的迟到 nil/rows、consumer 零调用、资源清理、超时、取消、`sql.ErrNoRows`、panic 回滚和隐私。

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

发布创建固定 `messaging.send` `PRODUCER` span，并替换调用方提供的 trace header 后注入当前 W3C Trace Context；处理只从接收消息提取 `traceparent`/`tracestate`，不提取 baggage，再创建固定 `messaging.process` `CONSUMER` span。publish/process 的有限 operation context 在 callback 调用前和 nil 返回后都具有权威性：已观察到取消或到期时不进入 callback，callback 在 deadline 后返回 nil 也会得到原 context error，而不能形成成功 span。span 只记录固定 system、operation 和 `success/canceled/timeout/failure`，不记录 destination、body、header、message ID 或原始 backend error。`Client` 本身不拥有连接池或投递结算；具体 broker adapter 仍负责连接、持久化、顺序、去重及 exactly-once 能力。

`NewWorkerGroup` 在现有 `Client.Process` 边界之上提供有界 consumer worker 生命周期。`Workers` 默认为 1，最大为 64；`Start` 只能成功一次，父 context 取消或 `Shutdown` 会取消所有 receive/handler 调用，首个非取消错误或 panic 会取消其他 worker，`Wait` 返回首个失败。`WorkerConfig.Receive` 保持原 fail-fast 模式，确认、重试和死信完全由 adapter 负责。互斥的 `ReceiveDelivery` 模式要求每个 `Delivery` 携带私有 `Acknowledge`/`DeadLetter` callback；启用动态 lease extension 时还必须提供私有 `ExtendLease` callback。Framework 对 handler 执行默认最多 3 次、硬上限 10 次的有限指数退避；每次 retry 在基础等待之上增加 `[0, min(base/2, MaxBackoff-base)]` 的正向随机增量，以分散同步失败后的重入且不提前或突破 `MaxBackoff`。deadline 后才返回 nil 的 handler 不会触发 ack，而是按相同有限策略重试并在耗尽后写死信；正常成功后确认，消息非法或 handler 返回 `ErrDeliveryNotRetryable` 时也写死信。每次 handler 调用都会重新克隆消息，业务副作用必须可重放或自行幂等。

ack/DLQ callback 使用独立有限 `SettlementTimeout`；返回错误、超时、panic 或在 settlement child deadline 后观察到的迟到结果均折叠为 `ErrDeliverySettlement` 并停止整个 group，不暴露 backend 原文，也不记录 acknowledged/dead-lettered 成功。handler 或退避期间取消不会开始确认或写死信；结算期间 parent 取消会取消 callback context，并按正常停机收敛，不记录结算成功或失败。默认零值不启用续租，此时 `Client.MinimumDeliveryLease` 使用实际 `ProcessTimeout`、每次 retry 的最大 jitter 等待、一次结算和正安全余量计算静态下限，确保 preflight 不低估 runtime。显式同时配置 `LeaseExtensionInterval`/`LeaseExtensionTimeout` 后，worker 在 handler 和 retry backoff 期间周期调用 `ExtendLease`，并在 ack/DLQ 前停止；错误、超时、panic 或在 extension child deadline 后观察到的迟到结果折叠为 `ErrDeliveryLeaseExtension`，取消当前 handler、禁止结算并使 group fail closed。此时最小服务端 lease 仍为续租间隔、续租/结算两者较慢值及安全余量之和，不重复累加 retry waits。Go 无法强制终止忽略 context 的 callback，因此所有预算都依赖 handler 和 callback 尊重 context；该模式仍不提供顺序、持久化、原子 settlement 或 exactly-once。

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

`queueclient/natsjetstream` 将真实 JetStream SDK 隔离在 broker-neutral 核心之外。adapter 等待服务端 publish ack，以有限 pull 接收预先配置的 explicit-ack durable consumer，并把 `InProgress`、`DoubleAck` 和 DLQ publish 封装为 `ReceiveDelivery` callback；它不创建、修改或删除 stream/consumer。普通、显式去重、永久错误 DLQ 与畸形消息 quarantine 都只接受非空、带 stream 和非零 sequence 的 PubAck；DLQ ack 畸形时返回固定 `ErrDeadLetter` 且不确认源消息，有效 duplicate ack 则表示既有 DLQ 记录已由 broker 确认。源 stream/consumer/sequence 派生的 SHA-256 `Nats-Msg-Id` 只在目标 stream 的 duplicate window 内降低结算重试导致的重复；DLQ publish 与源 ack 不是原子事务。JetStream publish 控制头不会进入应用或从应用转发，多值 NATS header 会 fail closed，SDK 错误与 PubAck 内容均不进入错误文本或 telemetry。

需要处理 publish 结果不确定后的有限窗口重复提交时，调用方可通过 `PublishDeduplicated` 显式提供同一逻辑事件的稳定 ID。ID 必须是 1..256 bytes 的无空白可打印 ASCII，应用 `Message.Headers` 中的 `Nats-Msg-Id` 仍会先被过滤，再由 typed 参数写入，因而不能覆盖 broker 控制语义。普通与去重发布都要求非空、带 stream 和非零 sequence 的 PubAck；有效的 duplicate ack 表示服务器已经确认既有消息。ID 不会进入 span、日志或错误文本，adapter 不自动生成 ID 或 retry。

```go
err = queue.Publish(ctx, message, func(ctx context.Context, prepared queueclient.Message) error {
    return adapter.PublishDeduplicated(ctx, orderEventID, prepared)
})
```

去重范围只限于目标 stream 配置的 duplicate window。调用方必须在不确定结果重试时复用同一稳定 ID，并继续为业务副作用提供幂等边界；该方法不提供无限期去重、原子 outbox-to-broker、ordering 或 exactly-once。

Worker 启动前应调用 `adapter.PreflightConsumer`。该 adapter-bound preflight 只检查 adapter 实际持有的 consumer，并要求服务端报告 pull mode（`DeliverSubject == ""`）；带 delivery subject 的 push consumer 返回固定 `ErrConsumerNotPull`，因为 adapter 只实现 `Consumer.Next()` bounded pull，不会订阅 push subject、处理 queue group/flow control/heartbeat 或自动重建 consumer。它同时只接受 `PriorityPolicyNone` 且不配置 priority groups；pinned、overflow、prioritized、unknown 或 group-only consumer 返回固定 `ErrConsumerPriorityPolicy`，因为 adapter 的 `Next()` 不携带 priority group、pin、priority 或 pending threshold，也不会猜测调度配置。它还要求服务端恰好配置一个等于 adapter literal `Subject` 的 filter；空 filter、通配、错误 literal、多 filter 或同时使用两个 filter 字段均返回固定 `ErrConsumerSubjectMismatch`，避免 Worker 处理、确认或错误归档其他业务 subject。consumer 的 `MaxRequestExpires` 必须为 0（服务端不设 pull expiration 上限）或至少覆盖 adapter 的 `FetchMaxWait`；更短的非零上限返回固定 `ErrConsumerRequestExpires`，避免 Worker 启动后每次 bounded pull 都被 broker 拒绝。同一次新鲜 `ConsumerInfo` 还必须报告 `Paused=false`；活动暂停返回固定 `ErrConsumerPaused`，调用方只能在具备授权和审计的外部控制面显式恢复后重试，adapter 不会自动调用 `ResumeConsumer`。preflight 同时要求 explicit ack、非空 durable identity、file-backed consumer state、零 `InactiveThreshold`、`DeliverPolicy=DeliverAllPolicy`、`ReplayPolicy=ReplayInstantPolicy`、`HeadersOnly=false`，以及 `MaxDeliver=-1` 或至少 2 次投递；非持久状态、可能跳过已保留 backlog 的起点策略、按历史时间间隔拖慢 backlog 的 replay 策略、不足一次 broker redelivery 与系统性省略 payload 分别返回固定 `ErrConsumerNotPersistent`、`ErrConsumerDeliveryPolicy`、`ErrConsumerReplayPolicy`、`ErrMaxDeliverTooLow` 和 `ErrConsumerPayloadUnavailable`。`DeliverAllPolicy` 只保证从 stream 中最早仍保留的匹配消息开始，不恢复已被 retention 删除的历史；`ReplayInstantPolicy` 只移除 original replay 的历史间隔下限，不保证生产清空时长或无限吞吐；`HeadersOnly` 门禁不禁止合法的空业务消息，而是阻止 broker 对所有消息省略正文。preflight 继续验证实际 `AckWait`；若配置了覆盖 `AckWait` 的 JetStream `BackOff`，则每个 interval 都必须不小于 `MinimumDeliveryLease`。短 lease 返回固定 `ErrAckWaitTooShort`，读取或配置异常不含 SDK 原文。保留的包级 `natsjetstream.PreflightConsumer` 继续提供兼容的通用 consumer 可靠性、pull-mode 与默认 priority-policy 检查，但不知道 adapter subject 或 `FetchMaxWait`，不能单独证明 subject isolation 或 pull expiration 兼容性。调用方仍须自行配置 stream subjects、ACL、容量、retention、replicas、duplicate window、权限、consumer mode/pause/priority 治理、有限 `MaxDeliver` 耗尽处置、积压恢复和监控；续租只在显式配置时启用，也不提供 exactly-once。

同一次 preflight 还只接受逐消息 `AckExplicitPolicy`。AckAll、AckNone、FlowControl 或未知值返回固定 `ErrConsumerAckPolicy` 与已计算的 required lease；AckAll 对较高序列的确认可能隐式确认仍由其他 worker 处理的较低序列，而其余策略也无法实现 adapter 的逐消息 `Ack`/`Nak`/`Term` 合同。nil 或不可读取的 `ConsumerInfo` 仍返回通用 `ErrConsumerPreflight`。错误不暴露 policy、durable、subject、identity、URL 或 backend 原文，adapter 不自动迁移 consumer。

```go
retry := queueclient.DeliveryRetryConfig{
    MaxAttempts:           3,
    InitialBackoff:        100 * time.Millisecond,
    MaxBackoff:            2 * time.Second,
    SettlementTimeout:     3 * time.Second,
    LeaseExtensionInterval: 10 * time.Second,
    LeaseExtensionTimeout:  time.Second,
}
requiredLease, err := adapter.PreflightConsumer(startupContext, queue, retry, time.Second)
```

设置 `NATS_TEST_URL` 后，`go test -v -count=1 -run '^TestRealNATS' ./queueclient/...` 会同时执行 Core NATS trace 合约和运行中 JetStream 合约；后者使用单节点 file-backed stream 与 durable consumer，先创建其余可靠性条件全部合格的 push consumer，要求 adapter-bound preflight 返回 `ErrConsumerNotPull`，再由测试控制面显式删除并重建同名 pull consumer，完整 preflight 通过后才继续。测试随后把 disposable pull consumer 重建为 pinned priority policy，要求 preflight 返回 `ErrConsumerPriorityPolicy`，再显式删除并以默认 policy 重建；只有最终 policy 为 none 且 group 数为 0 时才继续。随后证明 `DeliverNewPolicy` 被拒绝，再删除 disposable consumer 并以 `DeliverAllPolicy + ReplayOriginalPolicy` 重建；original replay 被拒绝后，consumer 再重建为 `ReplayInstantPolicy`。随后证明 `MaxDeliver=1` 被拒绝，更新为 5 后证明 `HeadersOnly=true` 被拒绝，再更新为 full payload。adapter-bound preflight 接着拒绝覆盖整个 stream 的通配 filter，consumer 更新为唯一 exact subject；合约先写入一个异 subject，再写入目标消息，并要求 adapter 首次交付仍为目标消息。短 `AckWait` 仍被拒绝；更新为足额 lease 后，合约通过真实 `PauseConsumer` 进入活动暂停并要求 `ErrConsumerPaused`，显式 `ResumeConsumer` 后才允许 default-priority/DeliverAll/ReplayInstant/exact-subject preflight 通过。随后验证非空 body/header、未确认消息 `NumDelivered >= 2`、WorkerGroup confirmed ack、永久错误进入 DLQ、去重 ID 及源 consumer pending 归零。合约最后将 `AckWait` 设为 800ms，以 100ms interval/50ms timeout 执行 `InProgress`，要求 1.5 秒 handler 仍只交付一次、confirmed ack 成功、续租失败为零且 pending 归零。

真实 delivery 合同还会在默认 priority policy 重建后，将 disposable consumer 重建为 AckAll，要求 `ErrConsumerAckPolicy` 与正 required lease；测试控制面随后显式删除并以 Explicit Ack 重建，只有 ack policy 为 explicit 且完整 preflight 通过后才进入 delivery、retry、DLQ 与续租验证。schema-v13 evidence 固定这三个结果，但不据此宣称生产 acknowledgement 治理、原子 settlement 或 exactly-once。

`Adapter.ReceiveDelivery` 的每次 bounded pull 都创建继承调用方 context 且以 adapter `FetchMaxWait` 为上限的子 context，并只通过 nats.go `FetchContext` 发起请求；两种互斥的 fetch option 不会同时使用。因此已进入服务端等待的空 pull 可直接响应 worker/调用方取消，而内部单次 deadline、无消息和 timeout 仍进入下一轮。父 `context.Canceled`/`context.DeadlineExceeded` 原样返回，其他 SDK/backend 错误继续折叠为固定 `ErrReceive`，每轮子 context 在返回后立即释放。schema-v14 本地 delivery evidence 使用 5 秒 fetch 上限，先观察 server waiting pull，再要求父取消在 1 秒内返回；该结果不证明生产 shutdown SLO、服务端 waiting request 已立即清理、目标容量或 broker 治理。

V85 同时让 JetStream adapter 自身而不只是通用 `queueclient` 外层以 caller context 为结果权威边界。consumer preflight、publish、pull receive、lease extension、confirmed ack、DLQ 与非法消息 quarantine 都会在 broker callback 前后检查 cancellation 及已到达的单调 deadline；pre-completed 调用不发起 broker I/O，忽略 context 后迟到返回的有效 info、PubAck、message 或 nil acknowledgement 不形成 adapter success。DLQ/quarantine 的 publish ack 若迟到，adapter 不再继续源消息 `DoubleAck`；单次 pull 自身超时后迟到返回的消息仍视为空 pull。检查不增加公开 API、goroutine、timer、锁、网络往返或 broker command，live helper 保持零堆分配。context 无法撤销 broker 已接收的命令或强杀忽略 context 的 SDK 实现，因此 timeout 后的 broker 状态仍可能未知，调用方仍须使用稳定 dedupe ID 和业务幂等边界恢复。

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

`httpclient.LimitResponseBody` 为需要有界读取的调用点提供显式 opt-in 流式限制，不改变 `New` 的默认下载行为。已知超限的 `Content-Length` 会在读取前关闭并返回 `ErrResponseBodyTooLarge`；未知长度和 chunked 响应按流读取，只在超过边界的额外字节被观测到时关闭并返回同一错误。完整读到 EOF 后继续遵循标准 body close/keep-alive 复用契约，调用方提前关闭和 context 取消继续向服务端传播；超限响应不会为了连接复用而无界排空。该 helper 不缓冲完整响应，也不替代调用方按业务设置合理上限。

`httpclient.Config.Retry` 提供默认关闭的安全方法有限重试。启用时 `MaxAttempts` 包含首次请求且限制为 2–5 次，指数退避最大 5 秒；所有 attempt 共用原始 request context 和 caller/client deadline。仅 GET、HEAD、OPTIONS、TRACE 可重试，带 body 时必须有 `Request.GetBody`；POST、PUT、PATCH、DELETE 即使带幂等键也不会自动重放。无响应 transport 错误以及固定的 408/425/429/502/503/504 可触发重试；有效十进制秒数或 HTTP-date `Retry-After` 与本地指数退避取较大值，非法值则回退本地退避。每次实际重试在该有效等待上增加 `[0, min(delay/2, MaxBackoff-delay)]` 的正向随机抖动，因此既不早于本地退避或服务端提示，也不超过 `MaxBackoff`；抖动后的最终等待仍必须放入剩余 deadline，超预算时保留当前 response/body 并停止自动重试。确定继续重试时，仅对非负且不超过 32 KiB 的已知 `Content-Length` 中间响应最多读取声明长度加一字节后关闭，使守约的小型 HTTP/1.x body 到达 EOF 并保留连接复用机会；未知、大型或不守约响应仍有界关闭，最终响应从不被提前消费。W3C context 在一个逻辑 CLIENT span 内复用，URL、header、body、`Retry-After` 原文、随机值和 backend 错误原文不进入 span。该进程内去同步与连接复用保护不提供全局 retry budget、自适应并发、请求去重、写入 exactly-once 或目标环境恢复保证。

`httpclient.Config.CircuitBreaker` 提供默认关闭的 client 级 circuit breaker。启用时失败阈值为 1–100，open timeout 默认 30 秒且最大 5 分钟；breaker 位于 retry 外层，只按最终逻辑结果统计 transport error、nil response 与固定 408/425/429/500/502/503/504。open 请求不访问 transport 并返回 `ErrCircuitOpen`，timeout 后最多一个 half-open probe；generation 会忽略打开前请求的迟到结果。caller cancellation/deadline 与其它响应不计失败，`circuit_open` trace 分类不记录 URL、host 或错误原文。可选 `CircuitBreakerObserver` 同步接收只含 `State`/`Event` 的 `CircuitBreakerObservation`：状态固定为 `closed/open/half_open`，事件固定为 `opened/rejected/probe_started/probe_succeeded/probe_failed/probe_canceled`；不包含 URL、host、请求、响应或错误数据，回调必须快速返回且 panic 会被隔离。observer 只能在 breaker 启用时配置，并在状态锁外调用。该状态仅在单个 client 进程内有界保存；不同依赖应使用独立 client，它不替代跨副本协调或目标环境恢复证据。

V83 将 tracing、retry 和 circuit-breaker 的结果边界统一为 caller context 权威语义：调用下一层前已取消或已到单调 deadline 的请求会直接失败并关闭 request body；下一层在该边界后迟到返回的 response 会被关闭，nil error 会替换为原 context error，显式 transport error 则保持权威。非法 nil response/nil error 在最外层固定为私有失败和 `invalid_response` telemetry；retry 不会在完成后的 context 上继续采样 jitter 或发起 attempt，breaker 也不会把 cancellation/elapsed deadline 计为下游失败，执行中的 half-open probe 会保持 open 并报告固定 `probe_canceled`。这些检查不增加公开 API、配置、网络往返、timer、goroutine、锁或正常路径堆分配，也不能撤销下游已经接收的请求；timeout 仍代表结果未知，而不是无条件重试许可。

## 生命周期

`server.RunHTTP` 接受标准 `http.Handler`、监听地址、health checker、logger、accepted connection/read-header/read/write/idle/header 上限、可选 `HTTPConnectionObserver` 和 shutdown 预算。收到取消信号后先设置 draining，再等待可选传播延迟；标准 server shutdown 与可选 application shutdown hook 共享一个总预算，超时后强制关闭连接以保证返回。连接 observer 只接收容量和固定 `net/http` 状态，panic 被隔离。Example 默认使用该路径。原 `server.Run` Fiber listener API 保留兼容。

`httpapi.NewHTTPApplication` 是默认标准组合边界：返回的 `HTTPApplication` 直接实现 `net/http.Handler`，并以 `Shutdown(context.Context)` 封装同一个内部 Framework app 的 pre-shutdown 生命周期。Example 与 Billing 把该对象同时用于 `HTTPOptions.Handler` 和 `ApplicationShutdown`，因此生产启动代码不再持有 `*fiber.App`，也不会把 handler 与另一实例的 shutdown hook 错配。`New`、`NewHTTPHandler`、`RouteRegistrar`、Fiber response/SSE helpers、observability middleware 和 `server.Run` 继续作为源代码兼容的 Fiber 原生通道；完整决策与迁移边界见 ADR 0003。

底层 `httpapi.NewHTTPHandler` 继续提供标准 `net/http.Handler` 适配。它用每请求随机 128-bit、一次性、仅进程内可解析的令牌跨越 Fiber 官方 adaptor；令牌在第一个 Framework middleware 中删除，原始 `http.Request.Context()` 与 `http.ResponseController` 写期限能力本身不会序列化到 header、日志或响应。caller 的较短 deadline、取消和 middleware context value 会进入 application context，真实标准 TCP 客户端断开也会取消协作式 handler；原生 Fiber listener 不经过该桥，仍依赖有限 `RequestTimeout`。

`SendServerSentEvents` 与 `SendServerSentEventsFromSource` 使用同一 request lifecycle。`ServerSentEventOptions.StreamTimeout` 为零时继续由普通 `RequestTimeout` 和标准服务器原写期限限制；正值必须大于心跳且不超过 24 小时，会在 body stream 被认领时切换到独立有限预算，因此不需要放大其它 API 的请求超时。标准 adapter 同时通过 `http.ResponseController` 把传输写期限切到有效 stream deadline 加固定 1 秒协议收尾预算，避免 `server.RunHTTP.WriteTimeout` 在更早的绝对时间截断合法长流；提前完成时剩余收尾预算会收紧到 1 秒，不支持标准期限控制的 writer 保持兼容，其它控制器错误在写响应前失败。标准 caller 的更短 deadline、客户端断连和应用停机仍会提前取消 producer。多行 data 会先计算完整 wire 大小，再直接通过有界 writer 分帧，不再按行数构造切片和聚合字符串；默认/最大事件字节限制保持不变。原生 Fiber listener 不经过该标准期限桥；该契约不提供持久化 replay store，也不代替目标 edge 的 buffering、断连、容量和长稳验证。

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
