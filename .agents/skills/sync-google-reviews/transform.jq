# Filters and shapes Google Business Profile reviews for storage in Shopify metaobjects.
#
# Input:  a JSON array of raw review objects, accumulated across all pages of
#         accounts.locations.reviews.list.
# Output: a JSON array of {review_id, rating, comment, author, created_at}.
#
# This file exists rather than living inline in SKILL.md so the program is versioned on its own and
# can be run and inspected directly, without copying it out of prose.
#
# Rules, each with a reason:
#   - starRating arrives as an enum string, not a number.
#   - Reviews may carry a rating with no comment; those would render as empty cards.
#   - Only 4- and 5-star reviews are stored. This is a curation choice, not a technical limit --
#     the summary line still reports the true average across every review.
#   - Anonymous reviewers have no displayName.
#   - Capped at 25 (curation cap): Liquid's metaobjects.<type>.values loops at most 50 entries
#     (the immovable platform ceiling). Storing exactly 50 would put every sync one review away
#     from pushing something out of view, so 25 is kept instead -- 25 slots of headroom below the
#     ceiling, and half the metaobject reads per page render, at the cost of a faster review cycle.
#   - A review with no updateTime has no valid sort key and would land in the output as a
#     Shopify metaobject date_time field set to null, so it is dropped rather than passed through.

def rating_to_int:
  {"ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5}[.] // 0;

[
  .[]
  | select(((.comment // "") | gsub("\\s"; "") | length) > 0)
  | {
      review_id:  .reviewId,
      rating:     (.starRating | rating_to_int),
      comment:    .comment,
      author:     (.reviewer.displayName // "Cliente de Google"),
      created_at: .updateTime
    }
  | select(.rating >= 4 and .created_at != null)
]
| sort_by(.created_at)
| reverse
| .[0:25]
