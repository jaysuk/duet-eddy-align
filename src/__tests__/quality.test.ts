import { describe, expect, it } from "vitest";

import { confidenceScore, detectPeakType, isIncompleteSweep, robustNoiseStd } from "../model/eddyScan/quality";

describe("robustNoiseStd", () => {
	it("is resistant to a single large outlier (unlike a plain std dev)", () => {
		const residuals = [0, 0.1, -0.1, 0, 50];
		expect(robustNoiseStd(residuals)).toBeCloseTo(0.1 * 1.4826, 6);
	});
});

describe("isIncompleteSweep", () => {
	it("flags a peak sitting at the edge of the sweep", () => {
		expect(isIncompleteSweep([9, 5, 3, 1])).toBe(true);
		expect(isIncompleteSweep([1, 3, 5, 9])).toBe(true);
	});

	it("passes a peak sitting inside the sweep", () => {
		expect(isIncompleteSweep([1, 5, 9, 5, 1])).toBe(false);
	});

	it("flags a valley sitting at the edge of the sweep", () => {
		expect(isIncompleteSweep([1, 5, 9], "valley")).toBe(true);
	});

	it("passes a valley sitting inside the sweep", () => {
		expect(isIncompleteSweep([9, 5, 1, 5, 9], "valley")).toBe(false);
	});
});

describe("detectPeakType", () => {
	it("identifies a peak — center higher than the edges", () => {
		expect(detectPeakType([1, 5, 9, 5, 1])).toBe("peak");
	});

	it("identifies a valley — center lower than the edges", () => {
		expect(detectPeakType([9, 5, 1, 5, 9])).toBe("valley");
	});

	it("throws on a flat (zero-spread) sweep", () => {
		expect(() => detectPeakType([5, 5, 5, 5, 5])).toThrow(/no contrast/);
	});

	it("defaults to peak (not a throw) for a monotonic ramp, whose edge/center means tie by symmetry", () => {
		// A clean linear ramp has equal edge-mean and center-mean by pure arithmetic symmetry, but it
		// has real (nonzero) spread — an incomplete sweep, not a flat one. isIncompleteSweep catches
		// it downstream regardless of which polarity this defaults to.
		expect(detectPeakType([0, 1, 2, 3, 4, 5, 6, 7, 8])).toBe("peak");
	});
});

describe("confidenceScore", () => {
	it("scores a clean, well-agreeing fit near 1", () => {
		const score = confidenceScore({
			rSquared: 0.99, snr: 12, sigmaFit: 1.0, sigmaNominal: 1.0,
			agreementSpread: 0.02, expectedWidth: 1.0,
		});
		expect(score).toBeGreaterThan(0.9);
	});

	it("scores a noisy, disagreeing fit low", () => {
		const score = confidenceScore({
			rSquared: 0.4, snr: 1.5, sigmaFit: 4.0, sigmaNominal: 1.0,
			agreementSpread: 0.9, expectedWidth: 1.0,
		});
		expect(score).toBeLessThan(0.3);
	});

	it("always returns a value in [0, 1]", () => {
		const score = confidenceScore({
			rSquared: -3, snr: -10, sigmaFit: 50, sigmaNominal: 1,
			agreementSpread: 100, expectedWidth: 1,
		});
		expect(score).toBeGreaterThanOrEqual(0);
		expect(score).toBeLessThanOrEqual(1);
	});
});
