# pmlint

> Lint package-manager policy across JavaScript, Ruby, and Python repositories.

`pmlint` is a CLI-first linter that checks whether dependency installation,
locking, update automation, version specifications, and package-manager
configuration are **deterministic and policy-compliant** across multiple
ecosystems.

It is **not** a vulnerability scanner. It does not replace `npm audit`,
Dependabot alerts, Snyk, Socket, or OSV. It lints the repository structure and
policy *around* dependency operations — statically, with no network access and
without installing anything.

## Supported ecosystems & managers

| Ecosystem  | Managers                          |
| ---------- | --------------------------------- |
| JavaScript | npm, pnpm, Yarn, Bun              |
| Ruby       | Bundler                           |
| Python     | pip, pip-tools, Poetry, uv        |
| Go         | Go modules                        |
| PHP        | Composer                          |
| Java       | Maven, Gradle                     |
| Rust       | Cargo                             |
| .NET       | NuGet                             |
| Dart       | pub (Dart / Flutter)              |

> Most ecosystems have first-class lockfiles (`go.sum`, `composer.lock`,
> `Cargo.lock`, `pubspec.lock`, …) so `lockfile/required` applies. Java and .NET
> have no universal lockfile (Maven has none; Gradle and NuGet locking are
> opt-in), so `lockfile/required` is skipped there — version-pinning rules still
> apply across all ecosystems.

## Install

```bash
npm install -g pmlint
# or run without installing
npx pmlint check .
```

## Usage

```bash
pmlint check .                  # lint the current repository
pmlint check ./packages/api     # lint a sub-path
pmlint check . --format json    # machine-readable output
pmlint check . --config pmlint.yml
pmlint explain .                # show detected surfaces, no pass/fail
pmlint init                     # write a starter pmlint.yml
pmlint scan ./a ./b             # scan many repos, aggregate one report
```

### Exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| `0`  | No errors (warnings alone do not fail by default). |
| `1`  | One or more lint errors.                           |
| `2`  | Invalid config, or an internal execution error.    |

Set `ci.failOnWarnings: true` to fail on warnings too.

## What it checks

- Missing or inconsistent lockfiles, and foreign/mixed lockfiles in one root.
- Package-manager declarations that disagree with lockfiles or config.
- Floating (`*`, `latest`), dist-tag, and unbounded (`>=1.0.0`) version specs.
- VCS dependencies without a pinned commit or tag.
- CI install commands that may mutate manifests/lockfiles (`npm install`,
  `pnpm install` without `--frozen-lockfile`, `uv sync` without `--locked`, …).
- Update commands running in CI that belong to Dependabot/Renovate.
- Missing Dependabot config, uncovered package roots, and ecosystem mismatches.
- Missing/short Dependabot `cooldown` (delays adopting freshly published versions;
  minimum `default-days` is configurable via `dependabot.minCooldownDays`, default 7).
- Plaintext registry tokens committed to the repo, and insecure registries.

## Autofix

`pmlint` can apply **safe, offline** remediations. It never touches the network,
so it only fixes things that are deterministic locally.

```bash
pmlint check . --fix-dry-run   # show the plan, write nothing
pmlint check . --fix           # apply fixes, then re-lint
pmlint check . --fix --fix-destructive  # also apply destructive fixes
```

Auto-fixable today:

- Rewrite mutating CI installs to frozen ones (`npm install` → `npm ci`, add
  `--frozen-lockfile` / `--immutable` / `--locked`).
- Generate `.github/dependabot.yml` covering detected roots and GitHub Actions
  (including a `cooldown` block).
- Add a `cooldown` (`default-days`) to existing Dependabot entries that lack one,
  preserving the rest of the YAML.
- Append a missing `updates` entry to an existing Dependabot config for a package
  root that isn't covered yet (structure-preserving).
- Switch a registry URL from `http://` to `https://`.
- Delete a foreign lockfile — **destructive**, requires `--fix-destructive`.

Not auto-fixable offline (reported only): pinning floating/unbounded versions
and generating requirement hashes both require resolving concrete versions from
a registry, which is out of scope for the static engine.

