import { createHash } from 'node:crypto';

export const fieldNames = [
  '_synthetic', 'type', 'message', 'role', 'content', 'text', 'isCompactSummary', 'isMeta',
  'turnOrigin', 'entrypoint', 'promptSource', 'subtype', 'compactMetadata', 'compact_metadata',
  'preTokens', 'pre_tokens', 'postTokens', 'post_tokens', 'trigger', 'uuid', 'cwd', 'version', 'timestamp', 'attachment',
];

export const mayNeed = text => /"type"\s*:\s*"(?:user|attachment)"|compact_boundary|isCompactSummary/u.test(text);

export function decode(text, n) {
  if (/^\s*\{\s*"_synthetic"\s*:\s*true/u.test(text)) return null;
  let record;
  try { record = JSON.parse(text); } catch { return { malformed: true, reason: 'not_user' }; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { malformed: true, reason: 'not_user' };
  const get = key => record[key];
  const kind = get('type') ?? 'unknown';
  const hookText = record.attachment?.content?.[0];
  const cardResent = kind === 'attachment' && record.attachment?.type === 'hook_additional_context' &&
    typeof hookText === 'string' && /^(?:goldfished: this conversation has just been compacted\.|goldfished: the card below came from the project folder)/u.test(hookText);
  const content = record?.message?.content;
  const body = typeof content === 'string' ? content : Array.isArray(content) ?
    content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n') : '';
  let reason;
  if (kind !== 'user') reason = 'not_user';
  else if (record.isCompactSummary === true) reason = 'summary';
  else if (record.isMeta === true) reason = 'meta';
  else if (Object.hasOwn(record, 'turnOrigin') && record.turnOrigin !== 'human') reason = 'origin_' + record.turnOrigin;
  else if (!Object.hasOwn(record, 'turnOrigin') && (record.entrypoint === 'sdk-cli' || record.promptSource === 'sdk')) reason = 'origin_sdk_legacy';
  else if (Array.isArray(content) && content.some(block => block?.type === 'tool_result')) reason = 'tool_result';
  else if (/^(?:<|Caveat:|\[Request interrupted)/u.test(body)) reason = 'wrapper';
  const boundary = kind === 'system' && record?.subtype === 'compact_boundary';
  const summary = record?.isCompactSummary === true;
  const compactLike = /compact/iu.test(kind) || /compact/iu.test(get('subtype') ?? '') || Object.keys(record ?? {}).some(key => /compact/iu.test(key));
  const metadata = record?.compactMetadata ?? record?.compact_metadata ?? {};
  const conversation = typeof record.message?.role === 'string';
  const known = kind === 'user' || kind === 'assistant';
  const invalid = (conversation && known && (typeof get('uuid') !== 'string' ||
    (typeof content !== 'string' && !Array.isArray(content)))) ||
    (boundary && (typeof get('uuid') !== 'string' || !Number.isFinite(metadata.preTokens ?? metadata.pre_tokens) ||
      ((metadata.postTokens ?? metadata.post_tokens) !== undefined && !Number.isFinite(metadata.postTokens ?? metadata.post_tokens))));
  return {
    dedupeKey: get('uuid') ?? createHash('sha256').update(JSON.stringify([get('timestamp'), body || get('content') || ''])).digest('hex'),
    conversation, known, invalid, unfamiliar: kind === 'system' && /compact/iu.test(get('subtype') ?? '') && !boundary,
    kind, reason, body, cardResent, identity: get('uuid') ?? n, directory: typeof get('cwd') === 'string' ? get('cwd') : undefined,
    release: typeof get('version') === 'string' ? get('version') : undefined, ms: Date.parse(get('timestamp')), automated: get('entrypoint') === 'sdk-cli',
    summary, boundary, compactLike, understood: compactLike && (boundary || summary) && !invalid,
    sizes: boundary ? { pre: metadata.preTokens ?? metadata.pre_tokens, post: metadata.postTokens ?? metadata.post_tokens, trigger: metadata.trigger } : {},
  };
}
