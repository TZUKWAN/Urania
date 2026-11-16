/** Capture DSH page console to find client load errors. */
import WebSocket from 'ws';

const port = process.argv[2] || '9223';
const res = await fetch(`http://127.0.0.1:${port}/json`);
const page = (await res.json()).find(t => t.type === 'page' && t.url.startsWith('dsh-app://'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });

const logs = [];
ws.on('message', (data) => {
	const msg = JSON.parse(data.toString());
	if (msg.method === 'Runtime.consoleAPICalled') {
		const text = (msg.params.args || []).map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300);
		logs.push(`[${msg.params.type}] ${text}`);
	} else if (msg.method === 'Runtime.exceptionThrown') {
		logs.push(`[exception] ${JSON.stringify(msg.params.exceptionDetails).slice(0, 400)}`);
	}
});
await ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
await ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
await ws.send(JSON.stringify({ id: 3, method: 'Page.reload' }));
await new Promise(r => setTimeout(r, 12000));
console.log(logs.filter(l => l.includes('designcraft') || l.includes('error') || l.includes('Error') || l.includes('exception') || l.includes('warn')).slice(0, 30).join('\n') || '(no matching logs)');
console.log('---all console (first 25)---');
console.log(logs.slice(0, 25).join('\n') || '(none)');
ws.close();
