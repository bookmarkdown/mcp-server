---
title: "Release Process"
description: "BookMarkdown MCP server 的 GitFlow、Changesets 版本管理與 npm 發布流程。"
ms.date: 2026-09-30
ms.topic: how-to
---

## Release status

`@bookmarkdown/mcp-server@0.1.3` is published on npm and is the current `latest` version. It remains Windows-only; the current source adds Linux support. Clean Windows and Linux package installation smoke tests are pending, so the public README points Linux users to source installation. The README snapshot on npm predates publication and must be updated in a later version after the smoke tests pass.

The repository contains a Linux/Windows CI matrix, Ubuntu Changesets workflow, and Ubuntu tag-publishing workflow. The project uses the MIT license, and the `develop` branch exists. Before the next release, verify branch protection, GitHub Actions pull request permissions, the npm trusted publisher, and the protected `npm` GitHub environment.

## Branch model

* `main` contains released versions. Create annotated tags in the form `vX.Y.Z` on commits merged to `main`.
* `develop` is the integration branch for the next release.
* `feature/<name>` branches start from `develop` and merge back through pull requests.
* `release/<version>` branches start from `develop` after a Changesets version pull request is merged. Use them for final validation and release-only fixes.
* `hotfix/<version>` branches start from `main`, contain a Changesets entry, and merge back to both `main` and `develop`.

Keep `develop` synchronized with `main` before accepting Changesets version pull requests. Protect `main` and `develop` with pull requests and required CI checks. Restrict creation of `v*` tags to release maintainers.

In repository settings, allow GitHub Actions to create pull requests. The Changesets workflow needs this permission to open its version pull request.

## Changesets and versioning

Every change that affects the published package must include a Changeset. Run `npm run changeset` and select the package and SemVer impact:

* `patch` for backward-compatible fixes and documentation or metadata updates included in the package.
* `minor` for backward-compatible functionality.
* `major` for incompatible public behavior or interface changes.

Commit the generated `.changeset/*.md` file with the change. The Changesets workflow opens or updates a version pull request against `develop`. Its `version-packages` script runs `changeset version` and refreshes `package-lock.json`; review the resulting `package.json`, `package-lock.json`, and `CHANGELOG.md` as the proposed release version. Do not change the package version manually or publish from a feature branch.

Changes that do not affect the npm artifact do not need a Changeset. When uncertain, include one and explain the expected impact in its summary.

## Release steps

1. Merge the Changesets version pull request into `develop` after its CI checks pass.
2. Create `release/<version>` from `develop`. Run `npm test`, `npm run typecheck`, and `npm run verify:pack`; address release blockers on this branch.
3. Open a pull request from the release branch to `main`. Merge it only after the required checks pass.
4. Create and push an annotated `vX.Y.Z` tag on the merged `main` commit, using the version in `package.json`.
5. The `Publish to npm` workflow validates the tag, tests the package, and publishes through npm Trusted Publishing. The initial release, `v0.1.3`, was published manually after the workflow's publish step failed. Before publishing another version, verify the npm Trusted Publisher uses repository `bookmarkdown/mcp-server`, workflow filename `publish.yml`, and environment `npm`. The GitHub `npm` environment can require maintainer approval before the job runs.
6. Confirm the version is visible on npm, then install it in clean Windows and Linux environments and smoke-test `npx --yes --package=@bookmarkdown/mcp-server@<version> -- bookmarkdown-mcp-server` before updating the public installation instructions.
7. Merge `main` back into `develop` so release-only changes are retained.

The publish workflow skips the publish command when that exact package version is already in the registry. This allowed the first release to be published manually before configuring Trusted Publishing and prevents a duplicate publish when the same version is checked again. An unpublished package is not available through `npx`.

## Publishing the Linux-capable version

The npm `latest` version is `0.1.3` and supports Windows only. The Linux support change is a `minor` Changeset, so its expected version is `0.2.0` when applied to `0.1.3`. Do not reuse or move the already-published `v0.1.3` tag.

At the `0.1.3` release baseline, `main` and `develop` both contain package version `0.1.3` and `.changeset/linux-lan-support.md`. As of 2026-09-30, the remote `changeset-release/develop` branch still declares `0.1.1`. The Changesets workflow runs only on pushes to `develop`.

1. Confirm that `develop` contains the `0.1.3` baseline and the Linux support Changeset. This main-to-develop sync is already present at this checkpoint; if it is missing in a later release, merge `main` into `develop` through a reviewed pull request. Do not merge a generated version pull request based on `0.1.1`, because it would propose a version below the published `0.1.3`.
2. After a push to `develop`, let the Changesets workflow create or update its version pull request. Review that it proposes `0.2.0` and updates `package.json`, `package-lock.json`, and `CHANGELOG.md`. If the existing version branch still proposes a version below `0.2.0`, refresh it before merging. Do not edit the package version manually.
3. After merging the version pull request into `develop`, follow release steps 2 and 3 above using `release/0.2.0`. Run the Linux and Windows CI checks, and install the packed tarball in clean Linux and Windows environments. `npm run verify:pack` checks archive contents but does not install or run the package. Update the public README installation status after the tarball smoke tests pass.
4. Merge the release pull request into `main`. Confirm that `package.json` reports `0.2.0`, then create and push the tag from the merged `main` commit:

   ```bash
   git switch main
   git pull --ff-only origin main
   git tag -a v0.2.0 -m "Release v0.2.0"
   git push origin v0.2.0
   ```

   Pushing the tag starts the publish workflow. Confirm it succeeds and that `npm view @bookmarkdown/mcp-server version` reports `0.2.0`; do not run `npm publish` manually while the workflow is publishing.
5. Merge `main` back into `develop` after the release so both branches retain the published version and release-only changes.

## First-release setup

The first public version, `0.1.3`, was manually published from tagged commit `c341306` after the workflow's npm publish step failed. Before publishing a later version, complete these setup checks:

1. In npm package settings, configure a GitHub Actions trusted publisher for `bookmarkdown/mcp-server`, workflow filename `publish.yml`, and environment `npm`. Allow direct publishing for this publisher.
2. Configure the GitHub `npm` environment with required reviewers. Keep the workflow on a GitHub-hosted runner and preserve `id-token: write` permission.
3. Confirm a later tagged release either skips publishing when its exact version already exists or publishes successfully through OIDC.

The publish workflow installs npm CLI 11.5.1 because npm Trusted Publishing requires that version or newer. Do not add a long-lived npm publish token to repository secrets.

## Hotfixes and failed releases

For a hotfix, branch from `main`, add the appropriate Changeset, and merge the reviewed pull request to `main`. Tag the resulting commit to publish it, then merge `main` back into `develop`. The Changesets version pull request on `develop` must not discard the hotfix version or changelog entry.

Published npm versions are immutable. If a release is faulty, prepare a new Changeset and publish a higher version; do not attempt to reuse or replace the published version. If CI fails before publication, fix the release branch and rerun checks before creating or moving a tag. Never move a tag that has already published a package.
