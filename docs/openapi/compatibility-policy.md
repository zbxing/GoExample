# OpenAPI 兼容性政策

`docs/openapi/openapi.json` 是 Example API 的公开契约。版本 `1.x` 内默认保持向后兼容；PR 会把当前文档与目标分支的同一文件进行结构化比较。

## 自动阻断

以下变化会由 `yarn openapi:compat --base-ref <git-ref>` 失败阻断：

- 删除既有 path、HTTP method、response status、参数、请求/响应 media type 或 schema property；
- 修改既有 `operationId`，增加必填参数或请求属性，将可选 request body 改为必填；
- 收紧认证要求、请求 enum/type/长度/数值范围，或让响应超出旧客户端声明的 enum/type/范围；
- 改动 `oneOf`、`anyOf`、`allOf` 或 `not` 等无法自动证明兼容的组合 schema。

比较器解析本地 `$ref`，但不访问网络或外部 schema。新增可选参数、可选请求属性、响应属性、operation 或 response status 可以通过门禁。

## 有意破坏兼容性

确需破坏兼容时，不得删除或放宽门禁。应引入新的 API major version，保留旧版本迁移窗口，并在移除前完成：

1. 在 OpenAPI 将旧 operation 标记为 `deprecated: true`。
2. 运行时返回 `Deprecation`，并在确定日期后返回 `Sunset` 与迁移文档 `Link`。
3. 记录消费者、SDK 版本、迁移负责人和至少 90 天兼容窗口。
4. 在新旧版本并行期间执行契约和回归测试；确认消费者完成迁移后再删除旧版本。

当前 `/api/health`、`/api/health/ready` 和 `/api/health/startup` 已进入 184 天迁移窗口：OpenAPI 标记 `deprecated: true`，运行时在成功和错误响应返回 `Deprecation`、`Sunset` 与 successor `Link`，迁移映射见 `health-endpoint-migration.md`。仓库仍未生成 SDK、建立消费者矩阵或执行真实消费者迁移演练，因此 V11-08 仍只能标记为部分完成。
