import { describe, expect, it } from "vitest";

import { computeToolOffset, formatG10 } from "../util/toolAlign";

describe("computeToolOffset", () => {
	it("computes offset as ref-minus-tool machine position, plus the reference's existing offset", () => {
		// Reference reads X=100, tool reads X=95 (mounted 5mm further out) -> offset = +5
		const off = computeToolOffset({ x: 100, y: 20 }, { x: 95, y: 20 }, {}, false);
		expect(off.x).toBeCloseTo(5);
		expect(off.y).toBeCloseTo(0);
	});

	it("carries the reference tool's own existing G10 offset", () => {
		const off = computeToolOffset({ x: 100 }, { x: 95 }, { x: 1.2 }, false);
		expect(off.x).toBeCloseTo(6.2);
	});

	it("negates the result when invert is set", () => {
		const off = computeToolOffset({ x: 100 }, { x: 95 }, {}, true);
		expect(off.x).toBeCloseTo(-5);
	});

	it("only sets axes captured on both sides", () => {
		const off = computeToolOffset({ x: 100 }, { y: 20 }, {}, false);
		expect(off.x).toBeUndefined();
		expect(off.y).toBeUndefined();
	});
});

describe("formatG10", () => {
	it("formats only the axes present", () => {
		expect(formatG10(2, { x: 5, y: -1.5 })).toBe("G10 P2 X5.000 Y-1.500");
	});

	it("returns null when no axis is set", () => {
		expect(formatG10(2, {})).toBeNull();
	});
});
