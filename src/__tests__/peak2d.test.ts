import { describe, expect, it } from "vitest";

import { fitGaussian2D, fitParaboloid, paraboloidPeak, type Sample2D } from "../model/eddyScan/peak2d";

function grid(xs: number[], ys: number[], f: (x: number, y: number) => number): Sample2D[] {
	const pts: Sample2D[] = [];
	for (const x of xs) for (const y of ys) pts.push({ x, y, f: f(x, y) });
	return pts;
}

describe("fitParaboloid / paraboloidPeak", () => {
	it("recovers the exact vertex of a known concave paraboloid", () => {
		// f(x,y) = -(x-1)^2 - 2(y+0.5)^2 + 10 -> peak at (1, -0.5)
		const f = (x: number, y: number) => -((x - 1) ** 2) - 2 * (y + 0.5) ** 2 + 10;
		const pts = grid([-1, 0, 1, 2, 3], [-2, -1, 0, 1, 2], f);
		const peak = paraboloidPeak(fitParaboloid(pts));
		expect(peak.x).toBeCloseTo(1, 6);
		expect(peak.y).toBeCloseTo(-0.5, 6);
	});

	it("rejects a saddle surface", () => {
		// f(x,y) = x^2 - y^2 is a saddle everywhere — no valid maximum
		const pts = grid([-1, 0, 1], [-1, 0, 1], (x, y) => x * x - y * y);
		expect(() => paraboloidPeak(fitParaboloid(pts))).toThrow();
	});
});

describe("fitGaussian2D", () => {
	it("recovers amplitude/center/sigma from a noise-free axis-aligned Gaussian bump", () => {
		const A = 10, mux = 0.3, muy = -0.2, sigmaX = 1, sigmaY = 1.4;
		const f = (x: number, y: number) =>
			A * Math.exp(-((x - mux) ** 2 / (2 * sigmaX * sigmaX) + (y - muy) ** 2 / (2 * sigmaY * sigmaY)));
		const pts = grid([-1, -0.5, 0, 0.5, 1], [-1, -0.5, 0, 0.5, 1], f);
		const fit = fitGaussian2D(pts);
		expect(fit.mux).toBeCloseTo(mux, 3);
		expect(fit.muy).toBeCloseTo(muy, 3);
		expect(fit.sigmaX).toBeCloseTo(sigmaX, 3);
		expect(fit.sigmaY).toBeCloseTo(sigmaY, 3);
		expect(fit.amplitude).toBeCloseTo(A, 2);
	});
});
