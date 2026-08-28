// check-askable.js
// Polls Askable's GraphQL API for new opportunities and pushes alerts via ntfy.sh
// Run on a schedule (see .github/workflows/check-askable.yml)

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";

// Public SPA client id (visible in every issued JWT's `azp` claim) — not a secret.
const KINDE_CLIENT_ID = "182a37880de0443b8748b4af3a6d2f0f";

const ASKABLE_REFRESH_TOKEN = process.env.ASKABLE_REFRESH_TOKEN;
const GH_SECRETS_PAT = process.env.GH_SECRETS_PAT;
const NTFY_TOPIC = process.env.NTFY_TOPIC; // e.g. "dave-askable-alerts-x7q2"
const USER_ID = process.env.ASKABLE_USER_ID; // the _user_id from the captured request
const SEEN_FILE = "seen-opportunities.json";

if (!ASKABLE_REFRESH_TOKEN || !GH_SECRETS_PAT || !NTFY_TOPIC || !USER_ID) {
  console.error("Missing required env vars: ASKABLE_REFRESH_TOKEN, GH_SECRETS_PAT, NTFY_TOPIC, ASKABLE_USER_ID");
  process.exit(1);
}

// Field paths verified against the live schema on 2026-08-18 via targeted probing
// (introspection is disabled on this endpoint). `information.title`/`information.body`
// exist but return "Unauthorized" for participant-scoped tokens — `name` is the
// closest available title-equivalent visible to participants. No description field
// is accessible on this list query with a participant token.
const QUERY = `query Opportunities($search: OpportunitySearchInput!) {
  opportunitiesListSearch(search: $search) {
    _id
    name
    type
    status
    approved_date
    config {
      incentive {
        value
        currency_symbol
      }
    }
  }
}`;

// Kinde rotates the refresh token on every use (confirmed via Network tab
// 2026-08-27: response includes a new `refresh_token` differing from the one
// sent). The new value is persisted to the GH secret *before* anything else
// happens, so a crash later in the run never strands an unrecoverable session
// — worst case is a wasted refresh, not a broken token chain.
async function refreshAccessToken() {
  const res = await fetch("https://auth.askable.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: `refresh_token=${ASKABLE_REFRESH_TOKEN}`,
    },
    body: `grant_type=refresh_token&client_id=${KINDE_CLIENT_ID}`,
  });

  if (!res.ok) {
    await notify(
      "Askable refresh token expired",
      "The refresh token was rejected — it's likely expired or was revoked. Do a fresh browser login and update the ASKABLE_REFRESH_TOKEN secret by hand."
    );
    throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}

function saveRefreshToken(newRefreshToken) {
  execFileSync("gh", ["secret", "set", "ASKABLE_REFRESH_TOKEN", "--body", newRefreshToken], {
    env: { ...process.env, GH_TOKEN: GH_SECRETS_PAT },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

async function fetchOpportunities(accessToken) {
  const res = await fetch("https://graphql.askable.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      operationName: "Opportunities",
      query: QUERY,
      variables: {
        search: {
          _user_id: USER_ID,
          dateMin: Date.now(),
          locationRadius: 50,
        },
      },
    }),
  });

  if (res.status === 401 || res.status === 403) {
    await notify(
      "Askable auth failing after refresh",
      "The access token was rejected right after a successful refresh — something's wrong beyond normal expiry. Needs investigation."
    );
    throw new Error(`Auth failed: ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    // Askable's GraphQL API returns HTTP 200 even for auth failures, with the
    // real status embedded in extensions.code (discovered 2026-08-19: a real
    // token expiry silently failed for ~4 hours because only the HTTP-level
    // 401/403 check above was firing the alert).
    const authError = json.errors.some((e) => e.extensions?.code === 401 || e.extensions?.code === 403);
    if (authError) {
      await notify(
        "Askable auth failing after refresh",
        "The GraphQL API returned an auth error right after a successful token refresh — something's wrong beyond normal expiry. Needs investigation."
      );
    }
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data.opportunitiesListSearch || [];
}

async function notify(title, message) {
  await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
    method: "POST",
    headers: {
      Title: title,
      Priority: "high",
      Tags: "moneybag",
    },
    body: message,
  });
}

function loadSeenIds() {
  if (!existsSync(SEEN_FILE)) return new Set();
  try {
    return new Set(JSON.parse(readFileSync(SEEN_FILE, "utf-8")));
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids) {
  writeFileSync(SEEN_FILE, JSON.stringify([...ids]));
}

async function main() {
  const { accessToken, refreshToken } = await refreshAccessToken();

  try {
    saveRefreshToken(refreshToken);
  } catch (err) {
    await notify(
      "Askable refresh token NOT saved",
      "Refresh succeeded but writing the rotated token back to GH_SECRETS_PAT failed. The old refresh token is now burned — the next run will fail unless this is fixed by hand."
    );
    throw err;
  }

  const opportunities = await fetchOpportunities(accessToken);

  if (process.env.LIST_ONLY === "true") {
    for (const opp of opportunities) {
      const incentive = opp.config?.incentive;
      const reward = incentive ? `${incentive.currency_symbol}${incentive.value}` : "reward unknown";
      console.log(`- ${opp.name || "(untitled)"} | ${reward} | ${opp.type} | ${opp.status} | approved ${opp.approved_date}`);
    }
    console.log(`${opportunities.length} live total`);
    return;
  }

  const seen = loadSeenIds();
  const currentIds = new Set(opportunities.map((o) => o._id));

  const newOnes = opportunities.filter((o) => !seen.has(o._id));

  if (newOnes.length === 0) {
    console.log(`No new opportunities. (${opportunities.length} total live)`);
  } else {
    console.log(`${newOnes.length} new opportunit${newOnes.length === 1 ? "y" : "ies"} found`);
    for (const opp of newOnes) {
      const incentive = opp.config?.incentive;
      const reward = incentive ? `${incentive.currency_symbol}${incentive.value}` : "reward unknown";
      const title = opp.name || "New Askable opportunity";
      await notify(`New Askable opportunity - ${reward}`, title);
    }
  }

  // Merge (don't just overwrite) so anything that disappears/expires isn't re-alerted if it briefly reappears
  const merged = new Set([...seen, ...currentIds]);
  saveSeenIds(merged);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
