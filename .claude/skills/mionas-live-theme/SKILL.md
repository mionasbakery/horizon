---
name: mionas-live-theme
description: Safely pull from or push to the configured Shopify production theme, preserving local and remote copies before any synchronization.
metadata:
  short-description: Push or pull the live theme
---

# Mionas Live Theme

Use this skill when the user asks to pull from, push to, or synchronize a Shopify theme's configured `production` environment. It protects both sides of the sync; it does not publish a theme.

Before any pull or push, read `shopify.theme.toml`, `package.json`, and the repository instructions. Use the repository's existing `npm run theme:pull:production` and `npm run theme:push:production` commands for every production transfer, including recovery snapshots. Do not invoke `shopify theme pull` or `shopify theme push` directly. The wrappers select the named `production` environment and its pinned theme ID. The production theme is the live theme, so the push wrapper passes `--allow-live`: that permits writing to it and publishes nothing. Do not substitute a theme name, add `--live`, or run `shopify theme publish` unless the user separately asks to publish a theme.

## Preserve both sides first

Create one persistent, timestamped recovery directory outside the repository. It must hold a full local copy and a fresh copy of the remote production theme before the sync:

```bash
sync_root="$HOME/.mionas/theme-sync-backups"
mkdir -p "$sync_root"
sync_backup="$(mktemp -d "$sync_root/production-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
rsync -a --exclude='.git' --exclude='node_modules' ./ "$sync_backup/local-before/"
mkdir -p "$sync_backup/remote-before"
cp shopify.theme.toml "$sync_backup/remote-before/"
npm run theme:pull:production -- --path "$sync_backup/remote-before" --nodelete
echo "$sync_backup"
```

The copied `shopify.theme.toml` lets the wrapper retain the repository's pinned environment; `--nodelete` preserves that config file in the recovery copy.

Record the backup path in the response. Keep it outside the theme repository: inside it, Theme Check would lint the copies and the next `rsync` would copy the backups into themselves. Backups made before this skill moved here stay in `~/.codex/theme-sync-backups`.

### Sandbox

`.claude/settings.local.json` puts the backup root on the sandbox write allowlist. The Shopify CLI itself cannot run sandboxed: it writes its login and config under `~/Library/Preferences/shopify-cli-*` and fails with `EPERM ... shopify-cli-theme-conf-nodejs`. When any wrapper fails that way, stop and give the user the step to run with the `!` prefix, as one `&&`-chained line so `$sync_backup` survives to the `echo`, then continue from the path it prints.

## Compare the copies

Check the local worktree before modifying it:

```bash
git status --short
git diff --binary
git ls-files --others --exclude-standard
for d in assets blocks config layout locales sections snippets templates; do
  diff -ruN "$sync_backup/remote-before/$d" "$sync_backup/local-before/$d"
done
```

The diff covers only the theme folders, because the remote copy holds nothing else. The files most likely to differ are the ones the theme editor writes on the store: `config/settings_data.json`, `templates/*.json`, and the section-group JSON files in `sections/`. A remote-only change there is an editor edit a push would overwrite.

Treat a nonempty worktree as unsynchronized local work. Treat differences between the two recovery copies as information to reconcile, not permission to overwrite either side. If the origin of a conflicting change is uncertain, stop after preserving the copies and show the relevant diff; do not pull or push over it. The recovery directory is the source for an explicit merge or restoration after the user chooses the intended result.

## Pull production

Only pull into the repository after its local work is clean or has been committed/stashed by the user, and after the remote copy has been preserved. Then run:

```bash
npm run theme:pull:production
```

Review `git diff --binary` and `git status --short` afterward. Keep the pre-pull recovery directory until the user has verified the result.

## Push production

After preserving the current remote copy, identify changes made on the remote since the last known synchronized version. If the repository does not contain an authoritative baseline, do not infer that remote differences are safe to replace: compare the recovery copies, reconcile intentional remote edits into the local source, and preserve the result before proceeding.

The push wrapper runs Theme Check first and aborts on any error; never push around a failed check:

```bash
npm run theme:push:production
```

After a successful push, verify it into the same recovery directory and compare the theme folders as above, `remote-after` against the local source:

```bash
mkdir -p "$sync_backup/remote-after"
cp shopify.theme.toml "$sync_backup/remote-after/"
npm run theme:pull:production -- --path "$sync_backup/remote-after" --nodelete
```

## Recovery

Never delete a recovery directory during the sync. To restore local files, first preserve the current worktree in a new recovery directory, then copy selected files from `local-before` or `remote-before`; do not bulk-replace a repository without an explicit user request. For a failed or interrupted command, retain both copies, inspect them, and continue only from a reconciled local source.
