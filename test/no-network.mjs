// Loaded before every test. The suite runs with the line cut: anything that reaches for the wire gets a closed door and a reason.
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';

const refuse = () => {
  throw new Error('network is off in tests');
};

net.Socket.prototype.connect = refuse;
tls.connect = refuse;
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  dns[name] = refuse;
  dns.promises[name] = refuse;
}
globalThis.fetch = refuse;
globalThis.WebSocket = class {
  constructor() {
    refuse();
  }
};
