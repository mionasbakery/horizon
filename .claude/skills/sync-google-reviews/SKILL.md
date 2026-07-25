---
name: sync-google-reviews
description: Pull Google reviews from the Business Profile API into Shopify metaobjects so the storefront's "Mionas: Google reviews" section shows current reviews. Use when the user asks to sync, refresh, update or pull Google reviews, when the reviews on the site look stale, or when the review count or average rating shown on the storefront no longer matches Google.
---

# Sync Google reviews

Pulls reviews from the Google Business Profile API and creates Shopify metaobjects for any that
aren't already stored, so `sections/mionas-google-reviews.liquid` has fresh reviews to show.

## Absolute rules

1. **Never retype review text.** Review content flows `curl` → `jq` → GraphQL variables as data.
   Transcribing it by hand corrupts quotes, drops entries, and mangles emoji. If you catch yourself
   about to type a review's words, stop and pipe instead.
2. **This sync is create-only. It never deletes anything, and never rewrites an existing review.**
   There is no deletion capability anywhere in this skill — not automatic, not confirmed, not as a
   follow-up. It queries which fetched `review_id`s are not already stored, and creates *only* those,
   with `metaobjectCreate`, never `metaobjectUpsert`. An already-stored `review_id` is skipped as a
   pure no-op: it is never read for writing and never touched. This has a direct, deliberate
   consequence worth stating plainly: because existing entries are never written to, the merchant's
   per-review `enabled` toggle (see rule 4) can never be clobbered by a re-sync — that is the *point*
   of create-only, not an accident of it. Because no review is ever deleted or overwritten, this
   sync's worst failure mode is a missing review that a later run picks up — never a lost one. The
   one and only thing this skill ever overwrites is the single derived `google_review_summary` entry
   at handle `default` (Step 6), which is aggregate data, not review content.
3. **Never print secrets.** Read `.env.local` values into shell variables; never echo them. This
   includes the OAuth access token: never `echo` it, never write it to a file, never pass it through
   a step's printed output. See Step 3 for how it is carried between steps instead.
4. **New entries get `enabled: true` at creation and that field is never written again afterward.**
   `enabled` is a boolean field on the `google_review` metaobject definition that lets the merchant
   hide a review from the storefront without deleting it. This skill sets it once, on create, and
   never touches it on any later run — that field is the merchant's alone once set. (The metaobject
   definition itself and any seed backfill for pre-existing entries are handled elsewhere, not by
   this skill — this skill only ever relies on the field already existing.)
5. **Every mutating call re-checks its own input file immediately before it fires**, rather than
   trusting a count or an earlier abort remembered from a previous step. See "Site guard" below.

## Step 1 — Load credentials

Read `.env.local` from the repo root. If it is missing, or any of `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GBP_ACCOUNT_ID`, `GBP_LOCATION_ID` is empty, stop
and name exactly which are missing. Make no network call.

Then point at the right remedy for *which* group is missing — they have different fixes:

- **`GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` missing** — these cannot be automated. They come
  from a **Desktop app** OAuth client the user creates by hand in the Google Cloud Console, plus
  Business Profile API access approval, which is human review at Google and can take days. Give them
  the console steps (`scripts/gbp-auth.mjs` prints the same list when it hits this case) and tell
  them to `cp .env.local.example .env.local` and paste the two values in.
- **Only `GOOGLE_REFRESH_TOKEN`, `GBP_ACCOUNT_ID` or `GBP_LOCATION_ID` missing** — these *are*
  automated. Tell the user to run `npm run gbp:auth` (or `node scripts/gbp-auth.mjs`) **in a real
  terminal**. Typing `! npm run gbp:auth` inline in this session works only when the Google account
  has exactly one business account and one location: with more than one the script prompts on stdin
  to pick, and a runner with no TTY reads EOF and dies *after* consent was already granted, which is
  the confusing failure. A terminal is always safe, so recommend that first.

**You cannot run `gbp:auth` on the user's behalf, and must not try.** It opens Google's consent
screen in a browser and blocks until a human clicks through it; started as a normal tool call it
would simply hang until it timed out. It is a command the *user* runs. Stop and wait for them to say
it is done, then re-read `.env.local` and continue.

The script writes `GOOGLE_REFRESH_TOKEN` into gitignored `.env.local` and never prints it. That does
not conflict with Absolute Rule 3: the rule's subject is the *access* token, which is ephemeral and
must never reach disk anywhere in this skill. A refresh token is a stored credential and `.env.local`
is where it is supposed to live — that is what Step 2 and Step 3 read it from.

