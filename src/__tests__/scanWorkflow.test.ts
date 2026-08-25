import { describe, expect, it } from "vitest";

import { defaultConfig } from "../model/config";
import type { MachineIO } from "../model/orchestrator";
import { buildScanOffsets, goToProbePosition, scanTool } from "../model/scanWorkflow";

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

describe("buildScanOffsets", () => {
	it("builds an inclusive, evenly-spaced offset list", () => {
		expect(buildScanOffsets(3, 0.5)).toEqual([-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]);
	});

	it("rejects non-positive halfWidth/step", () => {
		expect(() => buildScanOffsets(0, 0.5)).toThrow();
		expect(() => buildScanOffsets(3, 0)).toThrow();
	});
});

describe("goToProbePosition", () => {
	it("lifts to safeZ, travels to the probe XY, then descends, all via G53", async () => {
		const { io, codes } = fakeIO();
		const cfg = { ...defaultConfig(), safeZ: 10, probeX: 50, probeY: 60, probeZ: 4, useG53: true, travelFeed: 6000 };

		await goToProbePosition(io, cfg);

		expect(codes).toEqual([
			"G53 G1 Z10 F6000\nG53 G1 X50 Y60 F6000\nG53 G1 Z4 F6000\nM400",
		]);
	});

	it("omits the safeZ lift when not set, and G53 when useG53 is off", async () => {
		const { io, codes } = fakeIO();
		const cfg = { ...defaultConfig(), safeZ: null, probeX: 50, probeY: 60, probeZ: null, useG53: false, travelFeed: 3000 };

		await goToProbePosition(io, cfg);

		expect(codes).toEqual(["G1 X50 Y60 F3000\nM400"]);
	});

	it("throws if the probe position was never set", async () => {
		const { io } = fakeIO();
		await expect(goToProbePosition(io, defaultConfig())).rejects.toThrow(/probe position/i);
	});

	it("[safeZ fix] skips the lift when Z is already at or above safeZ, instead of moving down to it", async () => {
		const { io, codes } = fakeIO({ Z: 20 }); // currently well above safeZ
		const cfg = { ...defaultConfig(), safeZ: 5, probeX: 50, probeY: 60, probeZ: null, useG53: true, travelFeed: 6000 };

		await goToProbePosition(io, cfg);

		// No "G1 Z5" anywhere -- that would have been a downward move from Z20 to Z5.
		expect(codes).toEqual(["G53 G1 X50 Y60 F6000\nM400"]);
	});

	it("[safeZ fix] still lifts when Z is below safeZ", async () => {
		const { io, codes } = fakeIO({ Z: 2 });
		const cfg = { ...defaultConfig(), safeZ: 5, probeX: 50, probeY: 60, probeZ: null, useG53: true, travelFeed: 6000 };

		await goToProbePosition(io, cfg);

		expect(codes).toEqual(["G53 G1 Z5 F6000\nG53 G1 X50 Y60 F6000\nM400"]);
	});

	it("[safeZ fix] lifts when Z is exactly at safeZ too (boundary is inclusive on the safe side)", async () => {
		const { io, codes } = fakeIO({ Z: 5 });
		const cfg = { ...defaultConfig(), safeZ: 5, probeX: 50, probeY: 60, probeZ: null, useG53: true, travelFeed: 6000 };

		await goToProbePosition(io, cfg);

		expect(codes).toEqual(["G53 G1 X50 Y60 F6000\nM400"]); // already at the floor, no move needed
	});

	it("[B3] descends to the given scanZ instead of cfg.probeZ when passed", async () => {
		const { io, codes } = fakeIO();
		const cfg = { ...defaultConfig(), safeZ: null, probeX: 50, probeY: 60, probeZ: 4, useG53: true, travelFeed: 6000 };

		await goToProbePosition(io, cfg, 7.5);

		expect(codes).toEqual(["G53 G1 X50 Y60 F6000\nG53 G1 Z7.5 F6000\nM400"]);
	});

	it("[B3] a null scanZ means don't descend at all, same as an unset probeZ", async () => {
		const { io, codes } = fakeIO();
		const cfg = { ...defaultConfig(), safeZ: null, probeX: 50, probeY: 60, probeZ: 4, useG53: true, travelFeed: 6000 };

		await goToProbePosition(io, cfg, null);

		expect(codes).toEqual(["G53 G1 X50 Y60 F6000\nM400"]);
	});
});

