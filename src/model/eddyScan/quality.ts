/**
 * Confidence scoring and invalid-scan detection. See docs/math.md for the reasoning behind each
 * check; combine these into a single reject/accept decision rather than trusting a single R².
 */

/** MAD-based robust noise estimate from fit residuals — resistant to the peak itself being an
 *  outlier, unlike a plain standard deviation. */
export function robustNoiseStd(residuals: number[]): number {
	const sorted = [...residuals].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	const absDev = residuals.map((r) => Math.abs(r - median)).sort((a, b) => a - b);
	return absDev[Math.floor(absDev.length / 2)] * 1.4826;
}

/** True if the coarse argmax sits at either edge of the sweep — the far side of the peak was never
 *  captured (partial crash / too-short scan range). Check this before attempting a sub-sample fit;
 *  a monotonic edge can pass a curvature check on noise alone. */
export function isIncompleteSweep(fs: number[]): boolean {
	let argmax = 0;
	for (let i = 1; i < fs.length; i++) if (fs[i] > fs[argmax]) argmax = i;
	return argmax === 0 || argmax === fs.length - 1;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function confidenceScore(o: {
	rSquared: number;
	snr: number;
	sigmaFit: number;
	sigmaNominal: number;
	agreementSpread: number;
	expectedWidth: number;
}): number {
	const rScore = clamp01(o.rSquared);
	const snrScore = clamp01((o.snr - 2) / 8); // 0 at SNR<=2, 1 at SNR>=10
	const widthRatio = o.sigmaFit / o.sigmaNominal;
	const shapeScore = clamp01(1 - Math.abs(Math.log(widthRatio)) / Math.log(2)); // within 2x of nominal
	const agreeScore = clamp01(1 - o.agreementSpread / o.expectedWidth);
	return rScore * 0.35 + snrScore * 0.25 + shapeScore * 0.2 + agreeScore * 0.2;
}
