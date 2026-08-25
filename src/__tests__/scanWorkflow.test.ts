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
		expect(outcome.capture?.x).toBeCloseTo(100 + xTrue, 4);
		expect(outcome.capture?.y).toBeCloseTo(50 + yTrue, 4);
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
});
