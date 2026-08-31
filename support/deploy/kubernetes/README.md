# GoExample API Kubernetes 基线

该目录提供 V12-08 的仓库内编排契约。模板固定显式非系统 namespace、多副本、滚动更新、精确探针时序、有界 CPU/内存/临时存储资源、安全上下文、主机命名空间隔离、关闭 service-link 注入、双层拓扑分散、PDB、HPA 和双向 NetworkPolicy，但不会伪造镜像摘要、Secret、Ingress/edge 或集群运行结果。

PDB 使用 `unhealthyPodEvictionPolicy: AlwaysAllow`，避免不健康 Pod 在节点维护时占用可用预算并阻塞替换；该字段要求目标 API server 支持稳定的 `policy/v1` 语义。主机级 spread 使用 `DoNotSchedule`，zone spread 使用 `ScheduleAnyway`，在保持三副本可调度性的同时优先跨可用区分散。Pod 显式禁用 host network/PID/IPC/process namespace 和 Kubernetes service-link 环境变量注入。

Deployment 固定保留 5 个 revision、Pod 连续 ready 10 秒后才视为可用，并以 600 秒 progress deadline 阻断停滞 rollout。渲染器还会按键排序 ConfigMap `data`，将其规范 SHA-256 写入 Pod template 的 `goexample.io/config-sha256` 注解；任何环境配置变化都会改变 Pod template 并触发 Deployment rollout，缺失或伪造摘要会被拒绝。HPA 固定在 3 至 10 副本之间，以 CPU 70% 和内存 75% 为目标；扩容每 60 秒最多按 100% 或 2 Pod 中较大者执行，缩容使用 300 秒稳定窗口，并按 25% 或 1 Pod 中较小者限制每分钟下降幅度。渲染器会拒绝副本边界、资源目标或扩缩策略弱化。

startup/readiness/liveness 探针分别固定为 `2s/2s/30`、`5s/3s/2` 和 `10s/2s/3` 的 period/timeout/failure threshold，success threshold 均为 1。每个探针的完整对象必须精确匹配固定的 HTTP path、具名 `http` 端口、`HTTP` scheme 和时序，不允许额外 `host`、`httpHeaders`、`initialDelaySeconds`、单探针 `terminationGracePeriodSeconds` 或其他未经复核的字段。容器请求 `100m` CPU、`128Mi` 内存和 `64Mi` `ephemeral-storage`，上限为 `1000m`、`512Mi` 和 `256Mi`；Pod UID/GID/fsGroup 固定为 65532，容器还必须显式设置 `privileged: false`、`procMount: Default`、只读根文件系统及全部 capability drop。渲染器对三个探针的完整对象执行结构化深比较，防止探针目标或启动/失败窗口被静默改变；同时对 Pod 和容器的完整 `securityContext` 对象执行结构化深比较，拒绝额外 sysctl、容器身份覆盖、capability re-add 或其他未经复核的字段，防止资源或身份隔离被静默弱化。最终还会对完整 API 容器对象执行结构化深比较，只允许已校验的不可变镜像和固定的 `IfNotPresent` 拉取策略、端口、环境来源、探针、资源与安全上下文；`command`、`args`、`lifecycle`、交互式标准输入/TTY 及任何其他未复核字段都会被拒绝。

Pod template 的完整 `spec` 也必须精确匹配受检基线，只允许固定 ServiceAccount/token、service-link/host namespace 隔离、30 秒终止宽限、安全上下文、两条 topology spread 和单一 API 容器。渲染器拒绝额外 init/ephemeral container、volume/hostPath、`imagePullSecrets`、DNS/host alias、node selector/affinity/toleration、scheduler/runtime class、priority 及其他未经复核的 PodSpec 字段。环境 overlay 如确需存储、调度或私有 registry 配置，必须作为显式基线变更接受同等级测试与复核，不能静默注入。

完整 `PodTemplateSpec` 同样必须精确匹配受检基线：`metadata` 只允许固定 workload labels、`goexample.io/config-sha256` 和 `goexample.io/secret-revision` 两项 rollout annotation，`spec` 必须等于上述完整 PodSpec。渲染器拒绝 sidecar/agent 注入 annotation、finalizer、owner reference、额外标签或其他未经复核的 Pod template metadata；目标环境确需 admission 注入时，必须将该变化纳入显式 overlay、server-side dry-run 和同等级复核，不能由仓库基线静默开启。

