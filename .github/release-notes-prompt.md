# Release notes prompt

Write the release notes for one release of the Mionas Bakery Shopify theme. The step's prompt gives
you the release tag, the release kind (`normal` or `first`) and the commit range.

## Read the commits

Run `git log --first-parent --format='%h %s%n%n%b' <commit range>`. Use `git show --stat <hash>` or
`git diff --stat` only when a message alone doesn't make the change clear.

Commits follow one convention: an imperative subject with no type prefix (no `feat:` or `fix:`), and
a body that explains what changed and why. Group commits by what they changed, and take the reason
from the body.

A merge of `upstream` (Shopify's Horizon theme) is one change. Describe it as `Updated to Horizon
X.Y`, reading the version and any customer-visible items from that merge's change to
`release-notes.md` (`git diff <hash>^1 <hash> -- release-notes.md`). Never list Shopify's own
commits.

## Write the two lists

`store_changes` is for the bakery team. List only what a customer or the team would notice on the
website. Write plain English with "we", short and direct, one sentence per item. Name no files,
blocks or code. Join an action and its detail with a word like "so", "when" or "and", never with a
colon. When nothing in the range is visible on the website, return the single item
`No visible changes in this release.`

`technical_changes` is the record. Give one item per first-parent commit, its subject followed by
its short hash in parentheses, for example `Hide newsletter signups once the visitor subscribes
(643ff46)`. For an upstream merge use `Updated to Horizon X.Y (<hash>)`.

State only what the commits support. When a commit's effect is unclear, leave it out of
`store_changes` rather than guess; it still appears in `technical_changes`.
