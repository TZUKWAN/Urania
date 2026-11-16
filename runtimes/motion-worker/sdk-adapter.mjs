/**
 * SDK edit adapter — trusted worker-side typed editing bridge.
 * Opens a composition headlessly, indexes real HfIds, applies typed ops,
 * serializes back to source. Used by host/motion routes via worker invocation.
 */
export async function editComposition(html, ops) {
	const sdk = await import('@hyperframes/sdk');
	const composition = await sdk.openComposition(html);
	const elements = composition.getElements();
	const index = new Map();
	for (const el of elements) index.set(el.hfId || el.id, el);
	const results = [];
	for (const op of ops) {
		const target = op.target || op.elementId;
		if (!target || !index.has(target)) { results.push({ op, ok: false, error: 'unknown HfId: ' + target }); continue; }
		const can = composition.can(op);
		if (can && can.ok === false) { results.push({ op, ok: false, error: 'can() refused', can }); continue; }
		try {
			if (op.type === 'setText') composition.setText(target, op.text);
			else if (op.type === 'setStyle') composition.setStyle(target, op.styles);
			else if (op.type === 'setAttribute') composition.setAttribute(target, op.name, op.value);
			else if (op.type === 'setTiming') composition.setTiming(target, op.timing);
			else if (op.type === 'removeElement') composition.removeElement(target);
			else if (op.type === 'addElement') { const newId = composition.addElement(op.parent, op.index ?? -1, op.html); results.push({ op, ok: true, newId }); continue; }
			else composition.dispatch(op);
			results.push({ op, ok: true, target });
		} catch (e) { results.push({ op, ok: false, error: String(e?.message || e) }); }
	}
	const serialized = composition.serialize();
	await composition.flush().catch(() => { });
	composition.dispose();
	return { results, html: serialized, hfidIndex: [...index.keys()] };
}
