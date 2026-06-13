import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

/**
 * The persisted "render HTML" preference. Defaults to false until settings
 * load, so untrusted markup is never rendered before the user has opted in.
 */
export function useRenderHtml(): boolean {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    staleTime: 60_000,
  });
  return settings.data?.renderHtml ?? false;
}

/**
 * Renders card-field / chat-message text.
 *  - `allowHtml` off + `markdown` off → plain text (preserves whitespace)
 *  - `allowHtml` off + `markdown` on  → markdown only (HTML shown literally)
 *  - `allowHtml` on                   → markdown + raw embedded HTML
 */
export function RichText({
  text,
  allowHtml,
  markdown = true,
  className = '',
}: {
  text: string;
  allowHtml: boolean;
  markdown?: boolean;
  className?: string;
}) {
  if (!allowHtml && !markdown) {
    return <div className={`whitespace-pre-wrap ${className}`}>{text}</div>;
  }
  return (
    <div className={`markdown-preview ${className}`}>
      <ReactMarkdown rehypePlugins={allowHtml ? [rehypeRaw] : []}>{text}</ReactMarkdown>
    </div>
  );
}