API 容器端口列表必须精确且只包含具名 `http` 的 TCP 3001；Service 完整 `spec` 必须精确保持 `ClusterIP`、固定 workload selector，以及具名 `http` 的 TCP 80 到容器 `http` 端口映射。渲染器拒绝额外容器端口、TCP/UDP 协议漂移、`externalIPs`、headless/外部暴露设置或其他未经复核的 Service 字段，避免仓库基线静默增加管理端口、改变转发语义或扩大网络暴露。

API 容器只允许按固定顺序通过 `envFrom` 加载 `goexample-api-config` ConfigMap，再加载 `goexample-api-runtime` Secret；两个引用都必须显式使用 `optional: false`，不得设置 prefix、追加其他来源或定义 inline `env` 覆盖。ConfigMap 还必须精确包含以下 41 个已复核的非敏感环境键，缺少或增加任何键都会使检查失败：

`ALLOW_IN_MEMORY_SHARED_STATE`、`APP_ENV`、`APP_NAME`、`CORS_ALLOW_CREDENTIALS`、`CORS_ALLOW_ORIGINS`、`DEMO_AUTH_ENABLED`、`HEALTH_CACHE_TTL`、`HEALTH_CHECK_TIMEOUT`、`HTTP_HOST`、`HTTP_IDLE_TIMEOUT`、`HTTP_MAX_IN_FLIGHT`、`HTTP_PORT`、`HTTP_READ_TIMEOUT`、`HTTP_REQUEST_TIMEOUT`、`HTTP_WRITE_TIMEOUT`、`IDEMPOTENCY_ENABLED`、`IDEMPOTENCY_LIFETIME`、`LOG_FORMAT`、`LOG_LEVEL`、`LOG_SKIP_PATHS`、`OIDC_AUDIENCE`、`OIDC_AUTH_ENABLED`、`OIDC_ISSUER`、`OIDC_JWKS_HTTP_TIMEOUT`、`OIDC_JWKS_REFRESH_INTERVAL`、`OIDC_JWKS_URL`、`OIDC_MAX_TOKEN_AGE`、`OTEL_TRACES_EXPORTER`、`OTEL_TRACES_SAMPLER_ARG`、`PPROF_ENABLED`、`REDIS_KEY_PREFIX`、`REDIS_LOCK_RETRY_INTERVAL`、`REDIS_LOCK_TTL`、`REDIS_LOCK_WAIT_TIMEOUT`、`REDIS_MIN_IDLE_CONNECTIONS`、`REDIS_OPERATION_TIMEOUT`、`REDIS_POOL_SIZE`、`SHARED_STATE_MODE`、`SHUTDOWN_DRAIN_DELAY`、`SHUTDOWN_TIMEOUT`、`SYSTEM_INFO_DETAILED`。

其中只有 `CORS_ALLOW_ORIGINS`、`OIDC_ISSUER`、`OIDC_AUDIENCE` 和 `OIDC_JWKS_URL` 四项允许按目标环境动态渲染，并继续接受 HTTPS、安全字符和无凭据/query/fragment 的既有校验。其余 37 项必须精确保持模板中的生产基线值；例如 `HTTP_REQUEST_TIMEOUT=8s`、`SHUTDOWN_TIMEOUT=20s`、`REDIS_OPERATION_TIMEOUT=500ms`、`OIDC_MAX_TOKEN_AGE=15m`，任何固定值漂移都会使检查失败。

清单资源身份也必须精确等于已复核的 8 项集合：`v1/ConfigMap/goexample-api-config`、`v1/ServiceAccount/goexample-api`、`apps/v1/Deployment/goexample-api`、`v1/Service/goexample-api`、`policy/v1/PodDisruptionBudget/goexample-api`、`autoscaling/v2/HorizontalPodAutoscaler/goexample-api`、`networking.k8s.io/v1/NetworkPolicy/goexample-api-ingress` 和 `networking.k8s.io/v1/NetworkPolicy/goexample-api-egress`。任何缺失、重复、API 版本漂移或额外 namespaced 资源都会使检查失败，防止未经复核的 Role、RoleBinding、工作负载、配置或服务随基线清单进入部署流程。

