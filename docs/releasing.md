# Releasing

## Branches

- **`develop`** — where work lands.
- **`main`** — released code only. It receives `develop` through a pull request,
  after manual validation on desktop **and** phone, and hotfixes.
- **Tags** — `0.1.0`, no `v`. Created by release-please, never by hand.

## Commit messages

[Conventional commits](https://www.conventionalcommits.org):
`type(scope): what changed`, with `feat`, `fix`, `perf`, `refactor`, `docs`,
`test`, `build`, `ci`, `chore`, `style` or `revert`; `!` after the type marks a
breaking change. Release notes are generated from them, and CI rejects a pull
request containing any other form.

## Release flow

```
develop ──(PR, validated)──▶ main ──▶ release-please opens “release X.Y.Z”
                                            │ merged
                                            ▼
                                 tag X.Y.Z + GitHub release
                                            │
                                            ▼
                       images on GHCR (amd64, arm64) + SBOMs on the release
```

1. Once `develop` is validated, open the pull request `develop` → `main` and
   merge it with a merge commit when checks are green.
2. On `main`, release-please (`release.yml`) opens or updates the “release
   X.Y.Z” pull request: version (`feat` → minor, `fix` → patch, `!` → major),
   changelog, and every `package.json`. Edit its notes there if needed.
3. Merging it tags `X.Y.Z` and publishes the GitHub release. The workflow then
   builds both images for amd64 and arm64, scans them, pushes `X.Y.Z`, `X.Y`
   and `latest`, and attaches their SPDX SBOMs. Images are the only artefacts,
   so there is no checksum file.

0.1.0 is pinned by `release-as` in `release-please-config.json`; remove that
line once it is out.

## Versions

[Semantic versioning](https://semver.org). Below 1.0, a minor version (`0.2.0`)
may change what an instance needs, and its notes say so; a patch never does.

## Hotfixes

Branch from `main`, commit a `fix:`, open a pull request to `main`, then merge
`main` back into `develop`.

## Checks

| Workflow | When | What |
|---|---|---|
| `ci.yml` — gates, types and tests | pull requests; pushes to `develop` and `main` | `scripts/check-all.sh` against a PostgreSQL service |
| `ci.yml` — dependency review | pull requests | rejects new dependencies with known vulnerabilities (moderate+) or AGPL-incompatible licenses |
| `ci.yml` — secret scan | pull requests and pushes | gitleaks over the full history |
| `ci.yml` — images | pull requests to `main`; `main` | both images built (amd64) and scanned by Trivy; a fixable HIGH or CRITICAL fails |
| `ci.yml` — conventional commits | pull requests | every commit follows the convention |
| `codeql.yml` | pull requests, pushes, weekly | CodeQL security queries on the TypeScript |
| `release.yml` | pushes to `main` | the release pull request (with the checks above dispatched on it); once merged: tag, release, images built, scanned and pushed with provenance, SBOMs attached |

End-to-end tests are not in CI: they need a running instance and the card
catalogue from YGOPRODeck. They run locally before a release pull request
(`docs/development.md`).

Dependabot opens weekly pull requests against `develop` for npm, actions, base
images and the compose file. Secret scanning with push protection, Dependabot
alerts and private vulnerability reporting are enabled. Actions are pinned by
commit, and each job has only the permissions it needs.
