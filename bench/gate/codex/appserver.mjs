import { spawn } from 'node:child_process';

export function forkAsk(codex, env, cwd, model, threadId, text, config) {
  return new Promise((resolve, reject) => {
    const c = spawn(codex, ['app-server'], { cwd, env });
    const answer = [];
    let buf = '';
    const send = (o) => c.stdin.write(JSON.stringify(o) + '\n');
    const end = (fn, v) => { clearTimeout(timer); c.kill(); fn(v); };
    const timer = setTimeout(() => end(reject, new Error('app server gave no answer')), 900000);
    c.stdout.on('data', (d) => {
      const lines = (buf + d).split('\n');
      buf = lines.pop();
      for (const l of lines) {
        const m = JSON.parse(l);
        if (m.method && m.id !== undefined) send({ id: m.id, error: { code: -32601, message: 'declined' } });
        else if (m.error) return end(reject, new Error(JSON.stringify(m.error).slice(0, 300)));
        else if (m.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method: 'thread/fork', params: { threadId, cwd, model, sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true, excludeTurns: true, config } });
        } else if (m.id === 2) send({ id: 3, method: 'turn/start', params: { threadId: m.result.thread.id, input: [{ type: 'text', text }] } });
        else if (m.method === 'item/completed' && m.params.item?.type === 'agentMessage') answer.push(m.params.item.text);
        else if (m.method === 'turn/completed') return end(resolve, { status: m.params.turn?.status, text: answer.join('\n') });
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'gfgate', title: null, version: '0' } } });
  });
}