## Step 2 — Get an access token

```bash
set -a; . ./.env.local; set +a
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d client_id="$GOOGLE_CLIENT_ID" \
  -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d refresh_token="$GOOGLE_REFRESH_TOKEN" \
  -d grant_type=refresh_token | jq -r '.access_token // empty')
[ -n "$ACCESS_TOKEN" ] && echo "token ok" || echo "TOKEN FAILED"
```

If this prints `TOKEN FAILED`, the refresh token is expired or revoked. Stop and tell the user to
re-run the OAuth consent flow to mint a new one. Do not retry.

This step exists to fail fast and cheaply on bad credentials **before** any scratch directory or
fetch loop is set up. The token it mints is deliberately *not* carried into Step 3 — see the next
step for why.

## Step 3 — Fetch every page of reviews

`pageSize` maxes at 50, so paginate until `nextPageToken` is absent. Accumulate into one array, in a
fresh per-run scratch directory.

**On the working directory: there is no shared pointer file.** An earlier version of this skill
wrote the scratch directory's path to a fixed file (`/tmp/gbp-sync-workdir`) so later steps could
find it. That fixed path was itself exactly the kind of shared global `mktemp -d` was meant to
eliminate: concurrent run A hitting an error and cleaning up could delete run B's pointer while B was
still mid-flight. **Instead: the `mktemp -d` command below prints its path once. Carry that exact
path forward literally into every later step's `WORKDIR=...` line for the rest of this run — do not
write it to any shared file, and do not assume any later step can rediscover it on its own.** (This
removes the specific shared-pointer hazard that was found; it is not a claim that concurrent runs can
never interact at all in any way.)

**On the access token: Step 3 mints its own — do not try to reuse Step 2's, and do not "simplify"
this back out.** Every step of this skill runs as a *separate* tool call, so shell variables set in
one block do not exist in the next. `ACCESS_TOKEN=$(curl ...)` in Step 2 is gone by the time Step 3
runs, and the token is not in `.env.local`. An earlier version of this file assumed otherwise: Step 3
sent `Authorization: Bearer ` with an empty value, Google answered `401`, and Step 3's own guard
aborted — the sync failed safe but could never succeed. The obvious workaround, echoing the token
forward the way the workdir path is carried, is forbidden by Absolute Rule 3. Writing it to a file
instead would put a live bearer credential on disk that every one of this file's later `exit 1`
paths would have to remember to delete. So the rule is: **any block that needs the token mints it
itself, in the same block, and the value never leaves that block.** That is why the token exchange
appears twice in this file. It is four lines; leave them there.

Step 3's mint is not a retry of Step 2 (Step 2's "do not retry" still holds): if Step 2
printed `TOKEN FAILED` you stop there and never reach Step 3. A mint failure *here* aborts Step 3
immediately, before the fetch loop, with the scratch directory removed.

**A truncated fetch must never look like "no more pages" — and "badness" cannot be enumerated, so
this loop requires proof of goodness instead of testing for known-bad shapes.** A mid-pagination API
error, a `403`, a quota trip, a plain `curl` transport failure, an empty body, or a non-JSON body (an
HTML error page from a proxy/WAF, a truncated fragment, a captive-portal page) all make
`nextPageToken` absent for the same reason a real last page does. A check that only looks for
`has("error")` lets a non-JSON body straight through: `jq` exits non-zero (a parse error) on it, so
an `if jq -e 'has("error")'` test is *false* and falls into the "no error, keep going" branch. So the
guard below first demands the response parse as a JSON **object** at all — any failure to do so
(non-zero exit, whether "false" or "parse error") aborts — and only then checks for an `error` key,
which exists purely to give a clearer message; it is never the only gate.

These guards still matter even though this sync is create-only: a truncated fetch producing garbage
or partial entries would still create wrong or duplicate-ish data. The stakes are just lower than
they used to be — a bad fetch now means a missing or malformed review to retry, never a lost one.

