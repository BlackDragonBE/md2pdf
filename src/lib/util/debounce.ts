export interface Debounced<A extends unknown[]> {
	(...args: A): void;
	/** Run the pending call now, if there is one. */
	flush(): void;
	cancel(): void;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: A | undefined;

	const run = (...args: A) => {
		pending = args;
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			const a = pending;
			pending = undefined;
			if (a) fn(...a);
		}, ms);
	};

	run.flush = () => {
		if (timer === undefined) return;
		clearTimeout(timer);
		timer = undefined;
		const a = pending;
		pending = undefined;
		if (a) fn(...a);
	};

	run.cancel = () => {
		if (timer !== undefined) clearTimeout(timer);
		timer = undefined;
		pending = undefined;
	};

	return run;
}
