---
name: mionas-release
description: Release the theme to the live store by tagging it for the release pipeline, tag a release candidate for the staging theme, or pull editor edits from the live theme.
disable-model-invocation: true
---

# Mionas Release

A release is a `YYYY.MM.DD` tag on `main`. Pushing it starts `.github/workflows/release.yml`, which runs Theme Check, waits at the `production` environment's manual gate, pushes the tagged commit to the live theme, then publishes a GitHub release from the tag message. A release candidate is the same tag with an `-rc.N` suffix: `.github/workflows/release-candidate.yml` pushes it to the unpublished `horizon/staging` theme, with no gate, for review through its preview link. This skill reconciles, tags and watches, and leaves the pushes to the pipeline. For a direct push without the pipeline's gate, the user runs `/mionas-live-theme` instead.

Read `shopify.theme.toml`, `package.json` and both workflows first. Every local transfer goes through `npm run theme:pull:production`, which selects the pinned production theme ID.

The local `gh` default repository resolves to `upstream` (`Shopify/horizon`), so pass `-R mionasbakery/horizon` to every `gh` command.

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
gh run list -R mionasbakery/horizon --workflow=release.yml --status=success --limit 1 --json headBranch --jq '.[0].headBranch'
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

Name the tag `YYYY.MM.DD` with today's date, adding `.2`, `.3` for further releases that day; `git tag --list '[0-9]*'` shows the names taken, and `-rc.N` tags don't count. The `production` environment and the trigger in `release.yml` only accept `????.??.??` and `????.??.??.?`, so a tenth release in a day needs both widened first.

Write the tag message in three parts, from the commit subjects and the diff since the baseline:

1. A release name of a few plain words saying what changes for the store, such as `Newsletter popup opens on idle, customer details in analytics`. It becomes the GitHub release title after the tag.
2. After a blank line, a short paragraph of one to three sentences saying what a shopper or the team will notice.
3. After a blank line, the changelog: `git log --format='- %s' <baseline>..HEAD`, or `- First pipeline release` when there is no baseline.

Show the message to the user and wait for approval before tagging. Write it to a file in the scratchpad so the blank lines survive:

```bash
git tag -a 2026.10.06 -F <message-file>
git push origin 2026.10.06
```

### Release candidate

To review a release on the staging theme first, tag the same message as `YYYY.MM.DD-rc.1`, with the date of the planned release and the next free `rc.N`. The run deploys without a gate. Give the user the preview link `https://mionasbakery.myshopify.com?preview_theme_id=209356521803`. The staging theme keeps its own editor settings, so pushes overwrite them with the repository's and it can differ from the live theme's. A fix on `main` gets the next `rc.N`. Once the user approves the candidate, tag its commit `YYYY.MM.DD` with the same message (`git tag -a <name> <rc-tag>^{} -F <message-file>`) and continue with step 4.

## 4. Watch the pipeline

```bash
gh run list -R mionasbakery/horizon --workflow=<release.yml|release-candidate.yml> --branch <tag> --json databaseId,status,url
gh run view <run-id> -R mionasbakery/horizon --json status,jobs
```

When `check` passes, the run waits on the `production` gate. Tell the user to approve it in the run's GitHub page; approval is theirs alone. Then poll `gh run view`, or run `gh run watch <run-id>` in the background, until the run completes. A failed `check` means fixing on `main` and tagging again with the next suffix. A release candidate's run has no gate and ends after the staging push.

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

Done when the diff is empty, or every remaining difference is explained to the user, and `gh release view <tag> -R mionasbakery/horizon` shows the release with its name and notes. The run also keeps a `remote-before-<tag>` artifact: the live theme as the pipeline found it.

## Pull only

To bring editor edits into the repository without releasing, run steps 1 and 2 and stop once the reconciled diff is in front of the user.

## Recovery

Keep every recovery directory. To restore local files, first preserve the current worktree in a new recovery directory, then copy selected files from `local-before` or `remote-before`. To roll back the live theme, tag the last good commit as a new release (`git tag -a <name> <commit>`), so the restore passes the same gate.