```bash
set -a; . ./.env.local; set +a
BASE="https://mybusiness.googleapis.com/v4/accounts/$GBP_ACCOUNT_ID/locations/$GBP_LOCATION_ID/reviews"
WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/gbp-sync.XXXXXX")
echo "WORKDIR=$WORKDIR   <-- carry this exact path into every later step, literally"
# Mint the token in *this* block: shell variables do not survive between steps, and Absolute Rule 3
# forbids echoing it forward. Never echo "$ACCESS_TOKEN" — only whether it is empty.
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d client_id="$GOOGLE_CLIENT_ID" \
  -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d refresh_token="$GOOGLE_REFRESH_TOKEN" \
  -d grant_type=refresh_token | jq -r '.access_token // empty')
if [ -z "$ACCESS_TOKEN" ]; then
  echo "STOP: could not mint an access token in Step 3. Nothing was fetched, existing metaobjects are untouched."
  rm -rf "$WORKDIR"
  exit 1
fi
PAGE_TOKEN=""; PAGE_COUNT=0; ABORT=0
: > "$WORKDIR/pages.jsonl"
while :; do
  URL="$BASE?pageSize=50"
  [ -n "$PAGE_TOKEN" ] && URL="$URL&pageToken=$PAGE_TOKEN"
  RESP=$(curl -s -H "Authorization: Bearer $ACCESS_TOKEN" "$URL")
  # Proof of goodness, not detection of badness: any non-zero exit here — jq's "false" (1) or its
  # parse error (5) on an empty/HTML/truncated body — means "not a valid JSON object", full stop.
  if ! printf '%s' "$RESP" | jq -e 'type == "object"' > /dev/null 2>&1; then
    echo "SYNC ABORTED: page $((PAGE_COUNT+1)) response is not a well-formed JSON object (empty body, non-JSON body, or truncated JSON)."
    ABORT=1; break
  fi
  if printf '%s' "$RESP" | jq -e 'has("error")' > /dev/null 2>&1; then
    echo "SYNC ABORTED: API error on page $((PAGE_COUNT+1)):"
    printf '%s' "$RESP" | jq '.error'
    ABORT=1; break
  fi
  printf '%s\n' "$RESP" >> "$WORKDIR/pages.jsonl"
  PAGE_COUNT=$((PAGE_COUNT+1))
  PAGE_TOKEN=$(printf '%s' "$RESP" | jq -r '.nextPageToken // empty')
  [ -z "$PAGE_TOKEN" ] && break
done
if [ "$ABORT" -eq 1 ] || [ "$PAGE_COUNT" -eq 0 ]; then
  echo "STOP: do not proceed to Step 4. Existing metaobjects are untouched."
  rm -rf "$WORKDIR"
  exit 1
fi
# Guard the slurp itself: a parse failure here must be fatal, and a 0-byte output file must never
# be read downstream as "zero reviews" — only Step 4's explicit, populated-array check may say that.
if ! jq -s '[.[].reviews // []] | add' "$WORKDIR/pages.jsonl" > "$WORKDIR/reviews.json" \
   || [ ! -s "$WORKDIR/reviews.json" ]; then
  echo "STOP: failed to assemble the review pool from fetched pages. Existing metaobjects are untouched."
  rm -rf "$WORKDIR"
  exit 1
fi
jq -s '.[0] | {averageRating, totalReviewCount}' "$WORKDIR/pages.jsonl" > "$WORKDIR/summary.json"
RAW_COUNT=$(jq 'length' "$WORKDIR/reviews.json")
TOTAL=$(jq -r '.totalReviewCount // empty' "$WORKDIR/summary.json")
echo "raw fetched review count: $RAW_COUNT (Google reports totalReviewCount: ${TOTAL:-unknown})"
# Informational only, not a safety gate: this sync never deletes a review and never overwrites an
# existing one (the derived summary in Step 6 is the sole intentional overwrite, and it is rewritten
# from this same fetch either way), so a short fetch is merely incomplete, not destructive — a note
# for the report in Step 7 —
# not an abort condition. (An earlier design used this comparison to gate a deletion step; that
# gate no longer exists, so this comparison no longer needs to block anything.)
if [ -n "$TOTAL" ] && [ "$RAW_COUNT" -lt "$TOTAL" ]; then
  echo "NOTE: fetched $RAW_COUNT of the $TOTAL reviews Google reports for this location. This run may be missing some; a later re-run will pick up anything new that was actually missed, since re-running is always safe (create-only)."
fi
```

If the pagination loop prints `SYNC ABORTED` or `STOP`, or exits non-zero, the whole sync is over —
do not run Step 4 or any later step. Nothing has been written yet, so the storefront is unaffected. A
`403` with `PERMISSION_DENIED`, or a quota of 0 QPM, means Business Profile API access has not been
approved yet — say so plainly. Read the quota in Google Cloud Console to confirm: 0 QPM means not
approved, 300 QPM means approved.

