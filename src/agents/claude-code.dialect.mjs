export const mayNeed = text => /"type"\s*:\s*"user"|compact_boundary|isCompactSummary/u.test(text);
const stringValue = (text, key) => {
  const match = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'u').exec(text);
  return match ? match[1].replace(/\\u([\da-f]{4})|\\(["\\/bfnrt])/giu, (_, hex, char) =>
    hex ? String.fromCharCode(parseInt(hex, 16)) : ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[char] ?? char)) : undefined;
};

export function decode(text, n) {
  if (/^\s*\{\s*"_synthetic"\s*:\s*true/u.test(text)) return null;
  const needed = mayNeed(text) || /compact/iu.test(text);
  const record = needed ? JSON.parse(text) : null;
  const get = key => record ? record[key] : stringValue(text, key);
  const kind = get('type') ?? 'unknown';
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
  return {
    kind, reason, body, identity: get('uuid') ?? n, directory: typeof get('cwd') === 'string' ? get('cwd') : undefined,
    release: typeof get('version') === 'string' ? get('version') : undefined, ms: Date.parse(get('timestamp')), automated: get('entrypoint') === 'sdk-cli',
    summary, boundary, compactLike, understood: compactLike && (boundary || summary),
    sizes: boundary ? { pre: metadata.preTokens ?? metadata.pre_tokens, post: metadata.postTokens ?? metadata.post_tokens, trigger: metadata.trigger } : {},
  };
}
