/**
 * Separating the tip response from the slower baseline (thermal drift, and the heater
 * block/cartridge/wiring sitting a few mm above the coil). See peak1d.ts for how the resulting
 * baseline-subtracted sweep feeds the sub-sample peak fits.
 */
import { solveLinear, type Mat } from "./linalg";
import { gaussianSmooth } from "./smoothing";

/**
 * Iteratively-reweighted low-order polynomial baseline: fits a polynomial to all points, then
 * down-weights samples sitting above the current baseline (the tip peak is, by construction, a
 * positive excursion) and refits. Converges in a handful of iterations to a baseline that ignores
 * the peak — a simplified relative of Eilers' asymmetric least-squares baseline, cheap enough to
 * redo on every sweep since N is only 15-30.
 */
export function polyBaselineIRLS(
	xs: number[], fs: number[], degree = 2, iterations = 5, downweight = 0.05,
): number[] {
	const n = xs.length, p = degree + 1;
	let weights = new Array(n).fill(1);
	let baseline = new Array(n).fill(0);

	for (let iter = 0; iter < iterations; iter++) {
		const XtWX: Mat = Array.from({ length: p }, () => new Array(p).fill(0));
		const XtWf = new Array(p).fill(0);
		for (let i = 0; i < n; i++) {
			const w = weights[i];
			const row = Array.from({ length: p }, (_, k) => Math.pow(xs[i], k));
			for (let a = 0; a < p; a++) {
				XtWf[a] += w * row[a] * fs[i];
				for (let b = 0; b < p; b++) XtWX[a][b] += w * row[a] * row[b];
			}
		}
		const theta = solveLinear(XtWX, XtWf);
		baseline = xs.map((x) => theta.reduce((s, c, k) => s + c * Math.pow(x, k), 0));
		weights = fs.map((f, i) => (f > baseline[i] ? downweight : 1));
	}
	return baseline;
}

/**
 * Difference-of-Gaussians high-pass: subtracts a heavily-smoothed (wide sigma) copy of the sweep
 * from itself. Because the heater-block/wiring background varies slowly relative to a wide-sigma
 * smoothing kernel while the tip response doesn't, most of the background survives entirely into the
 * subtracted "wide" copy and cancels out, leaving the tip peak largely intact. No second scan needed.
 */
export function highpassDoG(f: number[], sigmaWideSamples: number): number[] {
	const wide = gaussianSmooth(f, sigmaWideSamples);
	return f.map((v, i) => v - wide[i]);
}
