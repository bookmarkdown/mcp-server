---
title: "Release Process"
description: "BookMarkdown MCP server 的 GitFlow、Changesets 版本管理與 npm 發布流程。"
ms.date: 2026-09-30
ms.topic: how-to
---

## Release status

`@bookmarkdown/mcp-server@0.2.0` is published on npm as the current `latest`
version and supports Windows and Linux. Its candidate tarball passed clean
installation and MCP initialize smoke tests on Ubuntu and Windows. The published
package was also installed from the npm registry and initialized on Ubuntu.

> [!IMPORTANT]
> Normal releases use `main` directly. Do not create `develop`, `release/*`, or
> manual `version/*` branches. Changesets owns the generated version branch.

## Branch model

* `main` is the only long-lived branch and contains released code.
* `feature/<name>`, `fix/<name>`, and `docs/<name>` are short-lived pull request branches created from `main`.
* `changeset-release/main` is managed by Changesets. Do not create or edit a second version branch manually.

Protect `main` with pull requests and required Ubuntu and Windows CI checks.
Restrict creation of `v*` tags to release maintainers.

In repository settings, allow GitHub Actions to create pull requests. The Changesets workflow needs this permission to open its version pull request.

Changesets uses `GITHUB_TOKEN`, so its branch push does not recursively trigger
CI. The workflow explicitly dispatches CI for `changeset-release/main` after it
creates or updates the Version Packages pull request.

## Changesets and versioning

Every change that affects the published package must include a Changeset. Run `npm run changeset` and select the package and SemVer impact:

* `patch` for backward-compatible fixes and documentation or metadata updates included in the package.
* `minor` for backward-compatible functionality.
* `major` for incompatible public behavior or interface changes.

Commit the generated `.changeset/*.md` file with the change. After the pull
request merges to `main`, Changesets opens or updates one version pull request
against `main`. Its `version-packages` script runs `changeset version` and
refreshes `package-lock.json`; review `package.json`, `package-lock.json`, and
`CHANGELOG.md`. Do not change the package version manually.

Changes that do not affect the npm artifact do not need a Changeset. When uncertain, include one and explain the expected impact in its summary.

## Release steps

1. Create one short-lived branch from `main`. Add the implementation, tests,
   documentation, and Changeset in the same pull request.
2. Run `npm test`, `npm run typecheck`, and `npm run verify:pack` locally. Push
   only after these checks pass.
3. Merge the pull request to `main` after Ubuntu and Windows CI pass.
4. Review the automated Version Packages pull request. Merge it after CI passes.
5. Confirm the npm Trusted Publisher configuration before creating a tag.
6. Tag the current `main` commit as `vX.Y.Z` and push only that tag.
7. Confirm the publish workflow succeeds, then install the registry package and
   complete an MCP initialize smoke test.

The publish workflow rejects tags that do not match `package.json` or do not
point to the current `main` commit. It skips npm publishing when the exact version
already exists in the registry.

## Push discipline

* Use one branch and one pull request for each logical change.
* Complete local validation before the first push.
* Push follow-up commits only when review or CI reveals a real defect.
* Do not create a manual version branch beside `changeset-release/main`.
* Do not create a release branch solely to rerun checks already required on the
  Version Packages pull request.

## Trusted Publishing

Configure the npm package Trusted Publisher with these exact values:

* Organization or user: `bookmarkdown`
* Repository: `mcp-server`
* Workflow filename: `publish.yml`
* Environment: `npm`

The workflow requires `id-token: write` and runs on a GitHub-hosted runner. Do
not add a long-lived npm token. Version `0.2.0` passed every workflow gate, but
npm rejected the OIDC publish request with `E404`; authenticated manual publishing
was used only after the workflow finished. Fix the Trusted Publisher mapping
before the next tag.

## Version 0.2.0 record

Release PR #5 merged the tested package to `main`. Annotated tag `v0.2.0` points
to commit `fc199e3`. Ubuntu and Windows CI passed, and the published registry
package completed a clean Ubuntu install and MCP initialize smoke test.

## Hotfixes and failed releases

For a hotfix, create a short-lived branch from `main`, include a patch Changeset,
and follow the same Version Packages pull request and tag flow. Do not introduce
a separate permanent branch model for hotfixes.

Published npm versions are immutable. If a release is faulty, prepare a new Changeset and publish a higher version; do not attempt to reuse or replace the published version. If CI fails before publication, fix the release branch and rerun checks before creating or moving a tag. Never move a tag that has already published a package.
