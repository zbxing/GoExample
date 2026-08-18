# MSFront 数据库

`migrations/` 是 MSFront PostgreSQL schema 的唯一迁移源。迁移文件一旦在数据库中登记，不得原地修改；需要变更时应追加更高序号的迁移。

从仓库根目录执行：

```powershell
yarn migrate:front --dry-run
yarn migrate:front
yarn migrate:front --status
```

runner 从 `MSFRONT_DATABASE_URL` 或 `DATABASE_URL` 读取连接地址，使用 PostgreSQL advisory lock 防止并发迁移，为每个文件计算 SHA-256，并在独立事务中执行。`--dry-run` 不连接数据库，只列出版本和 checksum。

初始迁移包含项目、用户、角色、会话、API Key 和审计事件表。生产上线前仍需要在目标 PostgreSQL 版本上执行迁移、并发写测试、备份和恢复演练；迁移文件通过本地静态验证不等于生产数据验证完成。

`yarn test:database` 会并发启动两个 runner，验证 advisory lock、重复执行、history、表清单、索引和大小写不敏感唯一约束。GitHub Actions 使用固定 OCI digest 的 PostgreSQL 16 service 运行该测试；本地未配置数据库时测试会报告跳过。