The `PAGE_COUNT -eq 0` check also covers the case where the very first request fails outright —
without it, "zero pages fetched" and "zero reviews on Google" would be indistinguishable, and the
former must never be treated as the latter.

## Step 4 — Transform

`CLEAN_COUNT` must be treated as failure unless it is literally a non-negative integer — a blank
result (transform produced invalid/no output) is **not** the number zero, and must not be read as
one. **The transform and the check live in one block on purpose**: they were once two fenced blocks,
and since each block may run as its own tool call, `CLEAN_COUNT` would have been unset by the time
the check ran, silently taking the "invalid" branch. Do not split them.

```bash
WORKDIR="<the literal path Step 3 printed>"
jq -f .claude/skills/sync-google-reviews/transform.jq \
  "$WORKDIR/reviews.json" > "$WORKDIR/clean.json"
CLEAN_COUNT=$(jq 'length' "$WORKDIR/clean.json" 2>/dev/null)
case "$CLEAN_COUNT" in
  ''|*[!0-9]*)
    echo "STOP: could not determine the clean pool size (transform produced invalid or empty output). Existing metaobjects are untouched."
    exit 1
    ;;
esac
if [ "$CLEAN_COUNT" -eq 0 ]; then
  echo "STOP: no review passed the filters. Nothing to create this run."
  exit 1
fi
echo "clean pool size: $CLEAN_COUNT"
```

If you change `transform.jq`'s rules, re-run the pipeline against a real API response and eyeball the
output before creating anything — there is no test suite in this theme.

## Site guard — run immediately before creating anything

Steps 5 and 6 each call a GraphQL mutation. **Immediately before each mutating call**, revalidate the
exact file that call is about to read from — do not rely on a count or a check remembered from an
earlier step:

Both lines below are placeholders you must fill in before running the block. **`POOL_FILE` is a
literal assignment, not `$1`** — this guard is pasted into a bash tool call, not invoked as a script
with arguments, so a positional parameter would always be empty and the guard would refuse every
time (and, worse, teach the next reader to ignore it).

```bash
WORKDIR="<the literal path carried from Step 3>"
POOL_FILE="$WORKDIR/to-create.json"   # Step 5. In Step 6 use "$WORKDIR/summary.json" instead.
[ -f "$POOL_FILE" ] || { echo "REFUSED: $POOL_FILE does not exist."; exit 1; }
jq -e 'type == "array" or type == "object"' "$POOL_FILE" > /dev/null 2>&1 || { echo "REFUSED: $POOL_FILE is not well-formed JSON."; exit 1; }
if jq -e 'type == "array"' "$POOL_FILE" > /dev/null 2>&1; then
  [ "$(jq 'length' "$POOL_FILE" 2>/dev/null)" -gt 0 ] 2>/dev/null || { echo "REFUSED: $POOL_FILE is an empty array."; exit 1; }
fi
```

If this guard ever refuses, stop — do not fall back to a remembered count, do not retype the data by
hand, and do not proceed to the mutation it was guarding.

## Step 5 — Create only the reviews that aren't already stored

