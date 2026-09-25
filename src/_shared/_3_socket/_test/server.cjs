// Local protocol fixture runs on Node to isolate Bun server shutdown behavior.
const { Server } = require('ws');
const mode = process.argv[2];
const server = new Server({ port: 0, host: '127.0.0.1' });
let connections = 0, subscriptions = 0;
server.on('listening', () => process.send({ port: server.address().port }));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.on('connection', socket => {
  process.send({ connections: ++connections });
  if (mode === 'solana') {
    socket.on('message', bytes => {
      const request = JSON.parse(bytes.toString());
      const result = request.method.endsWith('Unsubscribe') ? true : request.id + 100;
      socket.send(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
      if (request.method === 'accountSubscribe') {
        process.send({ subscriptions: ++subscriptions });
        socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'accountNotification', params: { subscription: result, result: { context: { slot: 42 }, value: null } } }));
      }
      if (request.method === 'slotSubscribe') socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'slotNotification', params: { subscription: result, result: { slot: 42, parent: 41, root: 40 } } }));
    });
    return;
  }
  if (mode.startsWith('alpaca')) {
    const number = connections;
    const symbols = new Set();
    socket.send(JSON.stringify([{ T: 'success', msg: 'connected' }]));
    socket.on('message', bytes => {
      const request = JSON.parse(bytes.toString());
      if (request.action === 'auth') {
        if (request.key !== 'local-key' || request.secret !== 'local-secret') throw new Error('Fixture authentication mismatch');
        socket.send(JSON.stringify(mode === 'alpaca-denied' ? [{ T: 'error', code: 409, msg: 'local-secret' }] : [{ T: 'success', msg: 'authenticated' }]));
        return;
      }
      for (const symbol of request.quotes) request.action === 'subscribe' ? symbols.add(symbol) : symbols.delete(symbol);
      socket.send(JSON.stringify([{ T: 'subscription', quotes: [...symbols] }]));
      if (request.action !== 'subscribe') return;
      process.send({ subscriptions: ++subscriptions });
      socket.send(JSON.stringify(request.quotes.map(S => ({ T: 'q', S, bp: 250.01, ap: 250.02, bs: 2, as: 3,
        c: ['R'], t: new Date(Date.parse('2026-09-23T15:00:00Z') + number).toISOString() }))));
      if (mode === 'alpaca-reconnect' && number === 1) setTimeout(() => socket.terminate(), 20);
    });
    return;
  }
  if (mode === 'kraken') {
    socket.send(JSON.stringify({ channel: 'status', data: [{ system: 'online' }] }));
    socket.on('message', bytes => {
      const request = JSON.parse(bytes.toString());
      socket.send(JSON.stringify({ method: request.method, success: true }));
      if (request.method !== 'subscribe') return;
      process.send({ subscriptions: ++subscriptions });
      for (const symbol of request.params.symbol) socket.send(JSON.stringify({ channel: 'ticker', type: 'snapshot',
        data: [{ symbol, bid: 0.9998, ask: 0.9999, bid_qty: 2000000, ask_qty: 2000000, timestamp: new Date().toISOString() }] }));
    });
    return;
  }
  if (mode === 'idle') return;
  socket.send(mode === 'malformed' ? 'not-json' : mode === 'oversized' ? 'x'.repeat(70000) : `connection-${connections}`);
  socket.on('message', () => socket.terminate());
});
process.on('message', message => {
  if (message !== 'stop') throw new Error('Unknown fixture control');
  for (const socket of server.clients) socket.terminate();
  server.close(error => {
    if (error) { console.error(error.message); process.exitCode = 1; }
    process.disconnect();
  });
});
