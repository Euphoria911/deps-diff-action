# 📦 deps-diff-action

A GitHub Action that drops a clean, visual dependency diff into every pull request that touches `package.json`. No more squinting at JSON blobs in the Files tab — see at a glance what was added, removed, upgraded, or downgraded, with major-bump warnings.

![status](https://img.shields.io/badge/status-stable-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)

## What you get

A single PR comment that updates itself on every push:

> ## 📦 Dependency changes
> `package.json`
>
> **Summary:** 2 added · 1 removed · 3 upgraded · 0 downgraded · ⚠️ 1 major
>
> ### `dependencies`
> | Change | Package | From | To | Bump |
> | --- | --- | --- | --- | --- |
> | ➕ added | `zod` | — | `^3.23.8` | — |
> | ⬆️ upgraded | `react` | `^18.2.0` | `^19.0.0` | 🔴 major |
> | ⬆️ upgraded | `express` | `^4.19.1` | `^4.21.0` | 🟡 minor |

## Usage

Create `.github/workflows/deps-diff.yml` in your repo:

```yaml
name: Dependency diff

on:
  pull_request:
    paths:
      - 'package.json'

permissions:
  contents: read
  pull-requests: write

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - uses: Euphoria911/deps-diff-action@v1
```

That's it. The action re-reads `package.json` at both the base and head commits via the Contents API, so you don't even need `actions/checkout`.

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token with `pull-requests: write`. |
| `manifest-path` | `package.json` | Path to the manifest to diff (monorepos: point at a sub-package). |
| `comment-header` | `📦 Dependency changes` | Heading used in the PR comment. |
| `fail-on-major` | `false` | Fail the check if any dep has a major-version bump. |
| `include-dev` | `true` | Include `devDependencies` in the diff. |

## Outputs

| Name | Description |
| --- | --- |
| `added` | Count of added dependencies. |
| `removed` | Count of removed dependencies. |
| `upgraded` | Count of upgraded dependencies. |
| `downgraded` | Count of downgraded dependencies. |
| `changed` | Count of non-semver version changes (e.g. git/url specs). |
| `major-bumps` | Count of major-version bumps. |

## Advanced example

Gate merges on major bumps, and label PRs that touch deps:

```yaml
name: Dependency diff

on:
  pull_request:
    paths: ['package.json']

permissions:
  contents: read
  pull-requests: write

jobs:
  diff:
    runs-on: ubuntu-latest
    steps:
      - id: deps
        uses: Euphoria911/deps-diff-action@v1
        with:
          fail-on-major: true

      - name: Label PR
        if: steps.deps.outputs.added != '0' || steps.deps.outputs.upgraded != '0'
        uses: actions-ecosystem/action-add-labels@v1
        with:
          labels: dependencies
```

## How it works

1. Reads the manifest at `pull_request.base.sha` and `pull_request.head.sha` through the GitHub Contents API — no checkout needed.
2. Computes section-wise diffs across `dependencies`, `devDependencies`, `peerDependencies`, and `optionalDependencies`.
3. Classifies version changes as **major / minor / patch / other** using a lightweight semver parser (ignores range prefixes like `^` and `~`).
4. Posts a single sticky comment, keyed by an HTML marker, that it edits in place on subsequent pushes.

## Caveats

- **Pull requests from forks** receive a read-only `GITHUB_TOKEN`, so the comment post will fail with a 403. This is a GitHub-wide security policy, not a bug in the action. If you need fork support, run the diff in a `pull_request_target` workflow (and read the [security guidance](https://securitylab.github.com/research/github-actions-preventing-pwn-requests/) before you do).
- **Non-semver versions** (`workspace:*`, `git+https://…`, `file:…`, `latest`, `1.2.x`) are reported as **🔄 changed** with a `⚪ other` bump — you'll still see the exact from/to strings, but the semver badge is uninformative because they aren't semver.
- **Monorepos** need one workflow step per `package.json`; set `manifest-path` accordingly.

## Development

```bash
npm install
npm run lint      # typecheck
npm test          # unit tests (node:test + tsx)
npm run build     # bundle to dist/ with ncc
```

Commit the generated `dist/` folder — that's what GitHub executes.

## Releasing

```bash
git tag -a v1.0.0 -m "v1.0.0"
git push --follow-tags
git tag -f v1 v1.0.0
git push origin v1 --force
```

Users pin to the floating `v1` tag; it moves forward on each release.

## License

MIT
