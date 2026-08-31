# Project OpenAPI contracts

`contracts/projects.json` is the mapping between a managed Go service under
`Solutions/<name>` or `Services/<name>` and
the OpenAPI document that defines its public API. The mapping is intentionally
outside the managed service directories and `SDK/`, so one workspace can build several services without
making their contracts implicit.

Each entry contains:

```json
{
  "projectPath": "Solutions/Example",
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
  "projectPath": "Services/Billing",
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

Repository-local SDK release readiness adds a separately verified evidence layer:

```powershell
yarn sdk:release:prepare
yarn sdk:release:verify
yarn sdk:release:evidence
yarn sdk:release:evidence:verify
```

The evidence runner executes the generated-SDK drift and release-manifest checks for
both registered projects, then writes five checksum-bound files under
`.temp/workflow-artifacts/sdk-release-readiness`. The report binds the current
repository commit, each release manifest's source commit, the 26 Example and 14
Billing operations, OpenAPI/client/`go.mod` hashes, documentation versions, raw
output, process status, and `publication: not_checked`. The independent verifier
requires the exact artifact set before the aggregate evidence manifest can include
it. This is repository-local readiness evidence only: it does not query, create, or
verify Git tags, publish packages, exercise external consumer version matrices, or
prove target deployment migration.

Repository-local SDK consumer migration readiness is checked separately:

```powershell
yarn sdk:consumer:evidence
yarn sdk:consumer:evidence:verify
```

This runner executes the HealthProbe deprecated `/api/health/ready` to canonical
`/readyz` migration contract and the Billing generated-SDK contract through the real
Framework HTTP handler, including all 14 public operations. It writes exactly five
checksum-bound files under `.temp/workflow-artifacts/sdk-consumer-migration` and
binds the current source hashes, Go/Node runtime, raw output, status, and explicit
local-only limitations. The evidence does not establish an external consumer
cross-version matrix, a formal SDK tag or package publication, a deprecation window,
target deployment migration, production ownership, or remote provenance.

The machine-readable `contracts/sdk-consumer-matrix.json` keeps the repository-local
consumer/version map and the 184-day compatibility sunset window synchronized with
both release manifests. Run the strict cross-check before publishing a contract or
SDK change:

```powershell
yarn sdk:matrix:check
```

This gate rejects version, path, duplicate-consumer, and shortened-window drift. Its
`not_checked` and `not_recorded` release fields are deliberate: the check does not
claim formal tag publication, external consumer execution, deprecation-window
execution, or target deployment migration.

The matrix check also has an independently verifiable repository evidence chain:

```powershell
yarn sdk:matrix:evidence
yarn sdk:matrix:evidence:verify
```

The runner and verifier require exactly five checksum-bound artifacts under
`.temp/workflow-artifacts/sdk-consumer-matrix`. They bind the matrix contract,
source inputs, current commit, runtime fingerprint, raw command output, process
status, and the explicit local-only limitations. This evidence proves that the
repository matrix gate was executed and verified; it does not establish formal
SDK tags, package publication, external consumer execution, a deprecation-window
run, target deployment migration, or remote provenance.

The current `Solutions/Example` entry intentionally uses the workspace document. The
existing `support/api-contracts` submodule contains the NestJS/RNExample contract and
has no demonstrated `Solutions/Example` route mapping, so it is not silently reused
for Example. Once the owning OpenAPI repository and document path are confirmed,
add a new manifest entry (and the corresponding SDK module) rather than adding
one submodule checkout per service.

Git submodules are a poor fit for this mapping: a checkout has one working-tree
ref, while projects need independent refs from the same source repository;
submodule updates also make CI and SDK generation depend on mutable working-tree
state. A manifest plus pinned commit and a disposable materialization cache keeps
the source relationship explicit, reproducible, and easy to review. `go.work`
continues to list only local Go modules; external consumers use the generated SDK
module and its release tag.