Deployment selector、Pod template labels、Service selector、PDB selector 以及两条 topology spread selector 必须精确等于 `app.kubernetes.io/name=goexample-api` 与 `app.kubernetes.io/component=api`。Deployment、PDB 和 topology selector 对象只能包含这两个 `matchLabels`，不得增加 `matchExpressions`；所有标签映射也不得增加用于版本、环境或发布批次的额外键。环境 overlay 如需扩展 Pod 展示标签，应只增加不会参与这些 selector 的 metadata label；改变 selector 必须作为完整基线变更重新复核，避免 Service 流量、PDB 保护范围或拓扑分散对象被意外缩窄。

Kubernetes 对重复 key 使用后加载来源的值，因此 Secret 会覆盖 ConfigMap 的同名 key；目标配置应避免重复 key，使配置所有权保持明确。精确 ConfigMap 键、固定值、动态输入和环境来源校验不证明目标 ConfigMap/Secret 已创建、目标动态值正确、Secret 键清单正确、访问隔离、完成轮换或被 Pod 实际消费。

## 生成部署清单

1. 使用 `Solutions/Example/Dockerfile` 构建并推送镜像，取得 registry 返回的不可变 digest。
2. 选择精确的生产 HTTPS Origin，不使用通配符、路径、query 或 fragment。
3. 渲染清单：

```powershell
yarn kubernetes:render `
  --namespace goexample-production `
  --image ghcr.io/owner/goexample-api@sha256:<64-hex-digest> `
  --allowed-origin https://console.example.com `
  --oidc-issuer https://identity.example.com/tenant `
  --oidc-audience goexample-api `
  --oidc-jwks-url https://identity.example.com/tenant/.well-known/jwks.json `
  --secret-revision vault-version-2026-08-30-001
