import { mulberry32 } from './prng.mjs';

const messages = c => c.kept + c.reworded + c.gone;
const empty = () => ({ kept: 0, reworded: 0, gone: 0, sessions: 0 });

export function combine(folds, key = 'ages') {
  const perSession = folds.map(f => f[key]);
  const total = new Map();
  for (const ages of perSession) for (const [age, counts] of ages) {
    const row = total.get(age) ?? empty();
    for (const label of ['kept', 'reworded', 'gone']) row[label] += counts[label];
    if (messages(counts) > 0) row.sessions++;
    total.set(age, row);
  }
  return { perSession, total };
}

export function curve(ages) {
  const highest = Math.min(10, Math.max(0, ...[...ages.total]
    .filter(([, c]) => messages(c) > 0).map(([age]) => age)));
  return Array.from({ length: highest }, (_, i) => {
    const age = i + 1, c = ages.total.get(age) ?? empty();
    return { age, messages: messages(c), sessions: c.sessions,
      kept: c.kept, reworded: c.reworded, gone: c.gone };
  });
}

export function bootstrap(ages, age, { B = 1000, seed = 1 } = {}) {
  const pool = ages.perSession.map(s => s.get(age)).filter(c => c && messages(c) > 0);
  if (!pool.length) return [null, null];
  const rng = mulberry32(seed), rates = [];
  for (let b = 0; b < B; b++) {
    let kept = 0, total = 0;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[Math.floor(rng() * pool.length)];
      kept += c.kept;
      total += messages(c);
    }
    rates.push(100 * kept / total);
  }
  rates.sort((a, b) => a - b);
  return [0.025, 0.975].map(p => rates[Math.max(1, Math.round(p * B)) - 1]);
}

export function measurable(row) {
  return row.messages >= 50 && row.sessions >= 10;
}

export function span(rows) {
  const byAge = new Map(rows.map(r => [r.age, r]));
  const headlineAge = Math.max(0, ...rows.filter(r => r.age >= 2 && measurable(r)).map(r => r.age)) || null;
  if (!byAge.has(1) || !measurable(byAge.get(1))) return { span: null, censored: false, headlineAge };
  let n = 0;
  while (byAge.has(n + 1)) {
    const row = byAge.get(n + 1);
    if (!measurable(row) || row.kept * 100 < 50 * row.messages) break;
    n++;
  }
  const censored = rows.every(r => !measurable(r) || r.kept * 100 >= 50 * r.messages);
  return { span: n, censored, headlineAge };
}

export function shifted(mainRows, compRows) {
  return [1, 2, 3].some(age => {
    const a = mainRows.find(r => r.age === age), b = compRows.find(r => r.age === age);
    return a?.messages > 0 && b?.messages > 0 &&
      Math.abs(a.kept * b.messages - b.kept * a.messages) * 100 > 5 * a.messages * b.messages;
  });
}
