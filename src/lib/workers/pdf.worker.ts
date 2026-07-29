import { generate } from '../pdf/engine';
import type { RenderRequest, RenderResponse } from './protocol';

const post = (message: RenderResponse, transfer?: Transferable[]) =>
	(self as unknown as Worker).postMessage(message, transfer ?? []);

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
	const req = event.data;
	try {
		const { buffer, pageCount, warnings, anchors } = await generate(req);
		// Transfer rather than copy (§8).
		post({ id: req.id, ok: true, buffer, pageCount, warnings, anchors }, [buffer]);
	} catch (e) {
		post({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) });
	}
};
