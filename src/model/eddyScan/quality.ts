/**
 * Confidence scoring and invalid-scan detection. Combine these into a single reject/accept decision
 * rather than trusting a single R².
 */

/** MAD-based robust noise estimate from fit residuals — resistant to the peak itself being an
 *  outlier, unlike a plain standard deviation. */
export function robustNoiseStd(residuals: number[]): number {
	const sorted = [...residuals].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	const absDev = residuals.map((r) => Math.abs(r - median)).sort((a, b) => a - b);
	return absDev[Math.floor(absDev.length / 2)] * 1.4826;
}

/** True if the coarse extremum sits at either edge of the sweep — the far side of the peak/valley
 *  was never captured (partial crash / too-short scan range). Check this before attempting a
 *  sub-sample fit; a monotonic edge can pass a curvature check on noise alone. Pass the response's
 *  polarity from detectPeakType() — checking argmax on a valley-shaped sweep misdiagnoses a
 *  perfectly good scan as incomplete. */
export function isIncompleteSweep(fs: number[], type: "peak" | "valley" = "peak"): boolean {
	let idx = 0;
	for (let i = 1; i < fs.length; i++) {
		if (type === "peak" ? fs[i] > fs[idx] : fs[i] < fs[idx]) idx = i;
	}
	return idx === 0 || idx === fs.length - 1;
}

/**
 * Whether a sweep's response rises (peak) or dips (valley) toward the coil center. Whether an eddy
 * reading rises or falls with nozzle proximity depends on toolboard firmware transforms nobody has
 * verified for lateral (XY) coupling — see docs/open-questions.md — so this can't be assumed, it has
 * to be detected per scan, the same way both prior-art Klipper plugins do it: compare the mean of the
 * outer edge bands against the mean of the center band.
 */
export function detectPeakType(fs: number[], edgeFraction = 0.25): "peak" | "valley" {
	const n = fs.length;
	if (n < 3) throw new Error("detectPeakType: needs at least 3 samples");
	const edgeCount = Math.max(1, Math.round(n * edgeFraction));
	const edge = [...fs.slice(0, edgeCount), ...fs.slice(n - edgeCount)];
	const center = fs.slice(edgeCount, n - edgeCount);
	if (center.length === 0) throw new Error("detectPeakType: edgeFraction leaves no center samples");

	const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
	const edgeMean = mean(edge);
	const centerMean = mean(center);
	if (centerMean > edgeMean) return "peak";
	if (centerMean < edgeMean) return "valley";

	// centerMean === edgeMean: for real (noisy) data this only happens when the sweep is genuinely
	// flat/no-signal, which is what the throw below is for. But it also happens by pure arithmetic
	// symmetry for a clean monotonic ramp (a linear sequence sliced into symmetric edge/center bands
	// always has equal sub-means) — that's an incomplete sweep, not a flat one, and misdiagnosing it
	// here would shadow isIncompleteSweep's own boundary check downstream. Distinguish the two by
	// actual spread: zero spread is genuinely flat; nonzero spread with tied means defaults to
	// "peak" and lets isIncompleteSweep catch the monotonic case at the boundary either way.
	if (Math.max(...fs) - Math.min(...fs) === 0) {
		throw new Error(
			"detectPeakType: no contrast between the sweep's center and its edges — the scan may not have crossed the coil",
		);
	}
	return "peak";
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

/** Rough SNR from raw sweep samples alone — no fit residuals needed. The edge samples should be flat
 *  background (same edge/center split detectPeakType() uses), so their own spread is a reasonable
 *  noise proxy, and the peak/valley's height above that background is the signal. */
export function estimateSnr(fs: number[], peakType: "peak" | "valley", edgeFraction = 0.25): number {
	const n = fs.length;
	const edgeCount = Math.max(1, Math.round(n * edgeFraction));
	const edge = [...fs.slice(0, edgeCount), ...fs.slice(n - edgeCount)];
	const edgeMean = edge.reduce((s, v) => s + v, 0) / edge.length;
	const noise = robustNoiseStd(edge.map((v) => v - edgeMean));
	const extremum = peakType === "peak" ? Math.max(...fs) : Math.min(...fs);
	const signal = Math.abs(extremum - edgeMean);
	return noise > 0 ? signal / noise : Infinity;
}

/**
 * The confidence actually wired into runCrossScan — a narrower relative of confidenceScore() above,
 * not that function with placeholder inputs. confidenceScore's shapeScore term needs sigmaNominal,
 * which nothing in this codebase has calibrated against real hardware yet (same
 * "pending real hardware" status as config.ts's weightedQuadraticSigma — see
 * docs/open-questions.md); its agreeScore term only means anything for a bidirectional scan's
 * forward/reverse pair. Faking either with a neutral placeholder to reuse confidenceScore() would
 * silently make 20-40% of the reported number always "perfect" regardless of the real scan — worse
 * than not having the term, since it looks like a real measurement. This blends only what's honestly
 * computable from any scan today: R² (does the fit describe the data) and SNR (is there enough
 * signal above the background to trust that fit in the first place) — R² alone can't distinguish a
 * clean fit to a strong signal from an equally clean fit to a nearly-flat sweep, and the latter is
 * exactly the case worth flagging.
 */
export function fitConfidence(rSquared: number, snr: number): number {
	const rScore = clamp01(rSquared);
	const snrScore = clamp01((snr - 2) / 8); // same SNR thresholds as confidenceScore, for consistency
	return rScore * 0.6 + snrScore * 0.4;
}
