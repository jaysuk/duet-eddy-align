import { describe, expect, it } from "vitest";

import { jogAxisCode, type MachineIO, makeProbeReader, type ReadProbe, runCrossScan, sweepLine } from "../model/orchestrator";

function fakeIO(positions: Partial<Record<"X" | "Y" | "Z", number>>) {
	const codes: string[] = [];
	const io: MachineIO = {
		sendCode: async (code) => { codes.push(code); return ""; },
		machinePos: (letter) => positions[letter] ?? null,
	};
	return { io, codes };
}

function queueReader(values: Array<number | null>): ReadProbe {
	let i = 0;
	return async () => values[i++] ?? null;
}

describe("sweepLine", () => {
	it("jogs through each offset in order, samples once per point, and returns to start", async () => {
		const { io, codes } = fakeIO({ X: 10 });
		const readProbe = queueReader([1, 2, 3, 2, 1]);

		const points = await sweepLine(io, readProbe, "X", [-2, -1, 0, 1, 2], { jogFeed: 600, settleMs: 0 });

		expect(points).toEqual([
			{ x: 8, f: 1 }, { x: 9, f: 2 }, { x: 10, f: 3 }, { x: 11, f: 2 }, { x: 12, f: 1 },
		]);
		expect(codes).toEqual([
			jogAxisCode("X", -2, 600),
			jogAxisCode("X", 1, 600),
			jogAxisCode("X", 1, 600),
			jogAxisCode("X", 1, 600),
			jogAxisCode("X", 1, 600),
			jogAxisCode("X", -2, 600), // return to start
		]);
	});

	it("drops points where the probe didn't settle, but still jogs and returns normally", async () => {
		const { io } = fakeIO({ X: 10 });
		const readProbe = queueReader([1, null, 3, 2, 1]);

		const points = await sweepLine(io, readProbe, "X", [-2, -1, 0, 1, 2], { jogFeed: 600, settleMs: 0 });

		expect(points).toEqual([{ x: 8, f: 1 }, { x: 10, f: 3 }, { x: 11, f: 2 }, { x: 12, f: 1 }]);
	});

	it("throws if the axis position is unavailable (not homed)", async () => {
		const { io } = fakeIO({});
		await expect(sweepLine(io, queueReader([1]), "X", [0], { jogFeed: 600, settleMs: 0 })).rejects.toThrow(/home/i);
	});
});

describe("makeProbeReader", () => {
	it("queries the right object-model path and parses the M409 result", async () => {
		const codes: string[] = [];
		const io: MachineIO = {
			sendCode: async (code) => {
				codes.push(code);
				return '{"key":"sensors.probes[0].value[0]","flags":"","result":1234}\n';
			},
			machinePos: () => null,
		};

		const read = makeProbeReader(io, 0);
		await expect(read()).resolves.toBe(1234);
		expect(codes).toEqual(['M409 K"sensors.probes[0].value[0]"']);
	});

	it("uses the given probe index in the query path", async () => {
		const codes: string[] = [];
		const io: MachineIO = { sendCode: async (c) => { codes.push(c); return '{"result":5}'; }, machinePos: () => null };

		await makeProbeReader(io, 2)();
		expect(codes).toEqual(['M409 K"sensors.probes[2].value[0]"']);
	});

	it("returns null on a malformed or non-numeric reply instead of throwing", async () => {
		const ioBadJson: MachineIO = { sendCode: async () => "not json", machinePos: () => null };
		await expect(makeProbeReader(ioBadJson)()).resolves.toBeNull();

		const ioNoResult: MachineIO = { sendCode: async () => '{"key":"x","result":"n/a"}', machinePos: () => null };
		await expect(makeProbeReader(ioNoResult)()).resolves.toBeNull();
	});

	it("treats RRF's 999999 out-of-range sentinel as null, not a real reading", async () => {
		const io: MachineIO = { sendCode: async () => '{"result":999999}', machinePos: () => null };
		await expect(makeProbeReader(io)()).resolves.toBeNull();

		const ioNeg: MachineIO = { sendCode: async () => '{"result":-999999}', machinePos: () => null };
		await expect(makeProbeReader(ioNeg)()).resolves.toBeNull();
	});
});

