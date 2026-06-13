import path from 'node:path';
import { z } from 'zod';
import type { Db } from './db/connection.js';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),
  WATCH_CARDS_DIR: z.string().default('./watch/cards'),
  WATCH_LOREBOOKS_DIR: z.string().default('./watch/lorebooks'),
  RESCAN_INTERVAL_SEC: z.coerce.number().int().min(10).default(300),
  RENDER_HTML: z.string().optional(),
});

export interface Config {
  port: number;
  dataDir: string;
  watchCardsDir: string;
  watchLorebooksDir: string;
  rescanIntervalSec: number;
  renderHtml: boolean;
}

export function loadEnvConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.parse(env);
  return {
    port: parsed.PORT,
    dataDir: path.resolve(parsed.DATA_DIR),
    watchCardsDir: path.resolve(parsed.WATCH_CARDS_DIR),
    watchLorebooksDir: path.resolve(parsed.WATCH_LOREBOOKS_DIR),
    rescanIntervalSec: parsed.RESCAN_INTERVAL_SEC,
    renderHtml: parsed.RENDER_HTML === 'true',
  };
}

/** Keys persisted in the settings table (override env on subsequent boots). */
const SETTING_KEYS = {
  watch_cards_dir: 'watchCardsDir',
  watch_lorebooks_dir: 'watchLorebooksDir',
  rescan_interval_sec: 'rescanIntervalSec',
  render_html: 'renderHtml',
} as const;

/**
 * Seeds the settings table from env on first boot, then returns the config
 * with any stored settings applied. Precedence: settings table > env > default.
 */
export function applyStoredSettings(db: Db, envConfig: Config): Config {
  const seed = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
  );
  seed.run('watch_cards_dir', envConfig.watchCardsDir);
  seed.run('watch_lorebooks_dir', envConfig.watchLorebooksDir);
  seed.run('rescan_interval_sec', String(envConfig.rescanIntervalSec));
  seed.run('render_html', String(envConfig.renderHtml));

  const rows = db.prepare('SELECT key, value FROM settings').all() as {
    key: string;
    value: string;
  }[];
  const config = { ...envConfig };
  for (const { key, value } of rows) {
    const field = SETTING_KEYS[key as keyof typeof SETTING_KEYS];
    if (field === 'rescanIntervalSec') {
      const n = Number.parseInt(value, 10);
      if (Number.isInteger(n) && n >= 10) config.rescanIntervalSec = n;
    } else if (field === 'renderHtml') {
      config.renderHtml = value === 'true';
    } else if (field) {
      config[field] = value;
    }
  }
  return config;
}

export function saveSetting(
  db: Db,
  key: keyof typeof SETTING_KEYS,
  value: string,
): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
