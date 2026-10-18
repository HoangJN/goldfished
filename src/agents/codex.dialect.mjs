import { createHash } from 'node:crypto';

export const fieldNames = [
  '_synthetic', 'type', 'subtype', 'payload', 'role', 'message', 'content', 'text',
  'timestamp', 'cwd', 'cli_version', 'source', 'originator', 'replacement_history', 'encrypted_content',
];

export const mayNeed = text => /user_message|compacted/u.test(text);

function shape(text) {
  const values = {}, stack = [];
  let key;
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]:,]/gu)) {
    const token = match[0];
    if (token === '{' || token === '[') { stack.push(key); key = undefined; }
    else if (token === '}' || token === ']') { stack.pop(); key = undefined; }
    else if (token === ',') key = undefined;
    else if (token !== ':') {
      if (key === undefined) {
        key = token.slice(1, -1);
        if (stack.length === 1 && /compact/iu.test(key)) values.compactKey = true;
      }
      else {
        if (stack.length === 1 && ['type', 'subtype', 'timestamp'].includes(key)) values[key] = token.slice(1, -1);
        if (stack.length === 2 && stack[1] === 'payload' && ['type', 'role'].includes(key)) values['payload_' + key] = token.slice(1, -1);
        key = undefined;
      }
    }
  }
  return values;
}

function readable(item) {
  if (!item || typeof item !== 'object') return [];
  const parts = [];
  if (typeof item.text === 'string' && item.text) parts.push(item.text);
  if (typeof item.message === 'string' && item.message) parts.push(item.message);
  if (typeof item.content === 'string' && item.content) parts.push(item.content);
  else if (Array.isArray(item.content)) for (const block of item.content) parts.push(...readable(block));
  return parts;
}

export function decode(text, n) {
  if (/^\s*\{\s*"_synthetic"\s*:\s*true/u.test(text)) return null;
  const needed = /user_message|compacted|session_meta/u.test(text);
  let record;
  if (needed) {
    record = JSON.parse(text);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid record');
  }
  const fields = record ? null : shape(text);
  const kind = record?.type ?? fields?.type ?? 'unknown';
  const payload = record?.payload;
  const inner = payload?.type ?? fields?.payload_type;
  const conversation = (payload && Object.hasOwn(payload, 'role')) || fields?.payload_role !== undefined || /_message$/u.test(inner ?? '');
  const known = kind === 'response_item' || (kind === 'event_msg' && ['user_message', 'agent_message'].includes(inner));
  const compactLike = /compact/iu.test(kind) || /compact/iu.test(record?.subtype ?? fields?.subtype ?? '') ||
    (record ? Object.keys(record).some(key => /compact/iu.test(key)) : !!fields.compactKey);
  const boundary = kind === 'compacted';
  const validBoundary = boundary && Array.isArray(payload?.replacement_history) && typeof payload?.message === 'string';
  const typed = kind === 'event_msg' && inner === 'user_message';
  const invalid = (typed && typeof payload?.message !== 'string') || (boundary && !validBoundary);
  const parts = validBoundary ? payload.replacement_history.flatMap(readable).concat(payload.message ? [payload.message] : []) : [];
  const meta = kind === 'session_meta' ? payload : undefined;
  const unknown = [];
  if (meta) for (const key of ['source', 'originator']) {
    if (meta[key] !== undefined && !['cli', 'exec', 'codex_cli_rs', 'codex_exec', 'codex_cli'].includes(meta[key])) unknown.push(key + '_' + String(meta[key]));
  }
  return {
    kind, conversation, known, compactLike, boundary, invalid, understood: validBoundary,
    unfamiliar: /compact/iu.test(kind) && !boundary,
    identity: n, body: typed && !invalid ? payload.message : undefined,
    dedupeKey: typed && !invalid ? createHash('sha256').update(JSON.stringify([record.timestamp, payload.message])).digest('hex') : undefined,
    directory: typeof meta?.cwd === 'string' ? meta.cwd : undefined,
    release: typeof meta?.cli_version === 'string' ? meta.cli_version : undefined,
    automated: meta?.source === 'exec' || meta?.originator === 'codex_exec', unknown,
    ms: Date.parse(record?.timestamp ?? fields?.timestamp), visible: parts.length ? parts.join('\n') : null,
  };
}
