/**
 * Generates the committed test fixtures in server/test/fixtures.
 * Run with: npx tsx scripts/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'test',
  'fixtures',
);
mkdirSync(path.join(FIXTURES, 'malformed'), { recursive: true });

// ---------- minimal PNG builder ----------

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function textChunk(keyword: string, text: string): Buffer {
  return chunk(
    'tEXt',
    Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]),
  );
}

/** 1x1 RGBA PNG with the given tEXt chunks before IEND. */
function makePng(textChunks: Buffer[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const idat = zlib.deflateSync(Buffer.from([0, 0xd9, 0x77, 0x57, 0xff])); // filter + 1px terracotta
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    ...textChunks,
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function cardChunk(keyword: string, payload: unknown): Buffer {
  return textChunk(keyword, Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'));
}

// ---------- fixture payloads ----------

const v2Card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mira the Cartographer',
    description: 'A wandering mapmaker charting the floating isles of Eldoria.',
    personality: 'Curious, meticulous, secretly homesick.',
    scenario: 'You meet Mira at the cliffside observatory above the cloudsea.',
    first_mes: '*Mira looks up from a half-inked map.* "Oh! A traveler. Do you know the way to Skyharbor?"',
    mes_example: '<START>{{user}}: Where are we?\n{{char}}: "Edge of the known world, friend."',
    creator_notes: 'Works best with detailed exploration prompts.',
    system_prompt: 'Stay in character as a fantasy cartographer.',
    post_history_instructions: '',
    alternate_greetings: [
      '*Mira waves from atop a survey tripod.* "Mind the chasm!"',
      '*A rolled map bounces off your head.* "Sorry! Wind."',
    ],
    tags: ['Fantasy', 'Adventure', 'OC'],
    creator: 'fixturesmith',
    character_version: '1.0',
    extensions: { fav: false, talkativeness: '0.5' },
    character_book: {
      name: 'Eldoria Atlas',
      description: 'World notes for the floating isles.',
      scan_depth: 50,
      token_budget: 500,
      recursive_scanning: false,
      extensions: {},
      entries: [
        {
          id: 1,
          keys: ['Eldoria', 'floating isles'],
          secondary_keys: [],
          content: 'Eldoria is an archipelago of sky islands held aloft by windstone.',
          comment: 'Eldoria',
          enabled: true,
          insertion_order: 100,
          case_sensitive: false,
          priority: 10,
          selective: true,
          constant: false,
          position: 'before_char',
          probability: 100,
          extensions: {},
        },
        {
          id: 2,
          keys: ['Skyharbor'],
          secondary_keys: ['port'],
          content: 'Skyharbor is the largest dock-city, tethered to three isles by bridges.',
          comment: 'Skyharbor',
          enabled: true,
          insertion_order: 90,
          case_sensitive: false,
          priority: 10,
          selective: false,
          constant: true,
          position: 'after_char',
          probability: 100,
          extensions: {},
        },
      ],
    },
  },
};

const v3Card = {
  spec: 'chara_card_v3',
  spec_version: '3.0',
  data: {
    name: 'Vex of the Hollow',
    description: 'A shadow-courier who delivers letters between rival necromancers.',
    personality: 'Dry wit, professional neutrality.',
    scenario: 'A midnight handoff in the bone orchard.',
    first_mes: '"You the client? Sign here. Blood optional."',
    mes_example: '',
    creator_notes: 'V3 fixture.',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: ['Dark Fantasy'],
    creator: 'fixturesmith',
    character_version: '2.1',
    extensions: {},
    nickname: 'Vex',
    group_only_greetings: [],
  },
};

const v1Bare = {
  name: 'Plain Pete',
  description: 'A v1-style bare card with top-level fields only.',
  personality: 'Plain.',
  scenario: 'A beige room.',
  first_mes: 'Hello. I am extremely normal.',
  mes_example: '',
};

const worldInfoStandalone = {
  name: 'Astraea Codex',
  description: 'Standalone world info in SillyTavern format.',
  entries: {
    '0': {
      uid: 0,
      key: ['Sages', 'Grand Sage'],
      keysecondary: ['council'],
      comment: 'Sages',
      content: 'The Sages are the tyrannical managers of Astraea.',
      constant: false,
      selective: true,
      order: 100,
      position: 0,
      disable: false,
      probability: 100,
      useProbability: true,
      depth: 4,
      group: '',
    },
    '1': {
      uid: 1,
      key: ['Battle Song'],
      keysecondary: [],
      comment: 'The System',
      content: 'Battle Song OS shows stat panels and dampens fear.',
      constant: true,
      selective: false,
      order: 90,
      position: 4,
      disable: true,
      probability: 100,
      useProbability: true,
      depth: 2,
      group: 'systems',
    },
  },
};

const charbookStandalone = {
  name: 'Verdant Vale Guide',
  description: 'A standalone lorebook exported in character_book format.',
  scan_depth: 40,
  token_budget: 400,
  recursive_scanning: true,
  entries: [
    {
      id: 7,
      keys: ['Verdant Vale'],
      secondary_keys: [],
      content: 'A mossy valley where it rains tea on Tuesdays.',
      comment: 'The Vale',
      enabled: true,
      insertion_order: 10,
      position: 'before_char',
      extensions: {},
    },
  ],
};

// ---------- write fixtures ----------

const w = (name: string, data: Buffer | string) => {
  writeFileSync(path.join(FIXTURES, name), data);
  console.log('wrote', name);
};

w('v2_card.json', JSON.stringify(v2Card, null, 2));
w('v2_card.png', makePng([cardChunk('chara', v2Card)]));
// v3 PNG carries BOTH chunks; readers must prefer ccv3.
w('v3_card.png', makePng([cardChunk('chara', v2Card), cardChunk('ccv3', v3Card)]));
w('v1_bare.json', JSON.stringify(v1Bare, null, 2));
w('worldinfo_standalone.json', JSON.stringify(worldInfoStandalone, null, 2));
w('charbook_standalone.json', JSON.stringify(charbookStandalone, null, 2));

w(path.join('malformed', 'not_a_png.png'), 'this is just text pretending to be a png');
w(path.join('malformed', 'no_chara_chunk.png'), makePng([]));
w(
  path.join('malformed', 'bad_base64.png'),
  makePng([textChunk('chara', '!!!! not base64 json !!!!')]),
);
w(path.join('malformed', 'broken.json'), '{ "name": "Trunca');
w(path.join('malformed', 'wrong_schema.json'), JSON.stringify({ foo: 1, bar: [2, 3] }));
