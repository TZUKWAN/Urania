/** Inject client.js into the real DSH page to verify the UI code independent of the kernel combo. */
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';

const res = await fetch('http://127.0.0.1:9223/json');
const page = (await res.json()).find(t => t.type === 'page' && t.url.startsWith('dsh-app://'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
let id = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const mid = ++id;
	ws.send(JSON.stringify({ id: mid, method, params }));
	const h = (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id === mid) { ws.off('message', h); msg.error ? reject(new Error(JSON.stringify(msg.error).slice(0, 600))) : resolve(msg.result); }
	};
	ws.on('message', h);
});
await send('Runtime.enable');
const clientSrc = readFileSync('D:/METIS超级合并/dsh-plugin/designcraft/client/client.js', 'utf8');
const expr = `(async () => {
	try { new Function(${JSON.stringify(clientSrc)})(); }
	catch (e) { return 'EXEC-ERR: ' + e.message; }
	await new Promise(r2 => setTimeout(r2, 4000));
	const app = document.querySelector('.dcApp');
	return { appRendered: !!app, landing: app ? !!document.querySelector('.dcLanding') : false, appText: app ? (app.textContent || '').slice(0, 160) : null };
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.value || r, null, 1));
ws.close();
