#!/usr/bin/env node
// Interactive setup — connects the report to YOUR Cloudflare account for local testing
// by writing a `.dev.vars` file for you. No text editor or hidden-file wrangling needed.
// Cross-platform (Node readline). Nothing leaves your machine; `.dev.vars` is gitignored.

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { existsSync, writeFileSync, copyFileSync } from "node:fs";

const rl = createInterface({ input: stdin, output: stdout });
const ask = async (prompt) => (await rl.question(prompt)).trim();

console.log(`
────────────────────────────────────────────────────────
  User Activity Report — local setup
────────────────────────────────────────────────────────
This connects the report to YOUR Cloudflare account so "npm run dev" shows your
real data instead of the built-in sample.

You can skip this any time and just run "npm run dev" to explore with sample data.

You'll need a read-only API token (about 2 minutes to create). Step-by-step:
  https://github.com/aaron-mcallister/cf-user-activity-report/blob/main/docs/token-scopes.md
`);

const token = await ask('Paste your Cloudflare API token (or press Enter to skip): ');

if (!token) {
  console.log('\nNo token entered — no problem. Run "npm run dev" to explore with sample data.\n');
  rl.close();
  process.exit(0);
}

if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) {
  console.log(
    "\n⚠️  That doesn't look like a Cloudflare API token (they're a long string of letters,\n" +
      "    numbers, and underscores). Double-check you copied the whole token, then re-run\n" +
      '    "npm run setup".\n',
  );
  rl.close();
  process.exit(1);
}

// One prompt only (above). If a .dev.vars already exists, back it up rather than asking
// a second question — keeps the flow foolproof and non-destructive.
let backedUp = false;
if (existsSync(".dev.vars")) {
  copyFileSync(".dev.vars", ".dev.vars.bak");
  backedUp = true;
}

const contents =
  `# Local settings for "npm run dev" — created by "npm run setup".\n` +
  `# This file stays on your machine and is gitignored. Never commit it.\n` +
  `CF_API_TOKEN="${token}"\n` +
  `DEMO_MODE="off"\n` +
  `# Lets you view live data on your own computer (localhost) without extra auth.\n` +
  `# Safe here because this file is local-only and never used when you deploy —\n` +
  `# a deployed site still refuses live data until you protect it. See README > Security.\n` +
  `ALLOW_UNAUTHENTICATED="true"\n`;

writeFileSync(".dev.vars", contents);
rl.close();

console.log(`
✓ Saved your settings to .dev.vars (this file stays on your machine).${
  backedUp ? "\n  (Your previous .dev.vars was saved as .dev.vars.bak.)" : ""
}

Next:
  npm run preflight     (optional) confirm your plan exposes the data
  npm run dev           open http://localhost:8787 — now showing YOUR data

To switch back to sample data later: delete .dev.vars, or change DEMO_MODE to "on" in it.
`);
