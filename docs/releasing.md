# Releasing

## Branches

- **`develop`** is where work lands. Every change reaches it through a pull
  request whose checks are green.
- **`main`** is what has been released, and nothing else. It only receives
  `develop` when a release is cut, and hotfixes.
- A **tag `vX.Y.Z`** on `main` is a release: it builds the images, publishes
  them, and opens the GitHub release.

```
feature ──▶ develop ──(release PR)──▶ main ──▶ tag vX.Y.Z ──▶ images on GHCR
                ▲                       │
                └──── hotfix merged back┘
```

## Versions

[Semantic versioning](https://semver.org). While the version starts with `0.`,
a minor version (`0.2.0`) may change what an instance needs — a setting, a
step — and says so in the changelog; a patch (`0.1.1`) never does.

The version is written in the root `package.json` and in each workspace
package, and in `CHANGELOG.md`. They move together, in the release pull
request.

## Cutting a release

1. On `develop`, in one pull request: move the changelog's *Unreleased* section
   under the new version and date, and set the version in the `package.json`
   files.
2. Open the release pull request from `develop` to `main`. Its checks are the
   same as every pull request's, plus the image builds.
3. Merge it — a merge commit, not a squash, so `main` and `develop` keep one
   history.
4. Tag the merge commit on `main`: `git tag -s vX.Y.Z -m "ATEM X.Y.Z"` and push
   the tag. The release workflow builds `ghcr.io/altagen/atem-api` and
   `ghcr.io/altagen/atem-web`, pushes them tagged `X.Y.Z`, `X.Y` and `latest`,
   and publishes the GitHub release with the changelog's section.

## Hotfixes

A fix that cannot wait for `develop`: branch from `main`, fix, pull request to
`main`, tag the patch version, then merge `main` back into `develop`.

## What the checks run

*To be completed with the CI configuration.*
