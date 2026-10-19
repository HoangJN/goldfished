import { mulberry32 } from './prng.mjs';

function add(map, age, label) {
  if (!map.has(age)) map.set(age, { kept: 0, reworded: 0, gone: 0 });
  map.get(age)[label]++;
}

export function foldSession(session, grader, { sampleSeed }) {
  const fold = {
    ages: new Map(), comp: new Map(), notCounted: { short: 0, pasted: 0 },
    typed: session.typed.length, labelled: 0, goneSamples: [], auditPool: [],
  };
  const counted = session.typed.filter(({ text }) => {
    const length = [...text].length;
    if (length < 20) { fold.notCounted.short++; return false; }
    if (length > 1500) { fold.notCounted.pasted++; return false; }
    return true;
  });
  if (session.auto || session.sub) return fold;
  const prepared = session.compactions.flatMap(({ epoch, visible }, visibleIdx) =>
    visible === null ? [] : [{ epoch, visibleIdx, index: grader.prepare(visible) }]);
  const rng = mulberry32(sampleSeed);
  const gone = [];
  let seen = 0;
  for (const { epoch, text } of counted) {
    const labels = [];
    for (const { epoch: boundary, visibleIdx, index } of prepared) {
      if (boundary <= epoch) continue;
      const age = boundary - epoch;
      const { label, score } = grader.score(text, index);
      const entry = { age, label, score, text, visibleIdx };
      labels.push(entry);
      add(fold.ages, age, label);
      seen++;
      if (seen <= 5) fold.auditPool.push(entry);
      else {
        const slot = Math.floor(rng() * seen);
        if (slot < 5) fold.auditPool[slot] = entry;
      }
    }
    if (labels.length) fold.labelled++;
    if ([1, 2, 3].every(age => labels.some(entry => entry.age === age))) {
      for (const { age, label } of labels) add(fold.comp, age, label);
    }
    const last = labels.at(-1);
    if (last?.label === 'gone' && last.age >= 2) {
      gone.push({ epoch, age: last.age, text, lastMs: session.lastMs });
    }
  }
  fold.goneSamples = gone.reverse().sort((a, b) => b.epoch - a.epoch)
    .slice(0, 20).map(({ epoch, ...sample }) => sample);
  return fold;
}
