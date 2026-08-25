import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startPolling } from "../model/liveProbe";

describe("startPolling", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("reads immediately, then again every interval, until stopped", async () => {
		let n = 0;
		const read = vi.fn(async () => ++n);
		const values: Array<number | null> = [];

		const stop = startPolling(read, 100, (v) => values.push(v));
		await vi.advanceTimersByTimeAsync(0);
		expect(values).toEqual([1]);

		await vi.advanceTimersByTimeAsync(250);
		expect(values).toEqual([1, 2, 3]);

		stop();
		await vi.advanceTimersByTimeAsync(500);
		expect(values).toEqual([1, 2, 3]); // no further reads after stop()
	});

	it("treats a rejected read as a null value and keeps polling", async () => {
		let n = 0;
		const read = vi.fn(async () => { n++; if (n === 2) throw new Error("boom"); return n; });
		const values: Array<number | null> = [];

		const stop = startPolling(read, 50, (v) => values.push(v));
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(50);
		await vi.advanceTimersByTimeAsync(50);
		stop();

		expect(values).toEqual([1, null, 3]);
	});
});
