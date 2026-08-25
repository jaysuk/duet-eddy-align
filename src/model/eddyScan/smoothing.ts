/**
 * Despiking and smoothing for a short (N≈15-30 sample) sweep. Savitzky-Golay is the default over a
 * Gaussian moving window because it fits (and keeps) a local polynomial rather than low-pass
 * filtering — it preserves the curvature/amplitude the sub-sample peak fits in peak1d.ts rely on,
 * instead of broadening the peak and biasing the width-based quality checks in quality.ts.
 */
import { solveLinear, type Mat } from "./linalg";

/** Removes isolated single-sample spikes before smoothing. Not a substitute for SG/Gaussian smoothing. */
export function medianFilter3(f: number[]): number[] {
	const out = f.slice();
	for (let i = 1; i < f.length - 1; i++) {
		const [a, b, c] = [f[i - 1], f[i], f[i + 1]];
		out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
	}
	return out;
}

/** Pure low-pass. Prefer applySavitzkyGolay() for pre-peak-fit smoothing; use this only to tame
 *  broadband noise before that, if the raw sweep is too noisy for SG's local fit to be stable. */
export function gaussianSmooth(f: number[], sigmaSamples: number): number[] {
	const radius = Math.ceil(3 * sigmaSamples);
	const kernel: number[] = [];
	let sum = 0;
	for (let j = -radius; j <= radius; j++) {
		const w = Math.exp(-(j * j) / (2 * sigmaSamples * sigmaSamples));
		kernel.push(w);
		sum += w;
	}
	kernel.forEach((_, k) => (kernel[k] /= sum));

	return f.map((_, i) => {
		let acc = 0, wsum = 0;
		for (let j = -radius; j <= radius; j++) {
			const idx = i + j;
			if (idx < 0 || idx >= f.length) continue; // edge: renormalize over in-range taps only
			acc += kernel[j + radius] * f[idx];
			wsum += kernel[j + radius];
		}
		return acc / wsum;
	});
}

/**
 * Savitzky-Golay filter coefficients for a local degree-`order` polynomial fit over a window of
 * half-width `halfWidth`. Derived from the normal equations of that local fit rather than a
 * hardcoded table, so any window/order works: v = (JᵀJ)⁻¹e₀, c_j = J_j · v, where J's row j is the
 * local basis [1, j, j², ..., jᵖ]. Verified against the standard quadratic/window-5 table
 * ([-3,12,17,12,-3]/35) in smoothing.test.ts.
 */
export function savitzkyGolayCoeffs(halfWidth: number, order: number): number[] {
	const J: Mat = [];
	for (let j = -halfWidth; j <= halfWidth; j++) {
		J.push(Array.from({ length: order + 1 }, (_, k) => Math.pow(j, k)));
	}
	const p = order + 1;
	const JtJ: Mat = Array.from({ length: p }, () => new Array(p).fill(0));
	for (let a = 0; a < p; a++) {
		for (let b = 0; b < p; b++) {
			for (const row of J) JtJ[a][b] += row[a] * row[b];
		}
	}

	const e0 = new Array(p).fill(0);
	e0[0] = 1;
	const v = solveLinear(JtJ, e0); // (JᵀJ)⁻¹ e₀
	return J.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
}

/**
 * Edges (within `halfWidth` of either end) are left as-is — mirror-pad the input first if full
 * coverage is needed on a short sweep.
 */
export function applySavitzkyGolay(f: number[], halfWidth: number, order: number): number[] {
	const c = savitzkyGolayCoeffs(halfWidth, order);
	const out = f.slice();
	for (let i = halfWidth; i < f.length - halfWidth; i++) {
		out[i] = c.reduce((s, cj, j) => s + cj * f[i - halfWidth + j], 0);
	}
	return out;
}
