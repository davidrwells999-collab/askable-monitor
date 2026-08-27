# askable-monitor

Polls Askable's GraphQL API directly for new opportunities and pushes an alert
via [ntfy.sh](https://ntfy.sh) when one appears. No browser automation for the
polling itself — auth is a Kinde OAuth refresh token captured once from
DevTools, then refreshed programmatically every run (see "Auth" below).

Separate from the more complete `askable-alert` project (Playwright-based
dashboard scraper, used because Askable login there is Apple Sign-In only).
This is a lighter-weight standalone alternative that talks to the GraphQL API
directly.

## Setup

```bash
cp .env.example .env
# fill in .env, then export the vars (or use a tool like `direnv`)
node check-askable.js
```

Run on a schedule (cron, GitHub Actions, etc.) — see the script header for
required env vars.

## Auth

Askable's auth (`auth.askable.com`) is Kinde-issued OAuth. The access token
(JWT) used against the GraphQL API is short-lived (hours, not days), but the
`refresh_token` cookie set alongside it is long-lived. `check-askable.js`
exchanges the refresh token for a fresh access token at the start of every
run via `POST https://auth.askable.com/oauth2/token`.

Kinde **rotates the refresh token on every use** — the response always
contains a new `refresh_token` different from the one sent. The script
persists this immediately, via `gh secret set` authenticated with a separate
`GH_SECRETS_PAT` (fine-grained PAT, this repo only, "Secrets: Read and
write"), *before* doing anything else. If that write-back ever fails, the
old refresh token is already burned — recovery is a fresh browser login and
manually updating the `ASKABLE_REFRESH_TOKEN` secret (the script fires a
high-priority ntfy alert if this happens, so it won't fail silently).

To bootstrap or re-bootstrap the refresh token from scratch: log in to
Askable in a browser, open DevTools → Application → Cookies on
`auth.askable.com`, and copy the `refresh_token` cookie value into the
`ASKABLE_REFRESH_TOKEN` secret.

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
