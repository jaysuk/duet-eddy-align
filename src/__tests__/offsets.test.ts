import { describe, expect, it } from "vitest";

import { defaultConfig } from "../model/config";
import { baseReferenceOffset, computeOffsetRows, referenceCapture } from "../model/offsets";

const tools = [
	{ number: 0, name: "T0", curX: 1.5, curY: -0.4 },
	{ number: 1, name: "T1", curX: 0, curY: 0 },
];

describe("referenceCapture", () => {
	it("uses the reference tool's capture in tool mode", () => {
		const captures = { 0: { x: 10, y: 20, confidence: 1 } };
		const cfg = { referenceMode: "tool" as const, referenceTool: 0 };
		expect(referenceCapture(cfg, captures, null)).toEqual({ x: 10, y: 20, confidence: 1 });
	});

	it("uses the captured datum in point mode, ignoring referenceTool", () => {
		const datum = { x: 5, y: 6, confidence: 1 };
		const cfg = { referenceMode: "point" as const, referenceTool: 0 };
		expect(referenceCapture(cfg, {}, datum)).toEqual(datum);
	});
});

describe("baseReferenceOffset", () => {
	it("is always zero in point mode, regardless of zeroReferenceOffset", () => {
		const cfg = { referenceMode: "point" as const, referenceTool: 0, zeroReferenceOffset: false };
		expect(baseReferenceOffset(cfg, tools)).toEqual({ x: 0, y: 0 });
	});

	it("inherits the reference tool's existing G10 in tool mode when zeroReferenceOffset is off", () => {
		const cfg = { referenceMode: "tool" as const, referenceTool: 0, zeroReferenceOffset: false };
		expect(baseReferenceOffset(cfg, tools)).toEqual({ x: 1.5, y: -0.4 });
	});

	it("ignores the reference tool's existing G10 when zeroReferenceOffset is on", () => {
		const cfg = { referenceMode: "tool" as const, referenceTool: 0, zeroReferenceOffset: true };
		expect(baseReferenceOffset(cfg, tools)).toEqual({ x: 0, y: 0 });
	});
});

describe("computeOffsetRows", () => {
	const captures = {
		0: { x: 100, y: 50, confidence: 0.95 },
		1: { x: 105, y: 49, confidence: 0.9 },
	};

	it("tool mode with zeroReferenceOffset off: reference keeps its existing G10, others computed relative to it", () => {
		const cfg = defaultConfig();
		cfg.referenceMode = "tool"; cfg.referenceTool = 0; cfg.zeroReferenceOffset = false;
		const rows = computeOffsetRows(tools, captures, null, cfg);

		// Reference tool (T0): its own capture vs itself -> refOffset unchanged (1.5, -0.4)
		expect(rows[0].g10).toBe("G10 P0 X1.500 Y-0.400");
		// T1: refOffset + (ref - tool) = (1.5, -0.4) + (100-105, 50-49) = (-3.5, 0.6)
		expect(rows[1].g10).toBe("G10 P1 X-3.500 Y0.600");
	});

	it("tool mode with zeroReferenceOffset on: reference gets a fresh zero baseline instead", () => {
		const cfg = defaultConfig();
		cfg.referenceMode = "tool"; cfg.referenceTool = 0; cfg.zeroReferenceOffset = true;
		const rows = computeOffsetRows(tools, captures, null, cfg);

		expect(rows[0].g10).toBe("G10 P0 X0.000 Y0.000"); // ref vs itself, zero baseline -> zero offset (still explicit)
		expect(rows[1].g10).toBe("G10 P1 X-5.000 Y1.000"); // (0,0) + (100-105, 50-49)
	});

	it("point mode measures every tool, including T0, against the captured datum", () => {
		const cfg = defaultConfig();
		cfg.referenceMode = "point";
		const datum = { x: 102, y: 51, confidence: 1 };
		const rows = computeOffsetRows(tools, captures, datum, cfg);

		expect(rows[0].g10).toBe("G10 P0 X2.000 Y1.000"); // (0,0) + (102-100, 51-50)
		expect(rows[1].g10).toBe("G10 P1 X-3.000 Y2.000"); // (0,0) + (102-105, 51-49)
	});

	it("leaves g10 null for a tool that hasn't been scanned yet", () => {
		const cfg = defaultConfig();
		cfg.referenceMode = "tool"; cfg.referenceTool = 0;
		const rows = computeOffsetRows(tools, { 0: captures[0] }, null, cfg);
		expect(rows[1].g10).toBeNull();
		expect(rows[1].capture).toBeNull();
	});

	describe("deltaFromCurrent", () => {
		it("is the new G10 minus the tool's current G10, per axis", () => {
			const cfg = defaultConfig();
			cfg.referenceMode = "tool"; cfg.referenceTool = 0; cfg.zeroReferenceOffset = false;
			const rows = computeOffsetRows(tools, captures, null, cfg);

			// T1: new G10 (-3.5, 0.6) - current G10 (0, 0) = (-3.5, 0.6)
			expect(rows[1].deltaFromCurrent).toEqual({ x: -3.5, y: 0.6 });
			// T0 (the reference itself): new G10 (1.5, -0.4) - current G10 (1.5, -0.4) = (0, 0)
			expect(rows[0].deltaFromCurrent).toEqual({ x: 0, y: 0 });
		});

		it("is omitted when the tool has no current G10 to compare against", () => {
			const noCurrentG10 = [{ number: 0, name: "T0", curX: null, curY: null }, tools[1]];
			const cfg = defaultConfig();
			cfg.referenceMode = "tool"; cfg.referenceTool = 0; cfg.zeroReferenceOffset = true;
			const rows = computeOffsetRows(noCurrentG10, captures, null, cfg);

			expect(rows[0].g10).not.toBeNull(); // an offset was still computed...
			expect(rows[0].deltaFromCurrent).toBeUndefined(); // ...just nothing to diff it against
		});

		it("is omitted when the tool hasn't been scanned (no fresh offset to compare)", () => {
			const cfg = defaultConfig();
			cfg.referenceMode = "tool"; cfg.referenceTool = 0;
			const rows = computeOffsetRows(tools, { 0: captures[0] }, null, cfg);
			expect(rows[1].deltaFromCurrent).toBeUndefined();
		});
	});
});
