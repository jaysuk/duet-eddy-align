import { describe, expect, it } from "vitest";

import {
	centroidPeak, gaussianLogFit, parabolic3pt, parabolicLSQPeak, refineGaussianNewton,
} from "../model/eddyScan/peak1d";

describe("parabolic3pt", () => {
	it("recovers the exact vertex of a true parabola", () => {
		// f(ξ) = -(ξ-0.3)² + 5, sampled at ξ=-1,0,1
		const f = (xi: number) => -((xi - 0.3) ** 2) + 5;
		const xPeak = parabolic3pt(0, 1, f(-1), f(0), f(1));
		expect(xPeak).toBeCloseTo(0.3, 9);
	});

	it("rejects a non-maximum (upward curvature)", () => {
		expect(() => parabolic3pt(0, 1, 5, 1, 5)).toThrow();
	});
});

describe("parabolicLSQPeak", () => {
	it("recovers the exact vertex from noise-free samples on a window", () => {
		const f = (xi: number) => -((xi - 0.3) ** 2) + 5;
		const xs = [-2, -1, 0, 1, 2];
		const fit = parabolicLSQPeak(xs, xs.map(f));
		expect(fit.xPeak).toBeCloseTo(0.3, 6);
		expect(fit.rSquared).toBeCloseTo(1, 6);
		expect(fit.se).toBeCloseTo(0, 6);
	});
});

describe("gaussianLogFit", () => {
	it("recovers A, mu, sigma from a noise-free Gaussian bump", () => {
		const A = 10, mu = 0.4, sigma = 0.8;
		const xs = [-1, -0.5, 0, 0.4, 0.8, 1.2, 1.6];
		const fs = xs.map((x) => A * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const fit = gaussianLogFit(xs, fs);
		expect(fit.mu).toBeCloseTo(mu, 4);
		expect(fit.sigma).toBeCloseTo(sigma, 4);
		expect(fit.amplitude).toBeCloseTo(A, 3);
	});
});

describe("refineGaussianNewton", () => {
	it("converges to the true parameters from a perturbed starting point", () => {
		const A = 10, mu = 0.4, sigma = 0.8;
		const xs = [-1, -0.5, 0, 0.4, 0.8, 1.2, 1.6];
		const fs = xs.map((x) => A * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const init = { amplitude: A * 0.7, mu: mu + 0.3, sigma: sigma * 1.3, rSquared: 0 };
		const refined = refineGaussianNewton(xs, fs, init, 8);
		expect(refined.mu).toBeCloseTo(mu, 3);
		expect(refined.sigma).toBeCloseTo(sigma, 3);
		expect(refined.amplitude).toBeCloseTo(A, 2);
	});
});

describe("centroidPeak", () => {
	it("finds the center of a symmetric weighted bump", () => {
		const xs = [0, 1, 2, 3, 4];
		const fs = [0, 1, 3, 1, 0]; // symmetric around x=2
		expect(centroidPeak(xs, fs, 0)).toBeCloseTo(2, 9);
	});

	it("throws when nothing clears the threshold", () => {
		expect(() => centroidPeak([0, 1, 2], [1, 1, 1], 5)).toThrow();
	});
});
