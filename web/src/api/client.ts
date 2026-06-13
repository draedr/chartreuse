import type {
  CharacterDetail,
  CharacterSummary,
  ChatDetail,
  ChatSummary,
  ImportLogRow,
  ImportStatus,
  ImportUploadResult,
  LorebookDetail,
  LorebookSummary,
  Paginated,
  PersonaDetail,
  PersonaGroup,
  PersonaGroupWithCount,
  PersonaSummary,
  QuarantineRow,
  Settings,
  TagCount,
} from '@chartreuse/shared';

export interface PersonaWriteBody {
  name?: string;
  description?: string;
  groupId?: number | null;
  characterIds?: number[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? '';
    } catch {
      // non-JSON error body
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  characters: (params: URLSearchParams) =>
    request<Paginated<CharacterSummary>>(`/api/characters?${params}`),
  character: (id: number) => request<CharacterDetail>(`/api/characters/${id}`),
  characterRaw: (id: number) => request<unknown>(`/api/characters/${id}/raw`),
  deleteCharacter: (id: number) =>
    request<{ ok: boolean }>(`/api/characters/${id}`, { method: 'DELETE' }),

  lorebooks: (params: URLSearchParams) =>
    request<Paginated<LorebookSummary>>(`/api/lorebooks?${params}`),
  lorebook: (id: number) => request<LorebookDetail>(`/api/lorebooks/${id}`),
  deleteLorebook: (id: number) =>
    request<{ ok: boolean }>(`/api/lorebooks/${id}`, { method: 'DELETE' }),

  tags: () => request<TagCount[]>('/api/tags'),

  characterChats: (characterId: number) =>
    request<ChatSummary[]>(`/api/characters/${characterId}/chats`),
  uploadChat: (characterId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ChatSummary>(`/api/characters/${characterId}/chats`, {
      method: 'POST',
      body: form,
    });
  },
  chat: (chatId: number) => request<ChatDetail>(`/api/chats/${chatId}`),
  renameChat: (chatId: number, originalFilename: string) =>
    request<ChatSummary>(`/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalFilename }),
    }),
  deleteChat: (chatId: number) =>
    request<{ ok: boolean }>(`/api/chats/${chatId}`, { method: 'DELETE' }),

  personas: (params: URLSearchParams) =>
    request<Paginated<PersonaSummary>>(`/api/personas?${params}`),
  persona: (id: number) => request<PersonaDetail>(`/api/personas/${id}`),
  createPersona: (body: PersonaWriteBody) =>
    request<PersonaDetail>('/api/personas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updatePersona: (id: number, body: PersonaWriteBody) =>
    request<PersonaDetail>(`/api/personas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deletePersona: (id: number) =>
    request<{ ok: boolean }>(`/api/personas/${id}`, { method: 'DELETE' }),
  putPersonaAvatar: (id: number, file: File) =>
    request<{ ok: boolean }>(`/api/personas/${id}/avatar`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    }),
  deletePersonaAvatar: (id: number) =>
    request<{ ok: boolean }>(`/api/personas/${id}/avatar`, { method: 'DELETE' }),
  linkPersonaCharacter: (personaId: number, characterId: number) =>
    request<{ ok: boolean }>(`/api/personas/${personaId}/characters/${characterId}`, {
      method: 'POST',
    }),
  unlinkPersonaCharacter: (personaId: number, characterId: number) =>
    request<{ ok: boolean }>(`/api/personas/${personaId}/characters/${characterId}`, {
      method: 'DELETE',
    }),

  personaGroups: () => request<PersonaGroupWithCount[]>('/api/persona-groups'),
  createPersonaGroup: (body: { name: string; color: string }) =>
    request<PersonaGroupWithCount>('/api/persona-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updatePersonaGroup: (id: number, body: { name?: string; color?: string }) =>
    request<PersonaGroup>(`/api/persona-groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deletePersonaGroup: (id: number) =>
    request<{ ok: boolean }>(`/api/persona-groups/${id}`, { method: 'DELETE' }),

  imports: (params: URLSearchParams) =>
    request<Paginated<ImportLogRow>>(`/api/imports?${params}`),
  importStatus: () => request<ImportStatus>('/api/imports/status'),
  quarantine: (kind?: 'card' | 'lorebook') =>
    request<QuarantineRow[]>(`/api/imports/quarantine${kind ? `?kind=${kind}` : ''}`),
  retryQuarantine: (id: number) =>
    request<{ ok: boolean }>(`/api/imports/quarantine/${id}/retry`, { method: 'POST' }),
  rescan: () => request<{ ok: boolean }>('/api/imports/rescan', { method: 'POST' }),
  importCards: (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append('file', f);
    return request<{ results: ImportUploadResult[] }>('/api/imports/upload', {
      method: 'POST',
      body: form,
    });
  },

  settings: () => request<Settings>('/api/settings'),
  putSettings: (
    body: Partial<
      Pick<Settings, 'watchCardsDir' | 'watchLorebooksDir' | 'rescanIntervalSec' | 'renderHtml'>
    >,
  ) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  reindex: () => request<{ ok: boolean }>('/api/admin/reindex', { method: 'POST' }),
};

export const avatarUrl = (id: number, updatedAt: string): string =>
  `/api/characters/${id}/avatar?v=${encodeURIComponent(updatedAt)}`;
export const personaAvatarUrl = (id: number, updatedAt: string): string =>
  `/api/personas/${id}/avatar?v=${encodeURIComponent(updatedAt)}`;
export const characterExportUrl = (id: number): string => `/api/characters/${id}/export`;
export const lorebookExportUrl = (id: number): string => `/api/lorebooks/${id}/export`;
export const chatDownloadUrl = (chatId: number): string => `/api/chats/${chatId}/download`;