describe("runCrossScan", () => {
	const offsets = [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2];
	const gaussian = (offset: number, mu: number, sigma = 1, amplitude = 10) =>
		amplitude * Math.exp(-((offset - mu) ** 2) / (2 * sigma * sigma));

	it("recovers a known (x, y) nozzle center from synthetic noise-free sweeps", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		const xTrue = 0.4, yTrue = -0.3;
		const readings = [
			...offsets.map((o) => gaussian(o, xTrue)), // X sweep
			...offsets.map((o) => gaussian(o, yTrue)), // Y sweep
		];

		const result = await runCrossScan(io, queueReader(readings), offsets, { jogFeed: 600, settleMs: 0 });

		expect(result.ok).toBe(true);
		// [Step 0] Precision loosened from 4 to 1 decimal place, deliberately: this sweep's window is
		// only ±2 (2 sigma), so the Gaussian tails at the edge samples estimateDcBaseline() averages
		// haven't decayed to flat — they still carry real curvature. Subtracting that estimate is
		// exactly correct behaviour for real hardware data (a huge, genuinely-flat DC offset, per
		// Step 0b), but on this narrow-window synthetic signal it introduces a small, real, expected
		// bias (~0.02mm here) that no longer fits a 4-decimal tolerance. A wider window relative to
		// sigma (as the bring-up guide recommends sizing in practice) would not show this.
		expect(result.position?.x).toBeCloseTo(100 + xTrue, 1);
		expect(result.position?.y).toBeCloseTo(50 + yTrue, 1);
		// Same root cause: R² is computed against the DC-corrected data (Step 0b), and on this
		// narrow window the correction is an imperfect (though correctly-behaving) approximation, so
		// R² is real but no longer ~1. Still comfortably high enough to signal a clean fit.
		expect(result.confidence).toBeGreaterThan(0.75);
	});

	it("rejects a scan whose peak sits at the edge (incomplete sweep)", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		// Monotonically increasing across the whole X window — the real peak is off the end.
		const xReadings = offsets.map((o, i) => i);
		const result = await runCrossScan(io, queueReader(xReadings), offsets, { jogFeed: 600, settleMs: 0 });

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/X sweep incomplete/);
	});

	it("[Step 1] auto-switches to weightedQuadratic on a valley-shaped response, instead of failing", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		// A dip, not a bump: center lower than the edges, extremum well inside the window.
		const valley = (offset: number, mu: number, sigma = 1, depth = 10) =>
			-depth * Math.exp(-((offset - mu) ** 2) / (2 * sigma * sigma));
		const xTrue = 0.4, yTrue = -0.2;
		const readings = [
			...offsets.map((o) => 100 + valley(o, xTrue)),
			...offsets.map((o) => 100 + valley(o, yTrue)),
		];

		const result = await runCrossScan(io, queueReader(readings), offsets, { jogFeed: 600, settleMs: 0 });

		expect(result.ok).toBe(true);
		expect(result.peakType).toBe("valley");
		expect(result.methodUsed).toBe("weightedQuadratic");
		// This is an integration test for the auto-switch mechanism, not the fit's precision (see
		// peak1d.test.ts for that) — the local-quadratic approximation to a true Gaussian has a small,
		// expected bias on a ±2 (2-sigma) window with the default weightedQuadraticSigma of 1.0.
		expect(Math.abs((result.position?.x ?? NaN) - (100 + xTrue))).toBeLessThan(0.1);
		expect(Math.abs((result.position?.y ?? NaN) - (50 + yTrue))).toBeLessThan(0.1);
	});

	it("rejects a scan where X and Y disagree on response polarity", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		const peakFs = offsets.map((o) => gaussian(o, 0.4)); // X: a peak
		const valleyFs = offsets.map((o) => -gaussian(o, -0.2)); // Y: a valley
		const result = await runCrossScan(io, queueReader([...peakFs, ...valleyFs]), offsets, { jogFeed: 600, settleMs: 0 });

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/disagree on response polarity/);
	});

	it("reports abort without throwing", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		const result = await runCrossScan(
			io, queueReader([]), offsets, { jogFeed: 600, settleMs: 0, shouldAbort: () => true },
		);
		expect(result.ok).toBe(false);
		expect(result.error).toBe("aborted");
	});
});
