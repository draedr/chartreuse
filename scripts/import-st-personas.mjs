#!/usr/bin/env node
/**
 * Imports personas from a SillyTavern user folder into a running Chartreuse
 * instance. Standalone — needs only Node 18+ (built-in fetch), no dependencies.
 *
 * Usage:
 *   node scripts/import-st-personas.mjs [userFolder] [endpoint] [--force]
 *
 * Missing arguments are asked for interactively.
 *   userFolder  SillyTavern user data folder (e.g. .../SillyTavern/data/default-user)
 *               — must contain settings.json and a 'User Avatars' subfolder.
 *   endpoint    Base URL of the Chartreuse app (e.g. http://localhost:3000).
 *   --force     Import personas even when one with the same name already exists
 *               (by default those are skipped so re-runs don't create duplicates).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--force');
  const force = process.argv.includes('--force');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const userDir =
    args[0] ?? (await rl.question('SillyTavern user folder (contains settings.json): '));
  const endpointRaw =
    args[1] ?? (await rl.question('Chartreuse endpoint [http://localhost:3000]: '));
  rl.close();
  const endpoint = (endpointRaw.trim() || 'http://localhost:3000').replace(/\/+$/, '');

  // ---- read settings.json ----
  const settingsPath = path.join(userDir, 'settings.json');
  if (!existsSync(settingsPath)) {
    fail(`settings.json not found at ${settingsPath}`);
  }
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  // Depending on the SillyTavern version the persona objects live at the top
  // level or under power_user.
  const source =
    settings.personas && typeof settings.personas === 'object'
      ? settings
      : (settings.power_user ?? {});
  const personas = source.personas ?? {};
  const descriptions = source.persona_descriptions ?? {};
  const keys = Object.keys(personas);
  if (keys.length === 0) {
    fail('no personas found in settings.json (looked at top level and under power_user)');
  }
  console.log(`Found ${keys.length} persona(s) in ${settingsPath}`);

  const avatarsDir = path.join(userDir, 'User Avatars');
  if (!existsSync(avatarsDir)) {
    console.warn(`warning: '${avatarsDir}' not found — importing without avatars`);
  }

  // ---- check the endpoint + collect existing names ----
  const health = await request(`${endpoint}/healthz`);
  if (!health.ok) fail(`Chartreuse not reachable at ${endpoint} (GET /healthz failed)`);

  const existingNames = new Set();
  for (let page = 1; ; page++) {
    const res = await request(`${endpoint}/api/personas?limit=100&page=${page}`);
    if (!res.ok) fail(`could not list existing personas: HTTP ${res.status}`);
    const data = await res.json();
    for (const p of data.items) existingNames.add(p.name.toLowerCase());
    if (page * data.limit >= data.total) break;
  }
  console.log(`Chartreuse currently has ${existingNames.size} distinct persona name(s)\n`);

  // ---- import ----
  let created = 0;
  let withAvatar = 0;
  let skipped = 0;
  let failed = 0;

  for (const key of keys) {
    const rawName = personas[key];
    const name = (typeof rawName === 'string' ? rawName : String(rawName ?? '')).trim() || key;
    const d = descriptions[key];
    const description =
      typeof d === 'string' ? d : typeof d?.description === 'string' ? d.description : '';

    if (!force && existingNames.has(name.toLowerCase())) {
      console.log(`- skip   ${name} (already exists; use --force to import anyway)`);
      skipped += 1;
      continue;
    }

    const createRes = await request(`${endpoint}/api/personas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    if (!createRes.ok) {
      console.error(`- FAIL   ${name}: HTTP ${createRes.status} ${await safeText(createRes)}`);
      failed += 1;
      continue;
    }
    const { id } = await createRes.json();
    created += 1;
    existingNames.add(name.toLowerCase());

    // avatar: the settings.json key is the avatar filename
    const avatarPath = path.join(avatarsDir, key);
    let avatarNote = 'no avatar file';
    if (existsSync(avatarPath)) {
      const bytes = readFileSync(avatarPath);
      if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
        const avatarRes = await request(`${endpoint}/api/personas/${id}/avatar`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: bytes,
        });
        if (avatarRes.ok) {
          withAvatar += 1;
          avatarNote = 'with avatar';
        } else {
          avatarNote = `avatar upload failed: HTTP ${avatarRes.status}`;
        }
      } else {
        avatarNote = 'avatar is not a PNG, skipped';
      }
    }
    console.log(`- create ${name} (id ${id}, ${avatarNote})`);
  }

  console.log(
    `\nDone: ${created} created (${withAvatar} with avatar), ${skipped} skipped, ${failed} failed.`,
  );
  if (failed > 0) process.exitCode = 1;
}

async function request(url, init) {
  try {
    return await fetch(url, init);
  } catch (err) {
    fail(`request to ${url} failed: ${err?.message ?? err}`);
  }
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

await main();
