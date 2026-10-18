const normalise = text => text.toLowerCase().replace(/['"`*\u2018\u2019\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim();
const words = text => text.match(/[\p{L}\p{N}_]+/gu) ?? [];
export const GRADER = { id: 'G3', threshold: 0.9 };
function hash(run) {
  let h = 2166136261;
  for (const word of run) {
    for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 32, 16777619);
  }
  return h >>> 0;
}
function substringIndex(symbols) {
  // Runs need word boundaries, not another lap through the summary.
  const capacity = symbols.length * 2 + 1;
  const head = new Uint32Array(capacity), link = new Uint32Array(capacity), length = new Uint32Array(capacity);
  const edges = symbols.length * 3 + 1;
  const key = new Uint16Array(edges);
  const target = new Uint32Array(edges), next = new Uint32Array(edges);
  let states = 1, used = 0, last = 0;
  function find(state, symbol) {
    for (let edge = head[state]; edge; edge = next[edge]) if (key[edge] === symbol) return edge;
    return 0;
  }
  function add(state, symbol, to) {
    const edge = ++used;
    key[edge] = symbol; target[edge] = to; next[edge] = head[state]; head[state] = edge;
  }
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols.charCodeAt(i);
    const current = states++;
    length[current] = length[last] + 1;
    let p = last, edge = find(p, symbol);
    while (!edge) {
      add(p, symbol, current);
      if (p === 0) { p = -1; break; }
      p = link[p]; edge = find(p, symbol);
    }
    if (p >= 0) {
      const q = target[edge];
      if (length[p] + 1 === length[q]) link[current] = q;
      else {
        const clone = states++;
        length[clone] = length[p] + 1; link[clone] = link[q];
        for (let e = head[q]; e; e = next[e]) add(clone, key[e], target[e]);
        while (edge && target[edge] === q) {
          target[edge] = clone;
          if (p === 0) break;
          p = link[p]; edge = find(p, symbol);
        }
        link[q] = link[current] = clone;
      }
    }
    last = current;
  }
  return { head: head.slice(0, states), key: key.slice(0, used + 1), target: target.slice(0, used + 1), next: next.slice(0, used + 1),
    link: link.slice(0, states), length: length.slice(0, states) };
}
function step(index, state, symbol) {
  for (let e = index.head[state]; e; e = index.next[e]) if (index.key[e] === symbol) return index.target[e];
  return 0;
}
function longestRun(tokens, index) {
  const query = ' ' + tokens.join(' ') + ' ';
  const boundaries = [0];
  let state = 0, length = 0, left = 0, best = 0;
  for (let i = 0; i < query.length; i++) {
    const symbol = query.charCodeAt(i);
    let next = step(index, state, symbol);
    while (state && !next) {
      state = index.link[state];
      length = index.length[state];
      next = step(index, state, symbol);
    }
    state = next;
    length = next ? length + 1 : 0;
    if (symbol !== 32 || i === 0) continue;
    boundaries.push(i);
    while (boundaries[left] < i - length + 1) left++;
    best = Math.max(best, boundaries.length - 1 - left);
  }
  return best;
}

export function prepare(visibleText) {
  const normal = normalise(visibleText), tokens = words(normal);
  const positions = new Map(), shingles = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if (!positions.has(word)) positions.set(word, []);
    positions.get(word).push(i);
    if (i >= 4) shingles.add(hash(tokens.slice(i - 4, i + 1)));
  }
  const quotations = new Set();
  for (const match of visibleText.matchAll(/["\u201c]([^"\u201d]+)["\u201d]|`([^`]+)`/g)) {
    const quoted = words(normalise(match[1] ?? match[2]));
    if (quoted.some(word => word.length > 4)) quotations.add(hash(quoted));
  }
  return { positions, shingles, runs: substringIndex(' ' + tokens.join(' ') + ' '), quotations };
}

export function score(text, index) {
  const normal = normalise(text), tokens = words(normal);
  if (!tokens.length) return { label: 'gone', score: 0 };
  const value = longestRun(tokens, index.runs) / tokens.length;
  const significant = tokens.filter(word => word.length > 4);
  const overlap = significant.length >= 3 && significant.filter(word => index.positions.has(word)).length / significant.length >= 0.6;
  let quoted = false;
  for (let i = 0; !quoted && index.quotations.size && i < tokens.length; i++) {
    let h = 2166136261;
    for (let j = i; j < tokens.length; j++) {
      for (let k = 0; k < tokens[j].length; k++) h = Math.imul(h ^ tokens[j].charCodeAt(k), 16777619);
      h = Math.imul(h ^ 32, 16777619);
      if (index.quotations.has(h >>> 0)) { quoted = true; break; }
    }
  }
  return { label: value >= GRADER.threshold ? 'kept' : overlap || quoted ? 'reworded' : 'gone', score: value };
}

export function bestMatch(text, visibleText) {
  const wanted = new Set(words(normalise(text))), counts = new Map();
  const hits = [...visibleText.matchAll(/[\p{L}\p{N}_]+(?:['"`*\u2018\u2019\u201c\u201d]+[\p{L}\p{N}_]+)*/gu)]
    .map(hit => ({ word: normalise(hit[0]), start: hit.index, end: hit.index + hit[0].length }))
    .filter(hit => wanted.has(hit.word) && hit.end - hit.start <= 80);
  let left = 0, best = 0, start = 0;
  for (const hit of hits) {
    counts.set(hit.word, (counts.get(hit.word) ?? 0) + 1);
    const from = Math.max(0, hit.end - 80);
    while (hits[left].start < from) {
      const word = hits[left++].word, count = counts.get(word) - 1;
      if (count) counts.set(word, count); else counts.delete(word);
    }
    if (counts.size > best) { best = counts.size; start = from; }
  }
  return visibleText.slice(start, start + 80);
}