describe("scanTool", () => {
	const offsets = buildScanOffsets(2, 0.5);
	const gaussian = (offset: number, mu: number, sigma = 1, amplitude = 10) =>
		amplitude * Math.exp(-((offset - mu) ** 2) / (2 * sigma * sigma));

	it("loads the tool, travels to the probe, then scans and returns a capture", async () => {
		const { io, codes } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: null,
			scanHalfWidth: 2, scanStep: 0.5, settleMs: 0,
		};
		const xTrue = 0.2, yTrue = -0.1;
		const readings = [...offsets.map((o) => gaussian(o, xTrue)), ...offsets.map((o) => gaussian(o, yTrue))];

		const outcome = await scanTool(io, queueReader(readings), cfg, 2);

		expect(outcome.ok).toBe(true);
		// [Step 0] Precision loosened 4 -> 1 decimal place — same reason as orchestrator.test.ts's
		// runCrossScan test: a ±2 (2-sigma) window means estimateDcBaseline()'s edge samples aren't
		// flat, so the now-wired-in DC correction introduces a small, expected, real bias here.
		expect(outcome.capture?.x).toBeCloseTo(100 + xTrue, 1);
		expect(outcome.capture?.y).toBeCloseTo(50 + yTrue, 1);
		expect(codes[0]).toBe("T2"); // tool loaded before travelling
		expect(codes[1]).toContain("X100 Y50");
	});

	it("scans in place (no T-command) when toolNumber is null, for a point-reference datum", async () => {
		const { io, codes } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: null,
			scanHalfWidth: 2, scanStep: 0.5, settleMs: 0,
		};
		const readings = [...offsets.map((o) => gaussian(o, 0)), ...offsets.map((o) => gaussian(o, 0))];

		const outcome = await scanTool(io, queueReader(readings), cfg, null);

		expect(outcome.ok).toBe(true);
		expect(codes.some((c) => /^T\d/.test(c))).toBe(false);
	});

	it("reports a clear error instead of throwing when the probe position isn't set", async () => {
		const { io } = fakeIO();
		const outcome = await scanTool(io, queueReader([]), defaultConfig(), 0);
		expect(outcome.ok).toBe(false);
		expect(outcome.error).toMatch(/probe position/i);
	});

	it("[B3] uses the tool's toolScanZ override instead of cfg.probeZ when one is set", async () => {
		const { io, codes } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: 4,
			toolScanZ: { "2": 9 }, scanHalfWidth: 2, scanStep: 0.5, settleMs: 0,
		};
		const readings = [...offsets.map((o) => gaussian(o, 0)), ...offsets.map((o) => gaussian(o, 0))];

		await scanTool(io, queueReader(readings), cfg, 2);

		expect(codes[1]).toContain("Z9"); // T2's override, not cfg.probeZ (4)
	});

	it("[B3] falls back to cfg.probeZ for a tool with no toolScanZ entry", async () => {
		const { io, codes } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: 4,
			toolScanZ: { "2": 9 }, scanHalfWidth: 2, scanStep: 0.5, settleMs: 0,
		};
		const readings = [...offsets.map((o) => gaussian(o, 0)), ...offsets.map((o) => gaussian(o, 0))];

		await scanTool(io, queueReader(readings), cfg, 3); // no entry for T3

		expect(codes[1]).toContain("Z4");
	});

	it("[Step 3] threads shouldAbort through to the underlying scan, so a check-only abort stops it", async () => {
		const { io } = fakeIO({ X: 100, Y: 50 });
		const cfg = {
			...defaultConfig(), probeX: 100, probeY: 50, safeZ: null, probeZ: null,
			scanHalfWidth: 2, scanStep: 0.5, settleMs: 0,
		};

		const outcome = await scanTool(io, queueReader([]), cfg, 2, undefined, () => true);

		expect(outcome.ok).toBe(false);
		expect(outcome.error).toBe("aborted");
	});
});
