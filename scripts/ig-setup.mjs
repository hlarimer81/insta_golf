#!/usr/bin/env node
/**
 * One-time Instagram credential setup (Parts D & E of the README walkthrough).
 *
 *   npm run ig:setup
 *
 * Prompts for the short-lived token from the Graph API Explorer, then:
 *   1. exchanges it for a long-lived token (using APP_ID / APP_SECRET from .env)
 *   2. finds the Page linked to your Instagram Business account
 *   3. writes IG_USER_ID + a durable Page IG_ACCESS_TOKEN to .env
 *
 * The token is read from a prompt (stdin), so it never lands in shell history.
 * Nothing is posted; this only mints and stores credentials.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");

if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    /* ignore */
  }
}

const APP_ID = process.env.APP_ID;
const APP_SECRET = process.env.APP_SECRET;
if (!APP_ID || !APP_SECRET) {
  console.error(
    "APP_ID and APP_SECRET must be in .env first.\n" +
      "Find them in your Meta app: App settings → Basic, then:\n" +
      "  printf 'APP_ID=%s\\nAPP_SECRET=%s\\n' 'YOUR_APP_ID' 'YOUR_APP_SECRET' >> .env",
  );
  process.exit(1);
}
const V = process.env.GRAPH_API_VERSION ?? "v21.0";

// Graph API GET helper.
async function graphGet(path, params) {
  const url = new URL(`https://graph.facebook.com/${V}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? res.statusText);
  }
  return json;
}

const rl = createInterface({ input, output });
const shortToken = (
  await rl.question("Paste the short-lived token from the Graph API Explorer: ")
).trim();
if (!shortToken) {
  console.error("No token provided.");
  rl.close();
  process.exit(1);
}

// 1. Exchange short-lived → long-lived user token.
console.log("\nExchanging for a long-lived token…");
const exchange = await graphGet("oauth/access_token", {
  grant_type: "fb_exchange_token",
  client_id: APP_ID,
  client_secret: APP_SECRET,
  fb_exchange_token: shortToken,
});
const longUserToken = exchange.access_token;

// 2. Find the Page(s) with a linked Instagram Business account.
console.log("Looking up your Page and Instagram account…");
const pages = await graphGet("me/accounts", {
  fields: "name,access_token,instagram_business_account{id,username}",
  access_token: longUserToken,
});
const withIg = (pages.data ?? []).filter((p) => p.instagram_business_account);

if (withIg.length === 0) {
  const found = pages.data ?? [];
  console.error("\nNo Page with a linked Instagram Business account was found.");
  if (found.length === 0) {
    console.error(
      "\nNo Pages came back at all — the token wasn't granted access to your Page.\n" +
        "Re-generate it in the Graph API Explorer and, in the popup, click through the\n" +
        "opt-in and SELECT your Page + Instagram account (don't skip that dialog).",
    );
  } else {
    console.error(
      `\nThe token can see these Page(s), but none has an Instagram account attached:`,
    );
    for (const p of found) console.error(`  • ${p.name}`);
    console.error(
      "\nSo the token reaches your Page — Instagram just isn't linked on the Page side.\n" +
        "Fix: Meta Business Suite → Settings → Linked accounts → Instagram → Connect\n" +
        "(or Page → Settings → Linked accounts). Confirm the IG account is Business/Creator,\n" +
        "then generate a fresh token and re-run.",
    );
  }
  rl.close();
  process.exit(1);
}

let chosen = withIg[0];
if (withIg.length > 1) {
  console.log("\nMultiple Pages with Instagram accounts found:");
  withIg.forEach((p, i) =>
    console.log(`  ${i + 1}) ${p.name} → @${p.instagram_business_account.username}`),
  );
  const pick = parseInt((await rl.question("Choose a number: ")).trim(), 10);
  chosen = withIg[pick - 1];
  if (!chosen) {
    console.error("Invalid choice.");
    rl.close();
    process.exit(1);
  }
}
rl.close();

const igId = chosen.instagram_business_account.id;
const igHandle = chosen.instagram_business_account.username;
const pageToken = chosen.access_token; // durable when derived from a long-lived user token

// 3. Upsert into .env (preserving existing keys/comments; never printed).
upsertEnv({ IG_USER_ID: igId, IG_ACCESS_TOKEN: pageToken });

console.log(`\n✅ Linked @${igHandle} (IG id ${igId}) via Page "${chosen.name}".`);
console.log("   Wrote IG_USER_ID and IG_ACCESS_TOKEN to .env (durable Page token).");
console.log('\nNext: npm run schedule -- check');

function upsertEnv(pairs) {
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lines = existing.length ? existing.replace(/\n+$/, "").split("\n") : [];
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${v}`;
    const idx = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
  }
  writeFileSync(envPath, lines.join("\n") + "\n");
}
