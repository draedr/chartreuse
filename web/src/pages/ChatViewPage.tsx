import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import type { ChatMessage } from '@chartreuse/shared';
import { api, chatDownloadUrl } from '../api/client';
import { RichText, useRenderHtml } from '../components/RichText';
import { EmptyState, LoadingState } from '../components/ui';

export function ChatViewPage() {
  const { id, chatId } = useParams();
  const characterId = Number(id);
  const cid = Number(chatId);

  const chat = useQuery({
    queryKey: ['chat', cid],
    queryFn: () => api.chat(cid),
    enabled: Number.isInteger(cid),
  });
  const renderHtml = useRenderHtml();

  if (chat.isLoading) return <LoadingState />;
  if (chat.isError || !chat.data) {
    return <EmptyState title="Chat not found" hint={String(chat.error ?? '')} />;
  }
  const c = chat.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2">
            <Link
              to={`/characters/${characterId}`}
              className="text-sm text-ink-muted hover:text-accent-deep"
            >
              ← Back to character
            </Link>
          </div>
          <h1 className="truncate font-display text-xl leading-snug" title={c.originalFilename}>
            {c.originalFilename}
          </h1>
          <p className="text-xs text-ink-muted">
            {c.userName && <>persona: {c.userName} · </>}
            {c.messageCount} messages
            {c.createDate && <> · {c.createDate}</>}
          </p>
        </div>
        <a
          href={chatDownloadUrl(c.id)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-deep"
        >
          Download .jsonl
        </a>
      </div>

      <div className="space-y-3">
        {c.messages.map((m, i) => (
          <MessageBubble key={i} message={m} renderHtml={renderHtml} />
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ message, renderHtml }: { message: ChatMessage; renderHtml: boolean }) {
  // The active swipe is the source of truth when a message has alternatives;
  // fall back to `mes` (and keep them in sync as the user swipes).
  const hasSwipes = message.swipes.length > 1;
  const [swipe, setSwipe] = useState(
    hasSwipes ? Math.min(message.swipeId, message.swipes.length - 1) : 0,
  );
  const text = hasSwipes ? (message.swipes[swipe] ?? message.mes) : message.mes;

  const mine = message.isUser;
  const align = mine ? 'items-end' : 'items-start';
  const bubble = mine
    ? 'bg-accent-soft/60 border-accent/30'
    : 'bg-surface border-line';

  return (
    <div className={`flex flex-col gap-1 ${align}`}>
      <div className="flex items-center gap-2 px-1 text-xs text-ink-muted">
        <span className="font-medium text-ink">{message.name || (mine ? 'You' : 'Character')}</span>
        {message.model && <span className="font-mono">{message.model}</span>}
        {message.sendDate && <span>{message.sendDate}</span>}
      </div>
      <div className={`max-w-[85%] rounded-card border px-4 py-3 text-sm leading-relaxed ${bubble}`}>
        {text.trim() ? (
          <RichText text={text} allowHtml={renderHtml} />
        ) : (
          <span className="text-ink-muted">(empty message)</span>
        )}
      </div>
      {hasSwipes && (
        <div className="flex items-center gap-2 px-1 text-xs">
          <button
            type="button"
            disabled={swipe <= 0}
            onClick={() => setSwipe(swipe - 1)}
            className="rounded-md border border-line px-2 py-0.5 disabled:opacity-40 hover:border-accent/50"
          >
            ←
          </button>
          <span className="text-ink-muted">
            {swipe + 1} / {message.swipes.length}
          </span>
          <button
            type="button"
            disabled={swipe >= message.swipes.length - 1}
            onClick={() => setSwipe(swipe + 1)}
            className="rounded-md border border-line px-2 py-0.5 disabled:opacity-40 hover:border-accent/50"
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
