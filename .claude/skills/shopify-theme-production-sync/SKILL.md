---
name: shopify-theme-production-sync
description: Safely pull from or push to the configured Shopify production theme, preserving local and remote copies before any synchronization.
metadata:
  short-description: Safely sync a production theme
---

# Shopify Production Theme Sync

Use this skill when the user asks to pull from, push to, or synchronize a Shopify theme's configured `production` environment. It protects both sides of the sync; it does not publish a theme.

Before any pull or push, read `shopify.theme.toml`, `package.json`, and the repository instructions. Use the repository's existing `npm run theme:pull:production` and `npm run theme:push:production` commands for every production transfer, including recovery snapshots. Do not invoke `shopify theme pull` or `shopify theme push` directly. The wrappers select the named `production` environment and its pinned theme ID; do not substitute a theme name, use `--live`, or run a command that publishes the theme unless the user separately asks to publish it.

## Preserve both sides first

Create one persistent, timestamped recovery directory outside the repository. It must hold a full local copy and a fresh copy of the remote production theme before the sync:

```bash
sync_root="$HOME/.codex/theme-sync-backups"
mkdir -p "$sync_root"
sync_backup="$(mktemp -d "$sync_root/production-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
rsync -a --exclude='.git' ./ "$sync_backup/local-before/"
mkdir -p "$sync_backup/remote-before"
cp shopify.theme.toml "$sync_backup/remote-before/"
npm run theme:pull:production -- --path "$sync_backup/remote-before" --nodelete
```

The copied `shopify.theme.toml` lets the wrapper retain the repository's pinned environment; `--nodelete` preserves that config file in the recovery copy.

Record the backup path in the response. Do not place it inside the theme repository, where it could be uploaded or included in a later diff.

Check the local worktree before modifying it:

```bash
git status --short
git diff --binary
git ls-files --others --exclude-standard
diff -ruN --exclude='shopify.theme.toml' "$sync_backup/remote-before" "$sync_backup/local-before"
```

Treat a nonempty worktree as unsynchronized local work. Treat differences between the two recovery copies as information to reconcile, not permission to overwrite either side. If the origin of a conflicting change is uncertain, stop after preserving the copies and show the relevant diff; do not pull or push over it. The recovery directory is the source for an explicit merge or restoration after the user chooses the intended result.

## Pull production

Only pull into the repository after its local work is clean or has been committed/stashed by the user, and after the remote copy has been preserved. Then run the existing project command when available:

```bash
npm run theme:pull:production
```

Review `git diff --binary` and `git status --short` afterward. Keep the pre-pull recovery directory until the user has verified the result.

## Push production

After preserving the current remote copy, identify changes made on the remote since the last known synchronized version. If the repository does not contain an authoritative baseline, do not infer that remote differences are safe to replace: compare the recovery copies, reconcile intentional remote edits into the local source, and preserve the result before proceeding.

Run Theme Check immediately before the push. Prefer the project wrapper because it already makes the required check part of the operation:

```bash
npm run theme:push:production
```

The existing push wrapper runs Theme Check. If it fails, do not push. After a successful push, pull the production theme again through `npm run theme:pull:production -- --path <verification-directory> --nodelete` and compare it with the local source, excluding only local configuration files that Shopify does not store.

## Recovery

Never delete a recovery directory during the sync. To restore local files, first preserve the current worktree in a new recovery directory, then copy selected files from `local-before` or `remote-before`; do not bulk-replace a repository without an explicit user request. For a failed or interrupted command, retain both copies, inspect them, and continue only from a reconciled local source.
