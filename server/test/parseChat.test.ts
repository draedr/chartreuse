import { describe, expect, it } from 'vitest';
import { ChatParseError, parseChat } from '../src/chats/parseChat.js';

const meta = JSON.stringify({
  user_name: 'Jackson',
  character_name: 'Marvel Narrator',
  create_date: '2025-11-14@10h28m31s',
  chat_metadata: {},
});

describe('parseChat', () => {
  it('extracts metadata and messages, with the active swipe and model', () => {
    const jsonl = [
      meta,
      JSON.stringify({ name: 'Narrator', is_user: false, send_date: 'd1', mes: 'hello' }),
      JSON.stringify({
        name: 'Narrator',
        is_user: false,
        mes: 'second swipe',
        swipe_id: 1,
        swipes: ['first swipe', 'second swipe', 'third swipe'],
        extra: { model: 'glm-4.6' },
      }),
      JSON.stringify({ name: 'Jackson', is_user: true, mes: 'reply' }),
    ].join('\n');

    const { meta: m, messages } = parseChat(jsonl);
    expect(m).toEqual({
      userName: 'Jackson',
      characterName: 'Marvel Narrator',
      createDate: '2025-11-14@10h28m31s',
    });
    expect(messages).toHaveLength(3);
    expect(messages[1]).toMatchObject({
      name: 'Narrator',
      isUser: false,
      swipeId: 1,
      model: 'glm-4.6',
    });
    expect(messages[1]!.swipes).toHaveLength(3);
    expect(messages[2]).toMatchObject({ name: 'Jackson', isUser: true, model: null });
  });

  it('tolerates a missing metadata line', () => {
    const jsonl = JSON.stringify({ name: 'A', is_user: true, mes: 'hi' });
    const { meta: m, messages } = parseChat(jsonl);
    expect(m).toEqual({ userName: '', characterName: '', createDate: '' });
    expect(messages).toHaveLength(1);
  });

  it('ignores blank lines and trailing newline', () => {
    const jsonl = `${meta}\n\n${JSON.stringify({ name: 'A', mes: 'x' })}\n`;
    expect(parseChat(jsonl).messages).toHaveLength(1);
  });

  it('rejects empty input', () => {
    expect(() => parseChat('   ')).toThrow(ChatParseError);
  });

  it('rejects non-JSON lines', () => {
    expect(() => parseChat('not json at all')).toThrow(ChatParseError);
  });

  it('rejects a file with metadata but no messages', () => {
    expect(() => parseChat(meta)).toThrow(ChatParseError);
  });
});
