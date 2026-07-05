import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Paginated, PersonaSummary } from '@chartreuse/shared';
import type { AppContext } from '../context.js';
import { toPersonaDetail, toPersonaGroupWithCount, toPersonaSummary } from './serialize.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'color must be #rrggbb')
  .transform((s) => s.toLowerCase());

const listQuerySchema = z.object({
  q: z.string().optional(),
  group_id: z.coerce.number().int().optional(),
  sort: z.enum(['name', 'created_at', 'updated_at']).default('name'),
  order: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(500),
  subtitle: z.string().trim().max(500).default(''),
  description: z.string().max(500_000).default(''),
  groupId: z.number().int().nullable().optional(),
  characterIds: z.array(z.number().int()).max(500).optional(),
});

// PUT: all optional; groupId null clears, undefined leaves unchanged.
const updateSchema = createSchema.partial().refine((b) => Object.keys(b).length > 0, {
  message: 'no fields provided',
});

const groupCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  color: hexColor,
});
const groupUpdateSchema = groupCreateSchema
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'no fields provided' });

const PERSONA_SELECT = `
  SELECT p.id, p.name, p.subtitle, p.description, p.has_avatar, p.created_at, p.updated_at,
         p.group_id, g.name AS group_name, g.color AS group_color,
         (SELECT COUNT(*) FROM persona_characters pc WHERE pc.persona_id = p.id) AS character_count
  FROM personas p LEFT JOIN persona_groups g ON g.id = p.group_id`;

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export function personasRoutes(ctx: AppContext): Hono {
  const { db, repo, storage } = ctx;
  const app = new Hono();

  const getPersonaRow = (id: number) =>
    db.prepare(`${PERSONA_SELECT} WHERE p.id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;

  const getPersonaCharacters = (id: number) =>
    db
      .prepare(
        `SELECT c.id, c.name, c.has_avatar
         FROM persona_characters pc JOIN characters c ON c.id = pc.character_id
         WHERE pc.persona_id = ? ORDER BY c.name COLLATE NOCASE`,
      )
      .all(id) as { id: number; name: string; has_avatar: number }[];

  const detailResponse = (id: number) => {
    const row = getPersonaRow(id);
    return row ? toPersonaDetail(row, getPersonaCharacters(id)) : null;
  };

  /** Returns an error string, or null when all referenced ids are valid. */
  const validateRefs = (groupId?: number | null, characterIds?: number[]): string | null => {
    if (groupId != null) {
      const g = db.prepare('SELECT 1 FROM persona_groups WHERE id = ?').get(groupId);
      if (!g) return `unknown group id ${groupId}`;
    }
    if (characterIds && characterIds.length > 0) {
      const found = db
        .prepare(
          `SELECT id FROM characters WHERE id IN (${characterIds.map(() => '?').join(', ')})`,
        )
        .all(...characterIds) as { id: number }[];
      const ok = new Set(found.map((r) => r.id));
      const missing = characterIds.filter((id) => !ok.has(id));
      if (missing.length > 0) return `unknown character id(s): ${missing.join(', ')}`;
    }
    return null;
  };

  app.get('/', (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: 'invalid query', issues: parsed.error.issues }, 400);
    }
    const p = parsed.data;
    const filters: string[] = [];
    const args: unknown[] = [];
    if (p.q?.trim()) {
      filters.push("(p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\')");
      const pattern = likePattern(p.q.trim());
      args.push(pattern, pattern);
    }
    if (p.group_id !== undefined) {
      filters.push('p.group_id = ?');
      args.push(p.group_id);
    }
    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const order = p.order ?? (p.sort === 'name' ? 'asc' : 'desc');
    const orderBy =
      p.sort === 'name'
        ? `p.name COLLATE NOCASE ${order}, p.id asc`
        : `p.${p.sort} ${order}, p.id ${order}`;

    const total = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM personas p ${where}`)
        .get(...args) as { n: number }
    ).n;
    const rows = db
      .prepare(`${PERSONA_SELECT} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...args, p.limit, (p.page - 1) * p.limit) as Record<string, unknown>[];

    const body: Paginated<PersonaSummary> = {
      items: rows.map(toPersonaSummary),
      total,
      page: p.page,
      limit: p.limit,
    };
    return c.json(body);
  });

  app.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid persona', issues: parsed.error.issues }, 400);
    }
    const p = parsed.data;
    const refError = validateRefs(p.groupId, p.characterIds);
    if (refError) return c.json({ error: refError }, 400);

    const id = repo.transaction(() => {
      const newId = repo.insertPersona({
        name: p.name,
        subtitle: p.subtitle,
        description: p.description,
        groupId: p.groupId ?? null,
      });
      if (p.characterIds) repo.replacePersonaCharacters(newId, p.characterIds);
      return newId;
    });
    return c.json(detailResponse(id), 201);
  });

  app.get('/:id', (c) => {
    const detail = detailResponse(Number(c.req.param('id')));
    return detail ? c.json(detail) : c.json({ error: 'not found' }, 404);
  });

  app.put('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const current = getPersonaRow(id);
    if (!current) return c.json({ error: 'not found' }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid persona', issues: parsed.error.issues }, 400);
    }
    const p = parsed.data;
    const refError = validateRefs(p.groupId, p.characterIds);
    if (refError) return c.json({ error: refError }, 400);

    repo.transaction(() => {
      repo.updatePersona(id, {
        name: p.name ?? (current.name as string),
        subtitle: p.subtitle ?? (current.subtitle as string),
        description: p.description ?? (current.description as string),
        // null clears the group; undefined keeps the current one
        groupId:
          p.groupId === undefined ? ((current.group_id as number | null) ?? null) : p.groupId,
      });
      if (p.characterIds) repo.replacePersonaCharacters(id, p.characterIds);
    });
    return c.json(detailResponse(id));
  });

  app.delete('/:id', (c) => {
    const id = Number(c.req.param('id'));
    const deleted = repo.transaction(() => repo.deletePersona(id));
    if (!deleted) return c.json({ error: 'not found' }, 404);
    storage.removePersonaAvatar(id);
    return c.json({ ok: true });
  });

  // Single link/unlink (used by the character page's modal); the connection
  // stays owned by the persona side.
  app.post('/:id/characters/:characterId', (c) => {
    const id = Number(c.req.param('id'));
    const characterId = Number(c.req.param('characterId'));
    if (!db.prepare('SELECT 1 FROM personas WHERE id = ?').get(id)) {
      return c.json({ error: 'persona not found' }, 404);
    }
    if (!db.prepare('SELECT 1 FROM characters WHERE id = ?').get(characterId)) {
      return c.json({ error: 'character not found' }, 404);
    }
    repo.transaction(() => repo.addPersonaCharacter(id, characterId));
    return c.json({ ok: true });
  });

  app.delete('/:id/characters/:characterId', (c) => {
    const id = Number(c.req.param('id'));
    const characterId = Number(c.req.param('characterId'));
    if (!db.prepare('SELECT 1 FROM personas WHERE id = ?').get(id)) {
      return c.json({ error: 'persona not found' }, 404);
    }
    const removed = repo.transaction(() => repo.removePersonaCharacter(id, characterId));
    if (!removed) return c.json({ error: 'not linked' }, 404);
    return c.json({ ok: true });
  });

  app.get('/:id/avatar', (c) => {
    const id = Number(c.req.param('id'));
    const row = db.prepare('SELECT has_avatar FROM personas WHERE id = ?').get(id) as
      | { has_avatar: number }
      | undefined;
    if (!row?.has_avatar) return c.json({ error: 'no avatar' }, 404);
    const p = storage.personaAvatarPath(id);
    if (!existsSync(p)) return c.json({ error: 'no avatar' }, 404);
    return c.body(new Uint8Array(readFileSync(p)), 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=86400',
    });
  });

  app.put('/:id/avatar', async (c) => {
    const id = Number(c.req.param('id'));
    if (!db.prepare('SELECT 1 FROM personas WHERE id = ?').get(id)) {
      return c.json({ error: 'not found' }, 404);
    }
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length > MAX_AVATAR_BYTES) {
      return c.json({ error: 'avatar too large (max 10 MB)' }, 413);
    }
    if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      return c.json({ error: 'not a PNG file' }, 400);
    }
    storage.storePersonaAvatar(id, bytes);
    repo.transaction(() => repo.setPersonaAvatar(id, true));
    return c.json({ ok: true });
  });

  app.delete('/:id/avatar', (c) => {
    const id = Number(c.req.param('id'));
    if (!db.prepare('SELECT 1 FROM personas WHERE id = ?').get(id)) {
      return c.json({ error: 'not found' }, 404);
    }
    storage.removePersonaAvatar(id);
    repo.transaction(() => repo.setPersonaAvatar(id, false));
    return c.json({ ok: true });
  });

  return app;
}

export function personaGroupsRoutes(ctx: AppContext): Hono {
  const { db, repo } = ctx;
  const app = new Hono();

  app.get('/', (c) => {
    const rows = db
      .prepare(
        `SELECT g.id, g.name, g.color,
           (SELECT COUNT(*) FROM personas p WHERE p.group_id = g.id) AS persona_count
         FROM persona_groups g ORDER BY g.name COLLATE NOCASE`,
      )
      .all() as Record<string, unknown>[];
    return c.json(rows.map(toPersonaGroupWithCount));
  });

  app.post('/', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = groupCreateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid group', issues: parsed.error.issues }, 400);
    }
    const id = repo.transaction(() => repo.insertPersonaGroup(parsed.data));
    return c.json({ id, ...parsed.data, personaCount: 0 }, 201);
  });

  app.put('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const parsed = groupUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid group', issues: parsed.error.issues }, 400);
    }
    const updated = repo.transaction(() => repo.updatePersonaGroup(id, parsed.data));
    if (!updated) return c.json({ error: 'not found' }, 404);
    const row = db.prepare('SELECT * FROM persona_groups WHERE id = ?').get(id);
    return c.json(row);
  });

  app.delete('/:id', (c) => {
    const id = Number(c.req.param('id'));
    // Personas in this group survive (group_id → NULL via FK).
    const deleted = repo.transaction(() => repo.deletePersonaGroup(id));
    if (!deleted) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
  });

  return app;
}
