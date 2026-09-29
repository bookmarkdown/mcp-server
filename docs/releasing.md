---
title: "Release Process"
description: "BookMarkdown MCP server 的 GitFlow、Changesets 版本管理與 npm 發布流程。"
ms.date: 2026-09-29
ms.topic: how-to
---

## Release status

The package `@bookmarkdown/mcp-server` is configured for public npm publication, but it has not been published. The `npx` command is not available until the first version appears in the npm registry and an installation smoke test passes.

The repository contains CI, Changesets, and tag-publishing workflows. The project uses the MIT license. The `develop` branch, branch protection rules, npm trusted publisher, and protected `npm` GitHub environment still require maintainer setup.

## Branch model

* `main` contains released versions. Create annotated tags in the form `vX.Y.Z` on commits merged to `main`.
* `develop` is the integration branch for the next release.
* `feature/<name>` branches start from `develop` and merge back through pull requests.
* `release/<version>` branches start from `develop` after a Changesets version pull request is merged. Use them for final validation and release-only fixes.
* `hotfix/<version>` branches start from `main`, contain a Changesets entry, and merge back to both `main` and `develop`.

Create `develop` from the current `main` commit in GitHub before relying on the Changesets workflow. Protect `main` and `develop` with pull requests and required CI checks. Restrict creation of `v*` tags to release maintainers.

In repository settings, allow GitHub Actions to create pull requests. The Changesets workflow needs this permission to open its version pull request.

## Changesets and versioning

Every change that affects the published package must include a Changeset. Run `npm run changeset` and select the package and SemVer impact:

* `patch` for backward-compatible fixes and documentation or metadata updates included in the package.
* `minor` for backward-compatible functionality.
* `major` for incompatible public behavior or interface changes.

Commit the generated `.changeset/*.md` file with the change. The Changesets workflow opens or updates a version pull request against `develop`. That pull request updates `package.json`, `package-lock.json`, and `CHANGELOG.md`; review it as the proposed release version. Do not change the package version manually or publish from a feature branch.

Changes that do not affect the npm artifact do not need a Changeset. When uncertain, include one and explain the expected impact in its summary.

## Release steps

1. Merge the Changesets version pull request into `develop` after its CI checks pass.
2. Create `release/<version>` from `develop`. Run `npm test`, `npm run typecheck`, and `npm run verify:pack`; address release blockers on this branch.
3. Open a pull request from the release branch to `main`. Merge it only after the required checks pass.
4. Create and push an annotated `vX.Y.Z` tag on the merged `main` commit, using the version in `package.json`.
5. The `Publish to npm` workflow validates the tag, tests the package, and publishes through npm Trusted Publishing. The GitHub `npm` environment can require maintainer approval before the job runs.
6. Confirm the version is visible on npm, then install it in a clean Windows environment and smoke-test `bookmarkdown-mcp-server` before updating the public installation instructions.
7. Merge `main` back into `develop` so release-only changes are retained.

The publish workflow skips the publish command when that exact package version is already in the registry. This supports bootstrapping the first release with a maintainer-authorized manual publish before configuring Trusted Publishing. It does not make an unpublished package available through `npx`.

## First-release setup

Complete these steps before creating the first public release:

1. Confirm the MIT `LICENSE` file and `license` field are included in the release commit and npm tarball.
2. Confirm an authorized npm account controls the `@bookmarkdown` scope and can publish `@bookmarkdown/mcp-server` as a public package.
3. Merge the initial release version to `main`, then publish that exact version once from the release commit with an authorized maintainer account and npm's required two-factor authentication.
4. In npm package settings, add a GitHub Actions trusted publisher for `bookmarkdown/mcp-server`, workflow filename `publish.yml`, and environment `npm`. Allow direct publishing for this publisher.
5. Create the matching `vX.Y.Z` tag. The workflow verifies the version and skips publishing because the initial version already exists. Later tags publish through OIDC.
6. Configure the GitHub `npm` environment with required reviewers. Keep the workflow on a GitHub-hosted runner and preserve `id-token: write` permission.

The publish workflow installs npm CLI 11.5.1 because npm Trusted Publishing requires that version or newer. Do not add a long-lived npm publish token to repository secrets.

## Hotfixes and failed releases

For a hotfix, branch from `main`, add the appropriate Changeset, and merge the reviewed pull request to `main`. Tag the resulting commit to publish it, then merge `main` back into `develop`. The Changesets version pull request on `develop` must not discard the hotfix version or changelog entry.

Published npm versions are immutable. If a release is faulty, prepare a new Changeset and publish a higher version; do not attempt to reuse or replace the published version. If CI fails before publication, fix the release branch and rerun checks before creating or moving a tag. Never move a tag that has already published a package.
