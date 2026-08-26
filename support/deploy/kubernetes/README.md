# GoExample API Kubernetes 基线

该目录提供 V12-08 的仓库内编排契约。模板固定多副本、滚动更新、探针、资源、安全上下文、拓扑分散、PDB、HPA 和入站 NetworkPolicy，但不会伪造镜像摘要、Secret、Ingress/edge 或集群运行结果。

## 生成部署清单

1. 使用 `Solutions/Example/Dockerfile` 构建并推送镜像，取得 registry 返回的不可变 digest。
2. 选择精确的生产 HTTPS Origin，不使用通配符、路径、query 或 fragment。
3. 渲染清单：

```powershell
yarn kubernetes:render `
  --image ghcr.io/owner/goexample-api@sha256:<64-hex-digest> `
  --allowed-origin https://console.example.com `
  --oidc-issuer https://identity.example.com/tenant `
  --oidc-audience goexample-api `
  --oidc-jwks-url https://identity.example.com/tenant/.well-known/jwks.json
```

产物写入 `.temp/deployment/kubernetes/goexample-api.json`。渲染器拒绝 tag-only 镜像、非 HTTPS Origin、不安全的 OIDC issuer/JWKS URL、空 audience、仓库外模板和 `.temp/deployment` 之外的输出路径。`yarn kubernetes:check` 只校验受版本控制的模板，不生成部署证据。

## 外部依赖

在目标 namespace 中通过 External Secrets、Sealed Secrets 或等价 secret manager 创建 `goexample-api-runtime`，至少提供：

- `REDIS_URL`：目标 TLS/ACL Redis 地址；
- `METRICS_TOKEN`：独立且至少 32 字符；

不要把 Secret 明文或创建命令输出提交到仓库。模板关闭 demo auth 并启用 OIDC/JWKS Bearer 验证，因此不需要未使用的 `JWT_SECRET`；`OIDC_ISSUER`、`OIDC_AUDIENCE` 和 `OIDC_JWKS_URL` 是环境专属的公开标识，不应放入 Secret。模板使用 `SHARED_STATE_MODE=external` 且禁止内存 fallback；Redis 初始化或启动 PING 失败时进程 fail fast，运行期故障会使 `/readyz` 返回不可用。

允许流量进入的 ingress/controller 或观测 namespace 必须带标签 `goexample.io/ingress-access=true`。同 namespace pod 也可访问端口 3001。基线只约束 ingress；Redis、DNS、OIDC JWKS 和 OTel 的 egress 取决于目标网络，必须在部署 overlay 中按实际 CIDR、namespace 或 FQDN-aware policy 收紧。应用会在监听前同步拉取 JWKS，因而目标 namespace 必须能解析身份提供方 DNS、建立可信 HTTPS/TLS 连接并访问精确 JWKS endpoint；代理、私有 CA 和证书轮换需由目标平台单独验证。

## 部署与回滚

先执行目标 API server dry-run，再应用并观察状态：

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
