# Releasing

## Branches

- **`develop`** is where work lands.
- **`main`** is what has been released, and nothing else. It only receives
  `develop` through a pull request — after the release has been validated by
  hand, on a desktop **and a phone** — and hotfixes.
- A **tag** such as `0.1.0` — the version, with no `v` — is a release. Nobody
  writes it by hand: release-please does.

## Commit messages

Every commit is a [conventional commit](https://www.conventionalcommits.org):
`type(scope): what changed`, with `feat`, `fix`, `perf`, `refactor`, `docs`,
`test`, `build`, `ci`, `chore`, `style` or `revert`, and `!` after the type for
a change that breaks something an instance relies on. The release notes are
written from them; the CI refuses a pull request carrying a commit that is not
one.

## How a release happens

```
develop ──(PR, validated)──▶ main ──▶ release-please opens “release X.Y.Z”
                                            │ merged
                                            ▼
                                 tag X.Y.Z + GitHub release
                                            │
                                            ▼
                       images on GHCR (amd64, arm64) + SBOMs on the release
```

1. When `develop` is ready and validated, open the pull request `develop` →
   `main`, and merge it with a merge commit once its checks are green.
2. On `main`, release-please (`release.yml`) reads the conventional commits
   since the last release and opens — or updates — the pull request
   “release X.Y.Z”: the version (`feat` bumps the minor, `fix` the patch, `!`
   the major), the changelog section, the version in every `package.json`.
   Its release notes can be edited in that pull request before merging.
3. Merging it tags `X.Y.Z` and publishes the GitHub release with those notes.
   The same workflow then builds both images for amd64 and arm64, scans them,
   pushes them tagged `X.Y.Z`, `X.Y` and `latest`, and attaches their SBOM
   (SPDX) to the release. The images are all ATEM ships: there is no archive,
   so no checksum file.

The first release, 0.1.0, is pinned by `release-as` in
`release-please-config.json`; that line goes once it is out, and the versions
are computed from the commits after that.

## Versions

[Semantic versioning](https://semver.org). While the version starts with `0.`,
a minor version (`0.2.0`) may change what an instance needs — a setting, a
step — and says so in its notes; a patch (`0.1.1`) never does.

## Hotfixes

A fix that cannot wait for `develop`: branch from `main`, fix with a `fix:`
commit, pull request to `main`, then merge `main` back into `develop`.

## What the checks run

| Workflow | When | What |
|---|---|---|
| `ci.yml` — gates, types and tests | every pull request, pushes to `develop` and `main` | `scripts/check-all.sh`, the script a developer runs, against a PostgreSQL service |
| `ci.yml` — dependency review | every pull request | refuses a new dependency with a known vulnerability (moderate and up) or a license the AGPL cannot take in |
| `ci.yml` — secret scan | every pull request and push | gitleaks over the whole history |
| `ci.yml` — images | pull requests to `main`, and `main` | both images built (amd64) and scanned by Trivy: a fixable HIGH or CRITICAL vulnerability fails |
| `codeql.yml` | every pull request, pushes, and weekly | CodeQL's security queries over the TypeScript |
| `ci.yml` — conventional commits | every pull request | every commit of the pull request is a conventional commit |
| `release.yml` | pushes to `main` | release-please's release pull request — with the checks above dispatched on it — or, once it is merged, the tag, the GitHub release, both images scanned then built for amd64 and arm64 and pushed with a provenance attestation, and their SBOMs attached to the release |

The end-to-end tests are not in CI: they need a running instance and the card
catalogue, which means downloading it from YGOPRODeck on every run. They run
on a developer's machine before a release pull request is opened
(`docs/development.md`).

Dependabot opens weekly pull requests against `develop` for npm, the actions,
the base images and the compose file. GitHub's secret scanning with push
protection, Dependabot alerts and private vulnerability reporting are enabled
on the repository.

Every action is pinned by commit — each one checked as signed by its publisher
when it was pinned — and every job gets only the permissions it needs.
