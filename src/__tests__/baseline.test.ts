import { describe, expect, it } from "vitest";

import { highpassDoG, polyBaselineIRLS } from "../model/eddyScan/baseline";

describe("polyBaselineIRLS", () => {
	it("recovers a linear baseline while ignoring an injected peak", () => {
		const xs = Array.from({ length: 15 }, (_, i) => i - 7); // -7..7
		const trueBaseline = (x: number) => 2 * x + 1;
		const fs = xs.map(trueBaseline);
		const spikeIndex = 7; // x = 0
		fs[spikeIndex] += 8;

		const baseline = polyBaselineIRLS(xs, fs, 1, 6);
		xs.forEach((x, i) => {
			if (i === spikeIndex) return;
			expect(baseline[i]).toBeCloseTo(trueBaseline(x), 1);
		});
	});
});

describe("highpassDoG", () => {
	it("removes a slow linear trend far from any peak, in the symmetric-kernel interior", () => {
		const xs = Array.from({ length: 61 }, (_, i) => i); // 0..60
		const trend = (x: number) => 0.5 * x;
		const fs = xs.map(trend);
		fs[30] += 10; // spike, far from the test point below

		const hp = highpassDoG(fs, 2);
		expect(hp[45]).toBeCloseTo(0, 6); // window [39,51]: fully interior, no spike in range
	});

	it("leaves most of an injected spike intact", () => {
		const xs = Array.from({ length: 61 }, (_, i) => i);
		const fs = xs.map((x) => 0.5 * x);
		fs[30] += 10;

		const hp = highpassDoG(fs, 2);
		expect(hp[30]).toBeGreaterThan(5);
	});
});
