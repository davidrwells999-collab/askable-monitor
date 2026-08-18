# askable-monitor

Polls Askable's GraphQL API directly for new opportunities and pushes an alert
via [ntfy.sh](https://ntfy.sh) when one appears. No browser automation —
auth is a bearer token copied from DevTools.

Separate from the more complete `askable-alert` project (Playwright-based
dashboard scraper, used because Askable login there is Apple Sign-In only).
This is a lighter-weight standalone alternative that talks to the GraphQL API
directly, at the cost of needing the token refreshed by hand when it expires.

## Setup

```bash
cp .env.example .env
# fill in .env, then export the vars (or use a tool like `direnv`)
node check-askable.js
```

Run on a schedule (cron, GitHub Actions, etc.) — see the script header for
required env vars.

## Notes on the GraphQL schema

Introspection is disabled on `https://graphql.askable.com/graphql`, so the
query field paths in `check-askable.js` were reverse-engineered by probing
the live API with deliberately invalid/valid field names and reading the
`Cannot query field "X" on type "Y"` errors (verified 2026-08-18).

Some fields exist but return `"Unauthorized"` for participant-scoped tokens
— e.g. `information.title` and `information.body` are real fields but not
readable here. `name` is the closest available title-equivalent, and there
is no accessible description field on this query for a participant token.

`search._user_id` must match the `askable_user_id` claim inside your own
JWT (decode it to check) — passing any other value makes the whole query
return `Unauthorized`, not just filter oddly.