**The existing-entry enumeration must be complete or the run must abort. There is no third option.**
An incomplete list of stored `review_id`s does not fail loudly — it makes already-stored reviews look
new, and this step then creates duplicates of them, up to 25 per run (transform.jq's curation cap),
compounding on every re-run.
Since nothing here ever deletes, duplicates are permanent until someone removes them by hand. A
single `first: 250` with no cursor is therefore *not* acceptable: past 250 stored entries it
truncates silently, and if Shopify returns oldest-first the newest reviews are exactly the ones that
get dropped and re-created.

1. Enumerate **every** stored `google_review` with a real cursor loop, using
   `mcp__claude_ai_Shopify__graphql_query`:

```graphql
query ExistingReviews($cursor: String) {
  metaobjects(type: "google_review", first: 250, after: $cursor) {
    nodes {
      id
      field(key: "review_id") { value }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

   Run it first with `{"cursor": null}`. After each response:
   - Append every `nodes[].field.value` to `$WORKDIR/existing-ids.txt`, one per line, and add that
     page's `nodes` count to a running total.
   - If `pageInfo.hasNextPage` is `true`, run the query again with `{"cursor": "<endCursor>"}` and
     repeat. Keep going until `hasNextPage` is `false`. Do not stop early, do not cap the number of
     pages, and do not assume one page is enough because the store "probably" has few reviews.
   - If any page returns GraphQL `errors`, or a node's `field` is `null` or its `value` is empty,
     **abort the whole step**: an entry with no readable `review_id` cannot be matched against the
     fetched pool, so it would be re-created as a duplicate. Report it and stop; create nothing.

2. Optionally, for context only, ask the store what it reports as a definition-level count:

```graphql
query StoredReviewCount {
  metaobjectDefinitionByType(type: "google_review") {
    metaobjectsCount
  }
}
```

   **`metaobjectsCount` is not a reliable count of stored entries — never gate anything on it.**
   Verified live against this store: enumerating `metaobjects(type: "google_review")` returned 6
   nodes while `metaobjectDefinitionByType(type: "google_review") { metaobjectsCount }` returned
   `1`, reproduced twice. An earlier version of this step aborted unless the two agreed, which meant
   the sync refused on every single run and never created anything. That gate has been removed on
   purpose. Do not reinstate it. The completeness guarantee this step actually relies on is the pair
   below, both of which are hard aborts and must stay that way: the cursor loop having ended on
   `hasNextPage: false` (recorded by the `enumeration-complete` sentinel), and `LINES == NODES_SEEN`.

3. Only after the loop has ended on `hasNextPage: false`, record the enumeration as complete —
   substituting the running node total you counted above (and `metaobjectsCount` if you ran the
   query; leaving that placeholder in is fine — the comparison is skipped, never an abort):

```bash
WORKDIR="<the literal path carried from Step 3>"
NODES_SEEN="<replace with the total node count you summed across every page above>"
DEFINITION_COUNT="<optionally replace with metaobjectsCount; leave as-is to skip the comparison>"
case "$NODES_SEEN" in
  ''|*[!0-9]*) echo "REFUSED: NODES_SEEN must be a number — you left the placeholder in. Nothing was created."; exit 1 ;;
esac
# Advisory only. metaobjectsCount is not a dependable entry count (see above), so a mismatch prints
# a note and the run continues; a missing or non-numeric value simply skips the comparison.
case "$DEFINITION_COUNT" in
  ''|*[!0-9]*)
    echo "NOTE: no numeric metaobjectsCount supplied — skipping the advisory count comparison."
    ;;
  *)
    if [ "$NODES_SEEN" -ne "$DEFINITION_COUNT" ]; then
      echo "NOTE: walked $NODES_SEEN entries; the definition reports metaobjectsCount=$DEFINITION_COUNT. These are known to disagree and metaobjectsCount is not trustworthy — continuing. The real completeness checks are hasNextPage: false and LINES == NODES_SEEN below."
    fi
    ;;
esac
# A store with zero stored reviews yields no file at all; the diff below must still see an empty
# list rather than a missing one, or every fetched review would silently drop out of the create set.
touch "$WORKDIR/existing-ids.txt"
# awk, not `grep -c . || echo 0`: grep exits 1 on an empty file, so the `||` fired and produced the
# two-line value "0\n0", which made the comparison below error out and fall through to the *success*
# branch. Fail-closed counting only.
LINES=$(awk 'NF { c++ } END { print c + 0 }' "$WORKDIR/existing-ids.txt")
case "$LINES" in
  ''|*[!0-9]*) echo "REFUSED: could not count the enumerated review_id lines. Nothing was created."; exit 1 ;;
esac
if [ "$LINES" -ne "$NODES_SEEN" ]; then
  echo "REFUSED: enumerated $NODES_SEEN existing entries but only $LINES readable review_id lines. Refusing to diff against an incomplete list — it would create duplicates. Nothing was created."
  exit 1
fi
echo done > "$WORKDIR/enumeration-complete"
echo "existing stored reviews enumerated: $LINES"
```

   Write `enumeration-complete` **only** when the cursor loop reached `hasNextPage: false`. If you
   aborted, or bailed out of the loop for any reason, do not write it — the next block refuses
   without it, which is the point.

4. Compute which fetched, cleaned reviews are genuinely new. The completeness sentinel is checked in
   this same block, immediately before the diff, so it cannot be skipped; `CLEAN_COUNT` is
   recomputed here rather than carried from Step 4, because Step 4's shell variables do not exist in
   this tool call:

```bash
WORKDIR="<the literal path carried from Step 3>"
[ -f "$WORKDIR/enumeration-complete" ] || { echo "REFUSED: the existing-entry enumeration did not run to completion. Diffing against a partial list would create duplicates. Nothing was created."; exit 1; }
CLEAN_COUNT=$(jq 'length' "$WORKDIR/clean.json" 2>/dev/null)
touch "$WORKDIR/existing-ids.txt"
# Trim whitespace on BOTH sides of the comparison. existing-ids.txt is transcribed from GraphQL
# output by hand, so a stray CR or trailing space would otherwise make an already-stored review look
# new and get re-created. The same trim is applied to the fetched ids below.
jq -R -s '[split("\n")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)]' "$WORKDIR/existing-ids.txt" > "$WORKDIR/existing-ids.json" \
  || { echo "REFUSED: could not read the existing-id list. Nothing was created."; exit 1; }
