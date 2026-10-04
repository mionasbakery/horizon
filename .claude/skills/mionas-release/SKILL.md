---
name: mionas-release
description: Release the theme to the live store by tagging it for the release pipeline, or pull editor edits from the live theme.
disable-model-invocation: true
---

# Mionas Release

A release is a `release-*` tag on `main`. Pushing it starts `.github/workflows/release.yml`, which runs Theme Check, waits at the `production` environment's manual gate, then pushes the tagged commit to the live theme. This skill reconciles, tags and watches, and leaves the push to the pipeline. For a direct push without the pipeline's gate, the user runs `/mionas-live-theme` instead.

Read `shopify.theme.toml`, `package.json` and the workflow first. Every local transfer goes through `npm run theme:pull:production`, which selects the pinned production theme ID.

## 1. Preserve both sides

Create one timestamped recovery directory outside the repository, holding a full local copy and a fresh copy of the live theme:

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

The CLI reads `shopify.theme.toml` from `--path`, and `--nodelete` keeps it there. Inside the repository, Theme Check would lint the copies and the next `rsync` would copy backups into themselves. Record the path in the response.

The Shopify CLI cannot run sandboxed: it writes its config under `~/Library/Preferences/shopify-cli-*` and fails with `EPERM ... shopify-cli-theme-conf-nodejs`. On that error, give the user the block to run with the `!` prefix, as one `&&`-chained line so `$sync_backup` survives to the `echo`, then continue from the path it prints.

## 2. Reconcile editor edits

The pipeline overwrites the live theme with the tagged commit, so any edit made in the theme editor and missing from `main` is lost. This step is the only thing that saves them.

The **baseline** is the tag the last successful release pushed:

```bash
gh run list --workflow=release.yml --status=success --limit 1 --json headBranch --jq '.[0].headBranch'
```

List the differing files:

```bash
git status --short
for d in assets blocks config layout locales sections snippets templates; do
  diff -ruN "$sync_backup/remote-before/$d" "$d"
done
```

Editor edits land in `config/settings_data.json`, `templates/*.json` and the section-group JSON in `sections/`. Label every differing file against `git show <baseline>:<file>`:

- **Store-changed**: the remote copy differs from the baseline and the local one matches it. Copy exactly that file from `remote-before` into the worktree.
- **Local-changed**: the local copy differs and the remote matches. It is part of the release; leave it.
- **Both**: neither matches, or there is no baseline yet. Stop, show the diff, and let the user choose the result. The recovery directory is the source for that merge.

Copy files one by one: a full `theme:pull:production` into the worktree reverts every local change in the release and deletes local-only files.

Show the user the resulting `git diff` and wait for them to ask for a commit. Done when the worktree is clean and re-running the diff loop shows only local-changed files.

## 3. Tag the release

Preconditions, each checked by command: worktree clean, on `main`, `git fetch origin` then `HEAD` equal to `origin/main`. If `main` is ahead, ask the user before pushing it.

Name the tag `release-YYYY.MM.DD` with today's date, adding `.2`, `.3` for further releases that day (`git tag --list 'release-*'`). Write an annotated tag whose message lists the commit subjects since the baseline, or `First pipeline release` when there is none:

```bash
git tag -a release-2026.10.04 -m "$(git log --format='- %s' <baseline>..HEAD)"
git push origin release-2026.10.04
```

## 4. Watch the pipeline

```bash
gh run list --workflow=release.yml --branch <tag> --json databaseId,status
gh run view <run-id> --json status,jobs
```

When `check` passes, the run waits on the `production` gate. Tell the user to approve it in the run's GitHub page; approval is theirs alone. Then poll `gh run view`, or run `gh run watch <run-id>` in the background, until the run completes. A failed `check` means fixing on `main` and tagging again with the next suffix.

## 5. Verify the live theme

After `deploy` succeeds, pull the live theme into the same recovery directory and compare it with the tagged source:

```bash
mkdir -p "$sync_backup/remote-after" "$sync_backup/tagged"
cp shopify.theme.toml "$sync_backup/remote-after/"
npm run theme:pull:production -- --path "$sync_backup/remote-after" --nodelete
git archive <tag> | tar -x -C "$sync_backup/tagged"
for d in assets blocks config layout locales sections snippets templates; do
  diff -ruN "$sync_backup/remote-after/$d" "$sync_backup/tagged/$d"
done
```

Done when the diff is empty, or every remaining difference is explained to the user. The run also keeps a `remote-before-<tag>` artifact: the live theme as the pipeline found it.

## Pull only

To bring editor edits into the repository without releasing, run steps 1 and 2 and stop once the reconciled diff is in front of the user.

## Recovery

Keep every recovery directory. To restore local files, first preserve the current worktree in a new recovery directory, then copy selected files from `local-before` or `remote-before`. To roll back the live theme, tag the last good commit as a new release (`git tag -a <name> <commit>`), so the restore passes the same gate.