```

常规部署产物写入 `.temp/deployment/kubernetes/goexample-api.json`。`--namespace` 必须是 1–63 位小写 Kubernetes DNS label；渲染器拒绝 `default`、`kube-system`、`kube-public`、`kube-node-lease`，并要求 ConfigMap、ServiceAccount、Deployment、Service、PDB、HPA 和两份 NetworkPolicy 全部绑定同一显式 namespace，避免部署结果依赖当前 kubectl context。该基线不会创建 Namespace、ResourceQuota、LimitRange、RBAC 或 admission policy，目标平台仍须独立配置并验证这些控制。渲染器还拒绝 tag-only 镜像、非 HTTPS Origin、不安全的 OIDC issuer/JWKS URL、空 audience、仓库外模板，以及 `.temp/deployment` 和固定 Kubernetes 证据目录之外的输出路径。`yarn kubernetes:check` 只校验受版本控制的模板，不生成部署证据。

## 仓库内确定性证据

运行固定的渲染与复核链：

```powershell
yarn kubernetes:evidence
yarn kubernetes:evidence:verify
```

该命令使用固定非系统验证 namespace、全零伪镜像摘要、固定非敏感 Secret revision 和 `.invalid` 域名组成的非生产 fixture，将 `report.json`、两份原始命令输出和确定性渲染清单写入 `.temp/workflow-artifacts/kubernetes-manifest/`。schema v15 报告绑定渲染器、模板和本 runbook 的大小与 SHA-256、固定命令、Node 运行时、UTC 时间、退出码、精确八资源身份集合、完整 selector、安全上下文、容器端口、Service spec、三探针、完整 API 容器、完整 PodSpec 及完整 PodTemplateSpec 对象闭包和各项输出；独立 verifier 会重新渲染并拒绝 scope、命令、状态、文件哈希、额外资源、额外 selector/security context/port/Service/probe/container/PodSpec/PodTemplateSpec 字段或其他清单语义篡改。

这只证明当前仓库模板可按固定输入确定性渲染并通过本地语义门禁，不代表目标 Kubernetes API admission、server-side dry-run、rollout、HPA/PDB/NetworkPolicy 实效、节点或跨区驱逐和 rollback 已完成。固定 fixture 不能用于部署，且在签名的目标集群制品被归档并独立复核前，`kubernetesDrill` 与 V13-07 必须保持 `not_recorded`。

## 外部依赖

在目标 namespace 中通过 External Secrets、Sealed Secrets 或等价 secret manager 创建 `goexample-api-runtime`，至少提供：

- `REDIS_URL`：目标 TLS/ACL Redis 地址；
- `METRICS_TOKEN`：独立且至少 32 字符；

不要把 Secret 明文或创建命令输出提交到仓库。模板关闭 demo auth 并启用 OIDC/JWKS Bearer 验证，因此不需要未使用的 `JWT_SECRET`；`OIDC_ISSUER`、`OIDC_AUDIENCE` 和 `OIDC_JWKS_URL` 是环境专属的公开标识，不应放入 Secret。模板使用 `SHARED_STATE_MODE=external` 且禁止内存 fallback；Redis 初始化或启动 PING 失败时进程 fail fast，运行期故障会使 `/readyz` 返回不可用。

渲染必须通过 `--secret-revision` 提供 1–128 位安全的非敏感版本标识，例如 Vault/External Secrets 的不可变 provider version 或发布系统生成的 rotation ID。渲染器把它写入 `goexample.io/secret-revision`，因此每次 Secret 轮换都必须更换该值，Pod template 才会确定性触发 rollout。该过程不读取、散列或归档 Secret 内容，也不能验证 revision 是否真的对应目标 provider 版本；发布流程仍需归档 Secret 同步状态和 rollout 结果，不能把 revision 注解当作 Secret 已生效的证明。

允许流量进入的 ingress/controller 或观测 namespace 必须带标签 `goexample.io/ingress-access=true`。同 namespace pod 也可访问端口 3001。固定 `goexample-api-egress` policy 只允许发往带标准 `kubernetes.io/metadata.name=kube-system` 标签 namespace 的 UDP/TCP 53 DNS，以及任意目的地址的 TCP 443/6380，分别承载 OIDC/JWKS HTTPS 和常见 Redis TLS 连接；其他出站端口默认被拒绝。应用会在监听前同步拉取 JWKS，因而目标 namespace 必须能解析身份提供方 DNS、建立可信 HTTPS/TLS 连接并访问精确 JWKS endpoint。

标准 Kubernetes NetworkPolicy 不能按 FQDN 约束目的地址，端口也不证明应用层已经使用 TLS。目标环境必须把 `goexample-api-egress` 替换为按实际 CoreDNS namespace、OIDC/JWKS CIDR 或 CNI FQDN policy、Redis namespace/pod/CIDR 和真实 TLS 端口生成的 overlay；若 Redis 不使用 6380，同样必须替换该规则。NetworkPolicy 是可加和的，额外添加更窄的 policy 不能从本基线规则中减去已允许的流量。代理、私有 CA、证书轮换、CNI enforcement 和 DNS 拒绝行为需由目标平台单独验证。

## 部署与回滚

先执行目标 API server dry-run，再应用并观察状态；命令中的 namespace 必须与渲染时 `--namespace` 完全一致：

```powershell
kubectl apply --server-side --dry-run=server -n <namespace> -f .temp/deployment/kubernetes/goexample-api.json
kubectl apply --server-side -n <namespace> -f .temp/deployment/kubernetes/goexample-api.json
kubectl rollout status -n <namespace> deployment/goexample-api --timeout=10m
kubectl get -n <namespace> deployment,pod,pdb,hpa
```

失败时查看 revision 并回滚到已批准版本：

```powershell
kubectl rollout history -n <namespace> deployment/goexample-api
kubectl rollout undo -n <namespace> deployment/goexample-api --to-revision=<revision>
kubectl rollout status -n <namespace> deployment/goexample-api --timeout=10m
```

Service 为 `ClusterIP`，本基线不创建或配置 Ingress。目标 edge 的 TLS、HTTP/2/3、header/buffer/timeout/drain 契约仍属于 V12-01。

## 证据边界

模板与本地测试只能证明静态编排契约和渲染边界。没有目标集群的 server-side dry-run、rollout、HPA 扩缩、节点驱逐、PDB、NetworkPolicy、Redis HA、回滚、镜像签名或 provenance 原始制品时，不得将 V12-08 标为完成；生成的本地 manifest 也不是远端部署证明。