# The fetched side needs the same non-empty review_id guard as the stored side. transform.jq copies
# `review_id: .reviewId` through without checking it, so a raw review missing `reviewId` yields
# review_id: null here — and `index(null)` is null, so `| not` is true and that entry would be
# "new" on every single run, forever. Drop such entries before the diff and say so out loud.
BAD_IDS=$(jq '[.[] | select(((.review_id // "") | gsub("^\\s+|\\s+$"; "")) == "")] | length' "$WORKDIR/clean.json" 2>/dev/null)
case "$BAD_IDS" in
  ''|*[!0-9]*) echo "REFUSED: could not check the fetched reviews for missing review_ids. Nothing was created."; exit 1 ;;
esac
if [ "$BAD_IDS" -gt 0 ]; then
  echo "NOTE: $BAD_IDS fetched review(s) have no review_id and are being skipped — without an id they cannot be deduplicated and would be re-created on every run. Report this; it means Google returned a review without a reviewId."
fi
jq --slurpfile existing "$WORKDIR/existing-ids.json" \
  '[.[] | select(((.review_id // "") | gsub("^\\s+|\\s+$"; "")) != "") | select(((.review_id // "") | gsub("^\\s+|\\s+$"; "")) as $id | ($existing[0] | index($id)) | not)]' \
  "$WORKDIR/clean.json" > "$WORKDIR/to-create.json" \
  || { echo "REFUSED: could not compute the new-review diff. Nothing was created."; exit 1; }
TO_CREATE_COUNT=$(jq 'length' "$WORKDIR/to-create.json" 2>/dev/null)
# Same rule as CLEAN_COUNT in Step 4: a blank result is a failure, never the number zero.
case "$TO_CREATE_COUNT" in
  ''|*[!0-9]*) echo "REFUSED: could not determine how many reviews are new. Nothing was created."; exit 1 ;;
esac
echo "new reviews to create: $TO_CREATE_COUNT (of ${CLEAN_COUNT:-?} fetched-and-cleaned this run)"
# Storefront visibility ceiling. Liquid's metaobjects.google_review.values reads at most 50 entries,
# oldest-created-first, and this sync never deletes — so anything past slot 50 is invisible on the
# storefront until an operator prunes. Warn loudly, but never abort: creating them is still better
# than losing them, and they become visible the moment old entries are pruned. See "Housekeeping".
STORED_NOW=$(jq 'length' "$WORKDIR/existing-ids.json" 2>/dev/null)
case "$STORED_NOW" in
  ''|*[!0-9]*) echo "REFUSED: could not count the currently stored entries. Nothing was created."; exit 1 ;;
esac
PROJECTED_TOTAL=$((STORED_NOW + TO_CREATE_COUNT))
if [ "$PROJECTED_TOTAL" -gt 50 ]; then
  echo "*** WARNING: STORAGE EXCEEDS THE STOREFRONT'S 50-ENTRY CEILING ***"
  echo "After this run the store will hold $PROJECTED_TOTAL google_review entries ($STORED_NOW stored + $TO_CREATE_COUNT new)."
  echo "Liquid reads only the oldest 50, so $((PROJECTED_TOTAL - 50)) entr(y/ies) will be INVISIBLE on the storefront."
  echo "Switching 'enabled' off does NOT free a slot — that filter runs after the 50-entry read."
  echo "ACTION REQUIRED: prune the oldest google_review entries in the Shopify admin until the total is 50 or fewer."
  echo "Continuing anyway — creating them is better than losing them; they become visible once you prune."
else
  echo "storefront capacity ok: $PROJECTED_TOTAL of 50 entries after this run."
