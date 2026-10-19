export async function main(agentId, event, rawStdin) {
  let home;
  try {
    if (!['claude-code', 'codex'].includes(agentId)) return;
    if (event === 'prompt' && (!/^\s*\{/.test(rawStdin) || !/"prompt"\s*:\s*"(?:rule|gf): /.test(rawStdin))) return;
    if (!['prompt', 'session-start'].includes(event)) return;
    const io = agentId === 'claude-code' ? await import('./agents/claude-code.hookio.mjs') : await import('./agents/codex.hookio.mjs');
    const input = JSON.parse(rawStdin), { cwd: cwdKey, prompt: promptKey, source: sourceKey, humanOrigin } = io.inputKeys;
    if (!input || typeof input[cwdKey] !== 'string') return;
    const prompt = input[promptKey];
    if (event === 'prompt' && (typeof prompt !== 'string' || !/^(rule|gf): /.test(prompt) ||
      (humanOrigin && input[humanOrigin.key] !== humanOrigin.value))) return;
    if (event === 'session-start' && input[sourceKey] !== 'compact') return;
    home = await import('./home.mjs');
    const project = await import('./project.mjs'), top = project.topLevel(input[cwdKey]);
    let output;
    if (event === 'prompt') {
      const actions = await import('./actions.mjs'), rule = prompt.startsWith('rule: ');
      const [verb, tail = ''] = rule ? ['rule', prompt.slice(6)] : prompt.slice(4).split(/\s+(.+)/s);
      let args = [tail];
      if (verb === 'out') { const split = /\s+--\s+/.exec(tail); args = split ? [tail.slice(0, split.index), '--quote', tail.slice(split.index + split[0].length)] : [tail]; }
      if (verb === 'accept') { const [pid, label] = tail.split(/\s+(.+)/s); args = label === undefined ? [pid] : [pid, label]; }
      const { reply } = actions.run(top, verb, args, { today: new Date().toISOString().slice(0, 10), via: 'chat' });
      output = rule ? io.screenOutput(reply) : io.blockOutput(reply);
    } else {
      const state = home.state(), entry = state.projects?.[top] ?? {};
      if (entry.off) output = io.screenOutput('goldfished: re-sends are off in this project. Turn them on with: gf: on');
      else {
        const store = await import('./store.mjs'), { block } = await import('./card.mjs'), { META } = await import('./agents/meta.mjs');
        const { statSync } = await import('node:fs');
        const load = where => {
          const loaded = store.load(where);
          try { if (!statSync(loaded.cardPath).isFile()) throw new Error('Card is not a file.'); }
          catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
          return loaded;
        };
        let loaded = load(top);
        if (!loaded) { const main = project.mainCheckout(top); if (main !== top) loaded = load(main); }
        if (!loaded) {
          if (entry.noCardNotice) return;
          home.setState({ projects: { ...state.projects, [top]: { ...entry, noCardNotice: true } } });
          output = io.screenOutput('goldfished: that compaction had no card to re-send. Set your goal with: goldfished goal "<text>"');
        } else {
          const { card, trusted } = loaded;
          const { text, left } = block(card, { trusted, budget: META[agentId].budget, kind: 'resend', ...(Number.isFinite(io.contextCap.chars) ? { maxChars: io.contextCap.chars } : {}) });
          if (!text) return;
          const count = (n, noun) => `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
          const receipt = (trusted ? `goldfished: card re-sent after compaction: ${count(card.goal ? 1 : 0, 'goal')}, ${count(card.rules.length, 'rule')}, ${card.out.length.toLocaleString('en-GB')} ruled out.` :
            'goldfished: card re-sent as project documentation, because it is not trusted on this machine. If it is yours, run: goldfished trust') +
            (left.length ? ` ${left.length.toLocaleString('en-GB')} did not fit (${left.join(' ')}).` : '');
          output = { ...io.contextOutput(text), ...io.screenOutput(receipt) };
        }
      }
    }
    process.stdout.write(JSON.stringify(output));
  } catch (error) {
    try { home ??= await import('./home.mjs'); home.logError(new Error(`Hook failed (${error.code ?? error.name}).`)); } catch {}
    try { if (event === 'session-start') process.stderr.write('goldfished: could not re-send your card. It is safe in .goldfished/card.md.\n'); } catch {}
  }
}
