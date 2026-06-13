/**
 * Parser for SillyTavern chat exports (.jsonl). The format is one JSON object
 * per line: the first line is chat metadata (user_name, character_name,
 * create_date, chat_metadata), and every subsequent line is a message
 * (name, is_user, mes, swipes, send_date, extra). Tolerant by design — a
 * leading metadata line is optional, and unknown fields are ignored.
 */

export interface ParsedChatMeta {
  userName: string;
  characterName: string;
  createDate: string;
}

export interface ParsedChatMessage {
  name: string;
  isUser: boolean;
  isSystem: boolean;
  sendDate: string;
  mes: string;
  swipes: string[];
  swipeId: number;
  model: string | null;
}

export interface ParsedChat {
  meta: ParsedChatMeta;
  messages: ParsedChatMessage[];
}

/** Thrown when the bytes don't look like a SillyTavern chat at all. */
export class ChatParseError extends Error {}

const EMPTY_META: ParsedChatMeta = { userName: '', characterName: '', createDate: '' };

function asObject(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toMeta(o: Record<string, unknown>): ParsedChatMeta {
  return {
    userName: str(o.user_name),
    characterName: str(o.character_name),
    createDate: str(o.create_date),
  };
}

function toMessage(o: Record<string, unknown>): ParsedChatMessage {
  const swipes = Array.isArray(o.swipes)
    ? o.swipes.filter((s): s is string => typeof s === 'string')
    : [];
  const extra = o.extra && typeof o.extra === 'object' ? (o.extra as Record<string, unknown>) : {};
  return {
    name: str(o.name),
    isUser: o.is_user === true,
    isSystem: o.is_system === true,
    sendDate: str(o.send_date),
    mes: str(o.mes),
    swipes,
    swipeId: typeof o.swipe_id === 'number' ? o.swipe_id : 0,
    model: typeof extra.model === 'string' ? extra.model : null,
  };
}

/** A line is a metadata line (vs. a message) when it carries chat-level keys. */
function isMetaLine(o: Record<string, unknown>): boolean {
  return o.mes === undefined && ('chat_metadata' in o || 'user_name' in o || 'create_date' in o);
}

export function parseChat(text: string): ParsedChat {
  const objects = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l, i) => {
      const o = asObject(l);
      if (!o) throw new ChatParseError(`line ${i + 1} is not a JSON object`);
      return o;
    });

  if (objects.length === 0) throw new ChatParseError('file is empty');

  let meta = EMPTY_META;
  let rest = objects;
  if (isMetaLine(objects[0]!)) {
    meta = toMeta(objects[0]!);
    rest = objects.slice(1);
  }

  const messages = rest.filter((o) => o.mes !== undefined).map(toMessage);
  if (messages.length === 0) {
    throw new ChatParseError('no chat messages found');
  }
  return { meta, messages };
}