## Configuration

`pmlint` discovers `pmlint.yml`, `pmlint.yaml`, `.pmlint.yml`, or
`.pmlint.yaml`. Run `pmlint init` to generate one.

```yaml
extends:
  - recommended # recommended | app-strict | library-recommended

project:
  type: app # app | library | cli | monorepo

ecosystems:
  javascript: { enabled: true }
  ruby: { enabled: true }
  python: { enabled: true }

ci:
  failOnWarnings: false

rules:
  deps/no-floating-version: error
  dependabot/config-present: warn

ignore:
  - "**/fixtures/**"
```

Every rule severity is `off`, `warn`, or `error`. Policy shortcuts such as
`dependencies.forbidFloatingVersions` map onto the underlying rules; explicit
`rules:` overrides always win.

### Centralized / fleet auditing

For scanning many repositories against one **org policy** (e.g. a security team
auditing an entire GitHub/GitLab org), the policy lives **outside** the scanned
repos and is passed at runtime. It is authoritative — a scanned repo's own
`pmlint.yml` is never read, so a repo cannot weaken the policy applied to it.

```bash
# Apply a central policy to a checked-out repo (repo-local config is ignored):
pmlint check ./some-repo --config ./org-policy.yml

# Same, via env var (handy when an orchestrator scans many repos):
PMLINT_CONFIG=./org-policy.yml pmlint check ./some-repo --format json

# Use built-in defaults but ignore any repo-local pmlint.yml:
pmlint check ./some-repo --no-repo-config
```

Config source precedence (highest first): `--config` → `PMLINT_CONFIG` →
repo-local `pmlint.yml` (unless `--no-repo-config`) → built-in defaults.

### `pmlint scan` — many repos at once

`scan` runs the engine over multiple repositories and aggregates one report
(compliant / non-compliant / failed counts, plus a rule rollup across repos):

```bash
# Local checkouts:
pmlint scan ./service-a ./service-b --config ./org-policy.yml

# Remote repos (shallow-cloned to a temp dir, then cleaned up):
pmlint scan owner/repo https://github.com/owner/other --no-repo-config

# A whole GitHub org (enumerated via the gh CLI), JSON for a dashboard:
pmlint scan --org my-org --config ./org-policy.yml --format json
```

The static engine stays offline and deterministic; only the `scan` sources
layer touches the network (it shells out to `git` / `gh` for cloning and org
enumeration). `scan` exits non-zero if any repo is non-compliant or fails to
scan.

### Presets

- **`recommended`** — balanced defaults. Foreign lockfiles and mutating/updating
  CI installs are errors. Version-pinning rules (floating/unbounded versions,
  dist-tags, unpinned VCS sources) are **warnings** here, since a committed
  lockfile already pins the resolved versions; a missing lockfile, Dependabot
  config, or `cooldown` is also a warning. `app-strict` raises the version-pinning
  rules to errors.
- **`app-strict`** — for deployed apps. Lockfiles required, pinned package
  manager, exact Python pins, registry hardening, Dependabot required.
- **`library-recommended`** — for published libraries. Open ranges allowed and a
  lockfile is optional, but CI must still install deterministically.

## GitHub Action

The Action is a thin wrapper that only installs and invokes the CLI:

```yaml
- uses: pmlint/pmlint@v0
  with:
    args: check .
```

## Output formats

`stylish` (default, human-readable) and `json`:

```json
{
  "version": "0.1.0",
  "root": ".",
  "summary": { "errors": 2, "warnings": 1 },
  "diagnostics": [
    {
      "ruleId": "install/no-mutating-install-in-ci",
      "severity": "error",
      "message": "Found \"npm install\" in CI, which may mutate the lockfile or manifest.",
      "filePath": ".github/workflows/ci.yml"
    }
  ]
}
```

## Development

```bash
pnpm install
pnpm pmlint check .   # run from source (tsx)
pnpm test             # vitest
pnpm build            # emit dist/
```

## License

MIT
