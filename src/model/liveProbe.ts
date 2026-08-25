/**
 * Continuous polling of one probe reading, for the Setup panel's live-reading display — the fastest
 * way to confirm the M409 query (orchestrator.ts's makeProbeReader) actually returns sane numbers on
 * real hardware before trusting anything the automated scan/fit pipeline produces.
 */

export function startPolling(
	read: () => Promise<number | null>, intervalMs: number, onValue: (value: number | null) => void,
): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;

	async function tick(): Promise<void> {
		if (stopped) return;
		const value = await read().catch(() => null);
		if (stopped) return;
		onValue(value);
		timer = setTimeout(tick, intervalMs);
	}
	void tick();

	return () => {
		stopped = true;
		if (timer != null) clearTimeout(timer);
	};
}
