// check-askable.js
// Polls Askable's GraphQL API for new opportunities and pushes alerts via ntfy.sh
// Run on a schedule (see .github/workflows/check-askable.yml)

import { readFileSync, writeFileSync, existsSync } from "fs";

const ASKABLE_TOKEN = process.env.ASKABLE_TOKEN;
const NTFY_TOPIC = process.env.NTFY_TOPIC; // e.g. "dave-askable-alerts-x7q2"
const USER_ID = process.env.ASKABLE_USER_ID; // the _user_id from the captured request
const SEEN_FILE = "seen-opportunities.json";

if (!ASKABLE_TOKEN || !NTFY_TOPIC || !USER_ID) {
  console.error("Missing required env vars: ASKABLE_TOKEN, NTFY_TOPIC, ASKABLE_USER_ID");
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

async function fetchOpportunities() {
  const res = await fetch("https://graphql.askable.com/graphql", {
    method: "POST",
    headers: {
      Authorization: ASKABLE_TOKEN,
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
      "Askable token expired",
      "The auth token has expired — grab a fresh one from DevTools and update the ASKABLE_TOKEN secret."
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
        "Askable token expired",
        "The auth token has expired — grab a fresh one from DevTools and update the ASKABLE_TOKEN secret."
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
  const opportunities = await fetchOpportunities();
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
