import { describe, expect, it } from "vitest";

import { confidenceScore, isIncompleteSweep, robustNoiseStd } from "../model/eddyScan/quality";

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
