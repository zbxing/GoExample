# Project OpenAPI contracts

`contracts/projects.json` is the mapping between a `Proj/<name>` Go service and
the OpenAPI document that defines its public API. The mapping is intentionally
outside `Proj/` and `SDK/`, so one workspace can build several services without
making their contracts implicit.

Each entry contains:

```json
{
  "projectPath": "Proj/Example",
  "contract": {
    "repository": "workspace",
    "ref": "worktree",
    "document": "docs/openapi/openapi.json"
  },
  "sdk": {
    "path": "SDK/GoExample",
    "package": "goexample"
  }
}
```

For a contract in a separate repository, use an exact branch or tag ref and pin
the commit resolved from that ref:

```json
{
  "projectPath": "Proj/Billing",
  "contract": {
    "repository": "https://github.com/example/openapi-contracts.git",
    "ref": "refs/tags/billing-v2.3.0",
    "resolvedCommit": "0123456789abcdef0123456789abcdef01234567",
    "document": "openapi/billing.json"
  },
  "sdk": {
    "path": "SDK/Billing",
    "package": "billing"
  }
}
```

Production releases should use `refs/tags/*`. A `refs/heads/*` entry is useful
for development previews, but the manifest still records the commit used by a
build. `yarn contracts:resolve --project Billing` checks that the remote ref
still points to the pinned commit. Updating a moving branch is therefore an
explicit reviewable manifest change.

The repository does not import a remote contract at runtime. Materialization is
performed by `scripts/project-contracts.mjs` into
`.temp/contracts/<project>/<commit>/...`; the resolver uses a local bare Git
cache and `git show`, with no shell interpolation. The normal checks remain
offline and use an already materialized commit:

```powershell
yarn contracts:check
yarn contracts:materialize --project Billing --fetch
yarn sdk:check --project Billing
yarn openapi:compat --project Billing --base-ref <git-sha>
```

The current `Proj/Example` entry intentionally uses the workspace document. The
existing `support/api-contracts` submodule contains the NestJS/RNExample contract and
has no demonstrated `Proj/Example` route mapping, so it is not silently reused
for Example. Once the owning OpenAPI repository and document path are confirmed,
add a new manifest entry (and the corresponding SDK module) rather than adding
one submodule checkout per project.

Git submodules are a poor fit for this mapping: a checkout has one working-tree
ref, while projects need independent refs from the same source repository;
submodule updates also make CI and SDK generation depend on mutable working-tree
state. A manifest plus pinned commit and a disposable materialization cache keeps
the source relationship explicit, reproducible, and easy to review. `go.work`
continues to list only local Go modules; external consumers use the generated SDK
module and its release tag.
