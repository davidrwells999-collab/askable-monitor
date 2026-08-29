# Multi-user plan

Idea: run a separate alert for a second person (e.g. spouse) instead of
piggybacking one account. Captured 2026-08-28.

**Status: Option B implemented 2026-08-29.** `check-askable.js` loops over a
`USERS` array (`dave`, `rachel`), each with its own refresh token / user id /
ntfy topic / seen file. A user whose env vars are absent is skipped, so
`rachel` stays dormant until her three secrets are added:
`ASKABLE_REFRESH_TOKEN_RACHEL`, `ASKABLE_USER_ID_RACHEL`,
`NTFY_TOPIC_RACHEL` (the last is already set). See the bootstrap steps below.

The whole script is currently single-tenant: one `ASKABLE_REFRESH_TOKEN`, one
`ASKABLE_USER_ID`, one `NTFY_TOPIC`, one `seen-opportunities.json`, one
hard-coded secret name in `saveRefreshToken()`. Opportunities are already
per-profile server-side (the query is scoped to `_user_id` = your own JWT
claim, plus a 50-unit `locationRadius`), so a second account genuinely gets a
different list — worth doing properly rather than sharing.

## Option A — second copy of the repo

Duplicate the repo, give it her four secrets and a fresh ntfy topic. Zero code
changes.

Downside: the `*/5` cron is ~288 runs/day. On a **private** repo that's already
near/over the 2,000 min/mo Actions free tier for one user — doubling it means
paying or making the repo public. Also two independent refresh-token rotation
chains to keep alive.

## Option B — one repo, loop over both users (preferred)

One workflow run handles both, ~same Actions minutes, both state files in one
commit, one shared `GH_SECRETS_PAT`.

Code changes:

| Piece | Now | Change |
|---|---|---|
| Users | implicit | `USERS` array: `{ name, refreshEnv, userId, ntfyTopic }` |
| `refreshAccessToken()` | reads module global | take `refreshToken` as arg |
| `saveRefreshToken()` | hard-codes `gh secret set ASKABLE_REFRESH_TOKEN` | take secret name as arg (`ASKABLE_REFRESH_TOKEN_WIFE`, …) |
| `SEEN_FILE` | `seen-opportunities.json` | per user: keep existing, add `seen-opportunities.<name>.json` |
| `notify()` | reads `NTFY_TOPIC` | take topic as arg |
| `main()` | single flow | loop users, `try/catch` per user so one expired token doesn't block the other |
| workflow | 4 env vars, `git add seen-opportunities.json` | add her secrets, `git add seen-opportunities*.json` |

The existing `concurrency: check-askable` group serialises runs, so the
seen-file commit stays race-free as long as it's one workflow.

## Manual bootstrap for a second person (either option)

1. She needs her **own Askable participant account** — demographics/screening
   are per-person, which is the point.
2. Log into it in a browser -> DevTools -> Application -> Cookies ->
   `auth.askable.com` -> copy the `refresh_token` value.
3. Get her `askable_user_id`: decode her access-token JWT (jwt.io or the
   Network tab) and read the `askable_user_id` claim.
4. New random ntfy topic; install the ntfy app and subscribe.
5. Add `ASKABLE_REFRESH_TOKEN_WIFE`, `ASKABLE_USER_ID_WIFE`,
   `NTFY_TOPIC_WIFE` as repo secrets.
