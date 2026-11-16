/**
 * DesignCraft motion preview relay — MV0-04 prototype.
 *
 * Serves published-revision composition HTML + pinned Player assets on an
 * unprivileged loopback origin (a different cookie hostname from DSH).
 * Security contract (EXECUTION_PLAN §10):
 *   - loopback bind only; Host header must match the bound host:port
 *   - no cookies, no DSH tokens, no write routes, no proxying
 *   - composition tokens are read-only, single-revision, minted by the host
 *   - external network requests are blocked by the outer sandbox (browser side),
 *     and this server never fetches anything
 *   - the preview page talks to DSH only via a bounded MessageChannel (ready/time/
 *     selection/bounds/error) — no storage, shell, or session actions
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PLAYER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../motion-worker/node_modules/@hyperframes/player/dist');
const state = {
	/** token → { html, revision, createdAt } — single-revision read-only grants */
	tokens: new Map(),
	server: null,
	port: 0,
	host: '127.0.0.2'
};

export function mintCompositionToken(revision, html, ttlMs = 30 * 60 * 1000) {
	const token = crypto.randomBytes(24).toString('base64url');
	state.tokens.set(token, { html, revision, createdAt: Date.now(), ttlMs });
	// sweep expired
	for (const [k, v] of state.tokens) if (Date.now() - v.createdAt > v.ttlMs) state.tokens.delete(k);
	return token;
}

export function revokeCompositionToken(token) { state.tokens.delete(token); }

export function revokeAll() { state.tokens.clear(); }

function playerAsset(name) {
	const safe = path.basename(name);
	const file = path.join(PLAYER_DIR, safe);
	if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
	return file;
}

const PREVIEW_PAGE = String.raw`<!doctype html>
<html><head><meta charset="utf-8"><title>DesignCraft Motion Preview</title>
<style>html,body{margin:0;height:100%;background:#111;overflow:hidden}#stage{position:absolute;inset:0}iframe#comp{border:0;width:100%;height:100%;background:#fff}</style>
<script src="/player/hyperframes-player.global.js"></script>
</head><body>
<div id="stage"></div>
<script>
// Preview host page: same-origin iframe for composition (hit-test requires
// same-origin per HyperFrames iframe adapter) + bounded MessageChannel to DSH.
(function(){
  let channel = null, port = null, current = null;
  const stage = document.getElementById('stage');

  function post(type, payload) {
    if (port) port.postMessage({ type, payload });
  }

  function loadRevision(compHtml, revision, opts) {
    if (current && current.parentNode) current.parentNode.removeChild(current);
    const iframe = document.createElement('iframe');
    iframe.id = 'comp';
    iframe.setAttribute('sandbox', 'allow-scripts'); // no same-origin-to-parent, no popups, no top navigation
    // srcdoc keeps the composition same-origin with THIS page (the unprivileged
    // preview origin), never with DSH.
    iframe.srcdoc = compHtml;
    current = iframe;
    stage.appendChild(iframe);
    iframe.addEventListener('load', () => {
      attachHitTest(iframe);
      post('ready', { revision });
    });
  }

  // hit-test: report elements with data-hf-id at a point (same-origin access is
  // exactly what the HyperFrames iframe adapter requires; here it stays inside
  // the preview origin, isolated from DSH).
  function attachHitTest(iframe) {
    try {
      const doc = iframe.contentDocument;
      doc.addEventListener('click', (ev) => {
        const el = ev.target && ev.target.closest ? ev.target.closest('[data-hf-id]') : null;
        const ids = el ? [el.getAttribute('data-hf-id')] : [];
        try {
          const all = doc.querySelectorAll('[data-hf-id]');
          post('selection', { ids, allCount: all.length, point: { x: ev.clientX, y: ev.clientY } });
        } catch (e) { post('error', { message: String(e) }); }
      }, true);
      doc.addEventListener('keydown', (ev) => {
        if (ev.shiftKey && ev.key === 'Escape') post('selection', { ids: [], allCount: 0, point: null });
      }, true);
    } catch (e) { post('error', { message: 'hit-test attach failed: ' + e }); }
  }

  // bounded MessageChannel handshake — validated by the host relay side
  window.addEventListener('message', (ev) => {
    const msg = ev.data || {};
    if (msg.type === 'dsh-handshake') {
      if (channel) { try { channel.port1.close(); } catch {} }
      channel = ev.ports && ev.ports[0];
      if (!channel) return;
      port = channel;
      port.onmessage = (m) => {
        const d = m.data || {};
        if (d.type === 'load') loadRevision(d.compHtml, d.revision);
        else if (d.type === 'ping') post('pong', { t: d.t });
        // anything else is rejected: no storage/shell/session actions exist here
        else post('error', { message: 'unsupported message type: ' + String(d.type) });
      };
      post('ready-handshake', {});
    }
  });
})();
</script>
</body></html>`;

export function startPreviewRelay({ host = '127.0.0.2', port = 0 } = {}) {
	return new Promise((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url, 'http://' + (req.headers.host || 'invalid'));
			// Host fence: only the bound loopback host:port is accepted
			const hostHeader = (req.headers.host || '').toLowerCase();
			const expected = (host + ':' + state.port).toLowerCase();
			if (hostHeader !== expected) {
				res.writeHead(403, { 'content-type': 'text/plain' }); res.end('host fence'); return;
			}
			// no cookies may arrive (preview origin shares nothing with DSH)
			if (req.headers.cookie) {
				res.writeHead(400, { 'content-type': 'text/plain' }); res.end('no cookies allowed'); return;
			}
			if (req.method !== 'GET') {
				res.writeHead(405, { 'content-type': 'text/plain' }); res.end('GET only'); return;
			}
			if (url.pathname === '/') {
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'SAMEORIGIN' });
				res.end(PREVIEW_PAGE); return;
			}
			if (url.pathname.startsWith('/composition/')) {
				const token = url.pathname.slice('/composition/'.length);
				const grant = state.tokens.get(token);
				if (!grant || Date.now() - grant.createdAt > grant.ttlMs) {
					res.writeHead(404, { 'content-type': 'text/plain' }); res.end('unknown or expired token'); return;
				}
				res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
				res.end(grant.html); return;
			}
			if (url.pathname.startsWith('/player/')) {
				const file = playerAsset(url.pathname.slice('/player/'.length));
				if (!file) { res.writeHead(404); res.end(); return; }
				res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' });
				res.end(fs.readFileSync(file)); return;
			}
			res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
		});
		server.on('error', reject);
		server.listen(port, host, () => {
			state.server = server;
			state.port = server.address().port;
			resolve({ host, port: state.port, close: () => new Promise(r => server.close(r)) });
		});
	});
}

export function relayState() { return { port: state.port, host: state.host, tokens: state.tokens.size }; }
