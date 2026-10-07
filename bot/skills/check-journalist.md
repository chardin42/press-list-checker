---
description: Use when checking whether a journalist is still at the outlet on the press list, including which public pages to open and how to choose a verdict.
---

# Check one journalist

Call `claim_check_batch` first. Research only the people in `research`. Do them one at a time. After each person, call `save_verdict` before opening the next.

## What to open

Search the public web, then fetch the pages that name this person. Cover four surfaces:

1. **Bylines.** Search `"First Last" "Outlet"` and recent articles. A byline counts when the page names this person as the author at a newsroom.
2. **Staff pages.** Search the outlet's staff, masthead, or author page.
3. **LinkedIn.** Search the public profile. A login wall is not a job title. Record the URL if you find one, and say you could not read it.
4. **X.** Search the public X profile and recent posts. A login wall is not a job title.

A source counts only when it identifies this person. If several people share the name, the page has to tie them to this outlet or beat. Otherwise the verdict is Uncertain.

You do not need all four kinds when a surface has nothing public. Record the pages you actually used.

## Verdict

Use exactly one label:

- **Still there.** A current staff or masthead page lists them at this outlet, or they have a byline there in roughly the last 18 months and nothing shows they left.
- **Moved.** They still work in journalism (reporting, editing, producing, newsletters, a newsroom) at a different outlet. Name the new outlet in the note.
- **Left journalism.** Credible evidence they left news for another field, such as communications, a company, academia, politics, or retirement, and you do not find current journalism work.
- **Uncertain.** Sources conflict, are too old to settle it, are login-walled, or do not distinguish this person.

## Confidence

`confidence` is a number from 0 to 1.

- 0.85 to 1: at least two independent public sources agree.
- 0.6 to 0.84: one clear public source names the person and the role.
- Below 0.6: prefer Uncertain, unless that single source is explicit, such as a current staff bio.

## Save

`save_verdict` needs the person's id from the batch. `sources` entries use `url`, `kind` (`byline`, `staff_page`, `linkedin`, `x`, or `other`), and a short `title`. Put the new outlet, or why you are unsure, in `note`.