fi
```

5. **Print the list before creating anything**: for each entry in `$WORKDIR/to-create.json`, print
   its `review_id`, `author`, `rating`, and a short excerpt (first ~60 characters) of `comment`, so
   the user can see what is about to arrive. No confirmation prompt is required before proceeding —
   adding reviews is non-destructive — but show the list regardless so the user isn't surprised.

6. If `TO_CREATE_COUNT` is `0`, stop here: report "0 new reviews — everything Google returned this
   run is already stored" and skip straight to Step 6. This is a normal, successful outcome, not an
   error; **no mutation of any kind runs in this case.**

7. Otherwise, run the site guard above against `$WORKDIR/to-create.json`, then for each object in
   that file call `mcp__claude_ai_Shopify__graphql_mutation` with the values read from the file —
   never retyped:

```graphql
mutation Create($metaobject: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $metaobject) {
    metaobject { handle }
    userErrors { field message code }
  }
}
```

   `$metaobject` is `{ "type": "google_review", "handle": "<handle>", "fields": [ {"key": ...,
   "value": ...}, ... ] }` — on `MetaobjectCreateInput` the handle is a **plain string**, and every
   field `value` is a **string**. (Re-check with `mcp__claude_ai_Shopify__graphql_schema` on
   `MetaobjectCreateInput` if a future API version disagrees.) The handle is `review_id` lowercased with every
   non-alphanumeric character replaced by `-`, then stripped of any leading/trailing `-` left behind
   by that substitution. Fields: `review_id`, `rating` (as a string), `comment`, `author`,
   `created_at`, and **`enabled: "true"`** — set once, here, at creation, and never again by this
   skill (Absolute Rule 4).

   **Track failures as you go**: a running count of creates that returned any `userErrors`, and which
   `review_id` each failure belongs to. Keep creating the rest of the batch — one bad review must not
   block reviews that would otherwise succeed. Report any `userErrors` rather than continuing
   silently.

Because Step 5 only ever creates brand-new `review_id`s and never reads or writes an existing entry,
there is no code path here that touches, let alone deletes, anything already stored.

## Step 6 — Upsert the summary

Run the site guard above against `$WORKDIR/summary.json` (`POOL_FILE="$WORKDIR/summary.json"`), then
run the block below.

**Both summary values must be present and non-null before anything is written.** `jq -s '.[0] |
{averageRating, totalReviewCount}'` in Step 3 always emits both keys, so `summary.json` can perfectly
legitimately be `{"averageRating":null,"totalReviewCount":null}` — a well-formed JSON object that the
site guard happily passes, because that guard only checks shape and array length. Writing that would
overwrite the live storefront's real rating and count with nulls and visibly break the summary line.
So the presence check is here, not there:

```bash
WORKDIR="<the literal path carried from Step 3>"
AVG=$(jq -r '.averageRating // empty' "$WORKDIR/summary.json" 2>/dev/null)
TOTAL=$(jq -r '.totalReviewCount // empty' "$WORKDIR/summary.json" 2>/dev/null)
if [ -z "$AVG" ] || [ -z "$TOTAL" ]; then
  echo "REFUSED: summary.json is missing averageRating and/or totalReviewCount (null or absent). Not writing the summary — it would replace the live rating and count with nulls."
  echo "Any reviews created in Step 5 stay created; this refusal does not undo them. Go to Step 7, clean up, and report this."
  exit 1
fi
echo "summary to write: average_rating=$AVG total_count=$TOTAL"
```

If it refuses, do **not** retro-abort the run: Step 5's creates have already fired and are correct.
Skip the upsert, go straight to Step 7, clean up, and report the refusal — the storefront keeps its
previous summary, which is the right outcome.

Otherwise upsert `google_review_summary` at handle `default`:

```graphql
mutation UpsertSummary($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject { id handle }
    userErrors { field message code }
  }
}
```

Variables: `$handle` is `{ "type": "google_review_summary", "handle": "default" }` and `$metaobject`
is `{ "fields": [ {"key": "average_rating", "value": "<AVG>"}, {"key": "total_count", "value":
"<TOTAL>"}, {"key": "profile_url", "value": "<the location's Maps URL>"}, {"key": "synced_at",
"value": "<current UTC timestamp>"} ] }`. All values are strings. (Consult
`mcp__claude_ai_Shopify__graphql_schema` on `MetaobjectUpsertInput` if unsure.)

**The handle is not optional.** `metaobjectUpsert` with the `default` handle is what makes this
overwrite the one existing summary entry. Do not substitute `metaobjectCreate`, and do not omit the
handle: either one silently creates a *second* summary metaobject, after which the storefront reads
whichever one it happens to get. If a run ever produces two, that is the bug.

