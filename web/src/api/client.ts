import type {
  CharacterDetail,
  CharacterSummary,
  ImportLogRow,
  ImportStatus,
  LorebookDetail,
  LorebookSummary,
  Paginated,
  QuarantineRow,
  Settings,
  TagCount,
} from '@chartreuse/shared';

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

  imports: (params: URLSearchParams) =>
    request<Paginated<ImportLogRow>>(`/api/imports?${params}`),
  importStatus: () => request<ImportStatus>('/api/imports/status'),
  quarantine: (kind?: 'card' | 'lorebook') =>
    request<QuarantineRow[]>(`/api/imports/quarantine${kind ? `?kind=${kind}` : ''}`),
  retryQuarantine: (id: number) =>
    request<{ ok: boolean }>(`/api/imports/quarantine/${id}/retry`, { method: 'POST' }),
  rescan: () => request<{ ok: boolean }>('/api/imports/rescan', { method: 'POST' }),

  settings: () => request<Settings>('/api/settings'),
  putSettings: (body: Partial<Pick<Settings, 'watchCardsDir' | 'watchLorebooksDir' | 'rescanIntervalSec'>>) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  reindex: () => request<{ ok: boolean }>('/api/admin/reindex', { method: 'POST' }),
};

export const avatarUrl = (id: number, updatedAt: string): string =>
  `/api/characters/${id}/avatar?v=${encodeURIComponent(updatedAt)}`;
export const characterExportUrl = (id: number): string => `/api/characters/${id}/export`;
export const lorebookExportUrl = (id: number): string => `/api/lorebooks/${id}/export`;
