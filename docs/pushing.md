---
title: "推送與發布流程"
description: "BookMarkdown MCP Server 日常 branch、pull request、Changesets、tag 與 npm 發布操作清單。"
ms.date: 2026-10-09
ms.topic: how-to
---

## 先記住這些規則

> [!IMPORTANT]
> Repository 只有一個長期 branch：`main`。一般變更建立一個短期 branch、
> 一個 pull request，並在本機驗證完成後集中 push。不要建立 `develop`、
> `release/*` 或手動 `version/*` branch。

* Pull request 一律以 `main` 為目標。
* 影響 npm 套件的變更必須包含 Changeset。
* 不要手動修改 `package.json` 的版本。
* 不要修改 Changesets 自動管理的 `changeset-release/main` branch。
* 不要 force push `main`、版本 branch 或 release tag。
* 不要在 publish workflow 仍執行時手動執行 `npm publish`。

以下命令使用 Bash 或 Git Bash。

## Repository 與 CI 設定

保護 `main`，要求 pull request 與 Ubuntu、Windows、macOS CI 通過，並限制
`v*` tag 由發布維護者建立。在 repository 設定允許 GitHub Actions 建立
pull request，供 Changesets 開啟 Version Packages pull request。

Changesets 使用 `GITHUB_TOKEN`，其 branch push 不會自動觸發其他 workflow。
本專案的 `changesets.yml` 會在版本 pull request 建立或更新後，明確 dispatch
`ci.yml` 到 `changeset-release/main`。

## 日常變更

### 1. 從最新 main 建立一個 branch

先決定一個短而明確的 branch 名稱，例如 `fix/version-pr-ci`、
`feature/add-tab-tool` 或 `docs/update-installation`。

```bash
git switch main
git pull --ff-only origin main
BRANCH="fix/short-description"
git switch -c "$BRANCH"
```

一個 logical change 使用一個 branch。不要為同一項工作再建立 release 或
version branch。

### 2. 加入 Changeset

程式、公開行為、dependencies、套件 metadata，以及 npm 套件內的 README
有變更時，執行：

```bash
npm run changeset
```

依影響選擇版本：

* `patch`：相容修正，或套件內文件與 metadata 更新
* `minor`：新增向下相容功能
* `major`：不相容的公開行為或介面變更

只改 repository 內部文件或測試，而且不影響 npm artifact 時，可以不加
Changeset。不確定時可用 `npm pack --dry-run` 查看套件內容。

### 3. Push 前完成本機驗證

```bash
npm test
npm run typecheck
npm run verify:pack
git diff --check
git status --short
```

先修完所有已知問題，再進行 commit 與第一次 push。不要用多次小 push 取代
本機驗證。

### 4. Review、commit、push 一次

先檢查差分，只 stage 本次工作需要的檔案：

```bash
git diff
git add path/to/changed-file path/to/another-file
git status --short
git commit -m "fix: describe the change"
git push --set-upstream origin "$BRANCH"
```

不要用 `git add .` 帶入無關變更。CI 或 review 發現實際問題時，在同一個
branch 修正、重新完成本機驗證，再追加一次 push。

### 5. 建立並合併 pull request

1. 在 GitHub 建立從目前 branch 到 `main` 的 pull request。
2. 確認 Ubuntu、Windows 與 macOS CI 都成功。
3. 使用 squash merge 合併。
4. 在 GitHub 刪除已合併的 remote branch。
5. 同步本機並刪除 local branch。

```bash
git switch main
git pull --ff-only origin main
git branch -d "$BRANCH"
```

若 GitHub 沒有刪除 remote branch，再執行：

```bash
git push origin --delete "$BRANCH"
```

## Version Packages pull request

一般 pull request 合併後，Changesets 會自動建立或更新唯一的 Version
Packages pull request，其 branch 是 `changeset-release/main`。

* 尚未準備發布時，保持 Version Packages pull request 開啟。
* 準備發布時，確認版本、`CHANGELOG.md`、`package-lock.json` 與 CI 結果。
* Ubuntu、Windows 與 macOS CI 都成功後，才 squash merge 到 `main`。
* 不要另開 version branch，也不要直接修改自動產生的 branch。

> [!IMPORTANT]
> 合併 Version Packages pull request 後，先暫停其他 `main` merge。完成
> release tag push 後再恢復，確保 tag 仍指向最新的 `origin/main`。

## 建立 release tag

先同步 `main`，確認工作樹乾淨，而且 local `HEAD` 等於最新
`origin/main`：

```bash
git switch main
git pull --ff-only origin main
git fetch origin main
git status --short
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
VERSION=$(node -p "require('./package.json').version")
git tag --list "v$VERSION"
```

`git status --short` 與 `git tag --list` 都應沒有輸出。接著建立 annotated
tag，並只 push 這個 tag：

```bash
git tag -a "v$VERSION" -m "Release v$VERSION"
git push origin "v$VERSION"
```

Tag push 會啟動 `Publish to npm` workflow。Workflow 會重新執行測試、確認
tag 版本與最新 `main` commit 相符，並檢查 npm registry 是否已有相同版本。

## 發布後確認

1. 確認 `Publish to npm` workflow 成功。
2. 確認 npm registry 的 `latest` 是新版本。
3. 從 registry 安裝新版本到乾淨環境。
4. 使用 MCP client 完成 initialize smoke test。
5. 確認 daemon stdout 沒有 MCP protocol 訊息，HTTP initialize 與 tools/list 回覆正確，且 stderr 不洩漏 token。

在下一次 tag 前，npm Trusted Publisher 必須使用以下精確設定：

* Organization 或 user：`bookmarkdown`
* Repository：`mcp-server`
* Workflow filename：`publish.yml`
* Environment：`npm`

Publish workflow 使用 GitHub-hosted runner 與 `id-token: write`，不使用
長期 npm token。過去 `0.2.0` 發布曾遇到 OIDC `E404`；每次發布前仍需確認
Trusted Publisher mapping，不把歷史失敗當成目前設定狀態。

## 失敗時怎麼做

### 一般 pull request CI 失敗

在同一個 branch 修正，重新執行本機驗證後再 push。不要建立第二個 branch
或第二張 pull request。

### Version Packages CI 失敗

不要直接修改 `changeset-release/main`。從 `main` 建立一般 fix branch，修正
根因並循日常變更流程合併；Changesets 會更新原本的 Version Packages pull
request。

### Publish workflow 的認證或環境設定失敗

確認 npm registry 尚未出現該版本，修正 Trusted Publisher 或 GitHub
environment 設定，再 rerun 原本的 failed workflow。不要同時手動 publish。
若 npm OIDC publish 回傳 `E404`，先到 npm package settings 的 Trusted
Publisher 設定，逐項核對上方四個值；這通常代表 publisher mapping 不符，
不代表套件名稱不存在。

### 已發布版本有問題

npm 版本不可覆寫。建立一般 fix branch、加入 patch Changeset，經 Version
Packages pull request 產生更高版本。不要移動或重用已發布的 tag。

## 歷史發布紀錄

`0.2.0` 的 release PR #5 與 annotated tag `v0.2.0` 對應 commit
`fc199e3`。當時 Ubuntu、Windows CI 與 npm registry 安裝後的 Ubuntu MCP
initialize smoke 通過；OIDC 發布遭拒後，才以認證的手動發布完成。
這是歷史紀錄，不代表目前的 npm `latest` 或當前版本已通過相同驗證。
各版本變更見 [CHANGELOG](../CHANGELOG.md)。