This one entry is derived, aggregate data, not an individual review — overwriting it on every run is
correct and is the one place in this skill an upsert (rather than a create) belongs. Add any
`userErrors` here to the failure count from Step 5 and report them.

The count is Google's real total across **all** reviews, not the size of the synced pool — those
differ, and that is correct.

## Step 7 — Clean up and report

Remove this run's scratch directory (the literal path again — it is not in a variable in this tool
call):

```bash
WORKDIR="<the literal path carried from Step 3>"
rm -rf "$WORKDIR"
```

Then report: how many new reviews were
created (and list any that failed with `userErrors`); the new average and total from the summary; and
the pool size now in the metaobjects. If Step 3 printed a fetch-count `NOTE`, repeat it so the user
knows this run may not have seen every review Google has.

Remind the user that the storefront rotates which reviews appear once per day — three to five of
them, whichever the section's `review_count` setting is currently set to — so the page will not
change the instant the sync finishes.

If the block in Step 5 printed the 50-entry ceiling warning, repeat it here prominently: it is an
action the operator must take in the Shopify admin, and nothing in this skill will do it for them.

## Housekeeping — operator tasks this skill cannot do

This skill is create-only. It has no deletion capability of any kind, by deliberate design (Absolute
Rule 2). Two consequences need a human in the Shopify admin.

### The 50-entry storefront ceiling vs. the 25-entry curation cap

Two different numbers matter here, and they mean different things:

- **50 is the platform ceiling.** `metaobjects.google_review.values` in Liquid iterates **at most 50
  entries**, oldest-created-first. This is a hard limit of Shopify Liquid and cannot be changed by
  this skill or anyone else — it is where stored reviews actually become invisible on the storefront.
- **25 is the curation cap.** `transform.jq` keeps at most 25 reviews per *run* — a deliberate choice,
  not a technical limit, made to leave 25 slots of headroom below the 50-entry ceiling (so the first
  new review after a full sync doesn't immediately push something out of view) and to halve the
  metaobject reads per page render. It is a per-run cap, not a cumulative one: because nothing ever
  trims, stored entries accumulate across runs and everything past slot 50 (the platform ceiling, not
  the curation cap) becomes permanently invisible to the storefront.

So **"total stored `google_review` entries ≤ 50" is an operational requirement the operator
maintains — the system does not enforce it.** The earlier design enforced it with a reconciliation
step that deleted entries absent from the fetched pool; that step was removed when the sync became
create-only, and nothing replaced it.

**Switching `enabled` off does not free a slot.** The `enabled` filter runs in Liquid *after* the
50-entry read, so a disabled entry still consumes one of the 50. Disabling controls visibility of an
entry that was already read; it does not make room for a 51st.

**How to prune:** in the Shopify admin, go to Content → Metaobjects → Google review, sort or scan
for the oldest entries, and delete them until the total is 50 or fewer. Prefer deleting the oldest,
since those are the ones the storefront would otherwise waste its 50 slots on. Deleted reviews that
Google still returns will simply be re-created by the next sync, so pruning is safe and reversible —
which is exactly why deletion lives with the operator and not in this skill.

### Go-live: remove the seed entries

The store was bootstrapped with six placeholder entries, handles `seed-1` … `seed-6`, whose
`comment` reads `SEED N — reseña de prueba, no es real.` They are not real reviews, they would be
served to real customers, and they consume six of the fifty visible slots. **This sync cannot delete
them.**

Before, or immediately after, the first real sync:

1. In the Shopify admin, go to Content → Metaobjects → Google review.
2. Delete `seed-1`, `seed-2`, `seed-3`, `seed-4`, `seed-5` and `seed-6`.
3. Verify no entry remains whose `comment` begins with `SEED `. If any does, delete it too.

Until this is done the storefront can show fake reviews to customers. Treat it as part of going
live, not as cleanup to get to later.

### Display order is creation order, not newest-first

`created_at` is stored on every entry, but **nothing reads it for ordering.** The section does not
sort, and Liquid cannot sort its way out of the 50-entry truncation anyway (the truncation happens
before any filter or sort you could write). `transform.jq` does sort by `updateTime` descending, but
that only decides *which* reviews a given run creates — never the order they are displayed in.

The effective display order is therefore **pure metaobject creation order**, oldest-created-first,
which is the order the day-of-year rotation walks. Do not assume reviews appear newest-first, and do
not add sorting to the section expecting to fix it. `created_at` is kept because it is real upstream
data worth storing, not because anything renders from it.
