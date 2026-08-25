import { describe, expect, it } from "vitest";

import { applySavitzkyGolay, gaussianSmooth, medianFilter3, savitzkyGolayCoeffs } from "../model/eddyScan/smoothing";

describe("savitzkyGolayCoeffs", () => {
	it("matches the standard quadratic, window-5 table [-3,12,17,12,-3]/35", () => {
		const c = savitzkyGolayCoeffs(2, 2);
		const expected = [-3, 12, 17, 12, -3].map((v) => v / 35);
		c.forEach((v, i) => expect(v).toBeCloseTo(expected[i]));
	});
});

describe("applySavitzkyGolay", () => {
	it("exactly reproduces a quadratic signal (order-2 SG fits a quadratic exactly)", () => {
		const xs = Array.from({ length: 11 }, (_, i) => i - 5);
		const f = xs.map((x) => 2 * x * x - 3 * x + 7);
		const smoothed = applySavitzkyGolay(f, 2, 2);
		for (let i = 2; i < f.length - 2; i++) expect(smoothed[i]).toBeCloseTo(f[i], 6);
	});
});

describe("medianFilter3", () => {
	it("removes an isolated single-sample spike", () => {
		expect(medianFilter3([1, 1, 10, 1, 1])).toEqual([1, 1, 1, 1, 1]);
	});
});

describe("gaussianSmooth", () => {
	it("leaves a constant signal unchanged", () => {
		const f = new Array(9).fill(4.5);
		gaussianSmooth(f, 1.2).forEach((v) => expect(v).toBeCloseTo(4.5));
	});

	it("preserves the sample count", () => {
		expect(gaussianSmooth([1, 2, 3, 4, 5], 1).length).toBe(5);
	});
});
