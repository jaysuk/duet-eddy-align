import { describe, expect, it } from "vitest";

import {
	centroidPeak, gaussianLogFit, parabolic3pt, parabolicLSQPeak, refineGaussianNewton,
	resolvePeakFit, weightedQuadraticPeak,
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

describe("weightedQuadraticPeak", () => {
	it("recovers the exact vertex from a true quadratic, regardless of weighting", () => {
		const f = (xi: number) => -((xi - 0.3) ** 2) + 5;
		const xs = [-2, -1, 0, 1, 2];
		const fit = weightedQuadraticPeak(xs, xs.map(f), 5);
		expect(fit.xPeak).toBeCloseTo(0.3, 6);
		expect(fit.rSquared).toBeCloseTo(1, 6);
	});

	it("recovers close to the true center of a Gaussian bump (a local approximation, not exact)", () => {
		const A = 10, mu = 0.4, sigma = 0.8;
		const xs = [-1, -0.5, 0, 0.4, 0.8, 1.2, 1.6];
		const fs = xs.map((x) => A * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const fit = weightedQuadraticPeak(xs, fs, sigma);
		expect(fit.xPeak).toBeCloseTo(mu, 1);
	});

	it("handles a valley by flipping the curvature assertion, same vertex formula", () => {
		const mu = 0.4, sigma = 0.8;
		const xs = [-1, -0.5, 0, 0.4, 0.8, 1.2, 1.6];
		const fs = xs.map((x) => -10 * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const fit = weightedQuadraticPeak(xs, fs, sigma, "valley");
		expect(fit.xPeak).toBeCloseTo(mu, 1);
	});

	it("rejects a valley fit on peak-shaped data and vice versa", () => {
		const xs = [-1, -0.5, 0, 0.4, 0.8, 1.2, 1.6];
		const peakFs = xs.map((x) => 10 * Math.exp(-((x - 0.4) ** 2) / (2 * 0.64)));
		expect(() => weightedQuadraticPeak(xs, peakFs, 0.8, "valley")).toThrow(/local minimum/);
		const valleyFs = peakFs.map((v) => -v);
		expect(() => weightedQuadraticPeak(xs, valleyFs, 0.8, "peak")).toThrow(/local maximum/);
	});

	it("absorbs a large DC offset into c with zero effect on the recovered peak position", () => {
		const A = 10, mu = 0.4, sigma = 0.8;
		const xs = [-1, -0.5, 0, 0.4, 0.8, 1.2, 1.6];
		const fs = xs.map((x) => A * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const withoutDc = weightedQuadraticPeak(xs, fs, sigma);
		const withDc = weightedQuadraticPeak(xs, fs.map((v) => v + 100000), sigma);
		expect(withDc.xPeak).toBeCloseTo(withoutDc.xPeak, 9);
	});
});

describe("resolvePeakFit", () => {
	const mu = 0.4, sigma = 0.8;
	const xs = [-1, -0.5, 0, 0.4, 0.8, 1.2, 1.6];

	it("uses gaussianLogFit as requested for a peak — no switch", () => {
		const fs = xs.map((x) => 10 * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const result = resolvePeakFit(xs, fs, "gaussianLog", { peakType: "peak" });
		expect(result.methodUsed).toBe("gaussianLog");
		expect(result.x).toBeCloseTo(mu, 4);
	});

	it("auto-switches gaussianLog -> weightedQuadratic on a detected valley", () => {
		const fs = xs.map((x) => -10 * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const result = resolvePeakFit(xs, fs, "gaussianLog", { peakType: "valley", sigma });
		expect(result.methodUsed).toBe("weightedQuadratic");
		expect(result.x).toBeCloseTo(mu, 1);
	});

	it("never falls back the other way — weightedQuadratic stays weightedQuadratic for a peak", () => {
		const fs = xs.map((x) => 10 * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
		const result = resolvePeakFit(xs, fs, "weightedQuadratic", { peakType: "peak", sigma });
		expect(result.methodUsed).toBe("weightedQuadratic");
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
