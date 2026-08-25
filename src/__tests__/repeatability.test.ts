import { describe, expect, it } from "vitest";

import { defaultConfig } from "../model/config";
import type { MachineIO } from "../model/orchestrator";
import { runRepeatabilityCheck } from "../model/repeatability";
import { buildScanOffsets } from "../model/scanWorkflow";

function fakeIO(positions: Partial<Record<"X" | "Y" | "Z", number>> = {}) {
	const codes: string[] = [];
	const io: MachineIO = {
		sendCode: async (code) => { codes.push(code); return ""; },
		machinePos: (letter) => positions[letter] ?? null,
	};
	return { io, codes };
}

function queueReader(values: Array<number | null>) {
	let i = 0;
	return async () => values[i++] ?? null;
}

describe("runRepeatabilityCheck", () => {
	const offsets = buildScanOffsets(2, 0.5);
	// A true quadratic (not an approximated Gaussian) so weightedQuadraticPeak recovers each run's
	// center exactly — the mean/stddev this test checks are hand-computed exact values, not
	// approximations subject to fit-precision noise.
	const quad = (offset: number, mu: number) => -((offset - mu) ** 2) + 100;

	it("computes sample stddev (n-1) across successful runs, from exact per-run centers", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: null,
			scanHalfWidth: 2, scanStep: 0.5, settleMs: 0, fitMethod: "weightedQuadratic" as const,
		};
		const muX = [0.30, 0.34, 0.32];
		const muY = [-0.10, -0.08, -0.12];
		const readings = muX.flatMap((mx, i) => [
			...offsets.map((o) => quad(o, mx)),
			...offsets.map((o) => quad(o, muY[i])),
		]);

		const result = await runRepeatabilityCheck(io, queueReader(readings), cfg, 3, 3);

		expect(result.runs).toBe(3);
		expect(result.succeeded).toBe(3);
		// mean(muX) = 0.32, sample std = 0.02 (hand-computed: deviations -0.02,+0.02,0 -> variance
		// (0.0004+0.0004+0)/2 = 0.0004 -> std 0.02)
		expect(result.meanX).toBeCloseTo(100.32, 9);
		expect(result.stdX).toBeCloseTo(0.02, 9);
		// mean(muY) = -0.10, same spread pattern -> std 0.02
		expect(result.meanY).toBeCloseTo(49.9, 9);
		expect(result.stdY).toBeCloseTo(0.02, 9);
		expect(result.captures).toHaveLength(3);
	});

	it("reports all-null when every run fails", async () => {
		const { io } = fakeIO(); // no X/Y position -> every scan fails immediately
		const result = await runRepeatabilityCheck(io, queueReader([]), defaultConfig(), 0, 3);

		expect(result.succeeded).toBe(0);
		expect(result.meanX).toBeNull();
		expect(result.meanY).toBeNull();
		expect(result.stdX).toBeNull();
		expect(result.stdY).toBeNull();
	});

	it("reports a mean but null stddev (not 0) when only one run succeeds", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: null,
			scanHalfWidth: 2, scanStep: 0.5, settleMs: 0, fitMethod: "weightedQuadratic" as const,
		};
		const readings = [...offsets.map((o) => quad(o, 0.3)), ...offsets.map((o) => quad(o, -0.1))];

		const result = await runRepeatabilityCheck(io, queueReader(readings), cfg, 3, 1);

		expect(result.succeeded).toBe(1);
		expect(result.meanX).toBeCloseTo(100.3, 9);
		expect(result.stdX).toBeNull();
		expect(result.stdY).toBeNull();
	});

	it("stops early when shouldAbort becomes true", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: null,
			scanHalfWidth: 2, scanStep: 0.5, settleMs: 0,
		};

		const result = await runRepeatabilityCheck(io, queueReader([]), cfg, 3, 5, undefined, () => true);

		expect(result.succeeded).toBe(0);
		expect(result.captures).toEqual([]);
	});
});
