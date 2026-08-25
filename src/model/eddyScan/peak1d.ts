/**
 * Sub-sample peak location along a single 1D sweep (baseline-removed, per baseline.ts). Four
 * methods, cheapest/least-robust first — see quality.ts for how to cross-check them against each
 * other and flag a bad scan.
 */
import { invert3x3, solveLinear } from "./linalg";

export interface PeakFit { xPeak: number; a: number; b: number; c: number; rSquared: number; se: number; }
export interface GaussianFit { mu: number; sigma: number; amplitude: number; rSquared: number; }

export function fitQuality(observed: number[], fitted: number[], nParams: number) {
	const n = observed.length;
	const mean = observed.reduce((s, v) => s + v, 0) / n;
	let rss = 0, tss = 0;
	for (let i = 0; i < n; i++) {
		rss += (observed[i] - fitted[i]) ** 2;
		tss += (observed[i] - mean) ** 2;
	}
	return { rSquared: 1 - rss / tss, sigma2: rss / Math.max(n - nParams, 1) };
}

/** Least-squares fit of f(x) = ax² + bx + c via the closed-form normal equations. */
export function quadraticLSQ(xs: number[], fs: number[]) {
	let S0 = xs.length, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
	for (let i = 0; i < xs.length; i++) {
		const x = xs[i], f = fs[i], x2 = x * x;
		S1 += x; S2 += x2; S3 += x2 * x; S4 += x2 * x2;
		T0 += f; T1 += x * f; T2 += x2 * f;
	}
	const A = [[S4, S3, S2], [S3, S2, S1], [S2, S1, S0]];
	const [a, b, c] = solveLinear(A, [T2, T1, T0]);
	return { a, b, c, A };
}

/** Classic 3-point parabolic interpolation. Fastest, but only as good as three raw samples — run on
 *  already-smoothed data (see smoothing.ts). */
export function parabolic3pt(x0: number, dx: number, fMinus: number, f0: number, fPlus: number): number {
	const denom = fMinus - 2 * f0 + fPlus;
	if (denom >= 0) throw new Error("parabolic3pt: not a local maximum");
	return x0 + 0.5 * ((fMinus - fPlus) / denom) * dx;
}

/**
 * Least-squares parabola over a whole window (recommended default — averages noise across more than
 * three samples). Also returns the standard error of xPeak via the delta method: Var(x*) ≈
 * ∇g·Cov(θ)·∇gᵀ where Cov(θ) = σ²(XᵀX)⁻¹ and g(a,b,c) = -b/2a.
 */
export function parabolicLSQPeak(xs: number[], fs: number[]): PeakFit {
	const { a, b, c, A } = quadraticLSQ(xs, fs);
	if (a >= 0) throw new Error("parabolicLSQPeak: not a local maximum");

	const xPeak = -b / (2 * a);
	const fitted = xs.map((x) => a * x * x + b * x + c);
	const { rSquared, sigma2 } = fitQuality(fs, fitted, 3);

	const cov = invert3x3(A).map((row) => row.map((v) => v * sigma2));
	const g = [b / (2 * a * a), -1 / (2 * a), 0];
	let variance = 0;
	for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) variance += g[i] * cov[i][j] * g[j];

	return { xPeak, a, b, c, rSquared, se: Math.sqrt(Math.max(variance, 0)) };
}

/**
 * Gaussian fit via log-linearization: ln(A·exp(-(x-μ)²/2σ²)) is itself a quadratic in x, so this
 * reuses quadraticLSQ() on ln(f). μ = -b/2a is the same vertex formula as parabolicLSQPeak — this is
 * the well-known "Gaussian interpolation" identity from FFT peak picking.
 *
 * The log transform amplifies error near the tails, so only samples above `minFraction` of the peak
 * height are used — don't pass it the full sweep, only the near-peak window.
 */
export function gaussianLogFit(xs: number[], fs: number[], baseline = 0, minFraction = 0.15): GaussianFit {
	const peak = Math.max(...fs) - baseline;
	const pts = xs
		.map((x, i) => ({ x, f: fs[i] - baseline }))
		.filter((p) => p.f > peak * minFraction);
	const { a, b, c } = quadraticLSQ(pts.map((p) => p.x), pts.map((p) => Math.log(p.f)));
	if (a >= 0) throw new Error("gaussianLogFit: not a valid Gaussian peak");

	const mu = -b / (2 * a);
	const sigma = Math.sqrt(-1 / (2 * a));
	const amplitude = Math.exp(c - (b * b) / (4 * a));
	const fitted = xs.map((x) => baseline + amplitude * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
	return { mu, sigma, amplitude, rSquared: fitQuality(fs, fitted, 3).rSquared };
}

/**
 * Optional 3-parameter Gauss-Newton refinement, starting from gaussianLogFit()'s estimate, that
 * avoids the log transform's tail re-weighting. A handful of iterations is enough for N≈15-30.
 */
export function refineGaussianNewton(xs: number[], fs: number[], init: GaussianFit, iterations = 5): GaussianFit {
	let { amplitude: amp, mu, sigma } = init;

	for (let iter = 0; iter < iterations; iter++) {
		const J: number[][] = [], r: number[] = [];
		for (let i = 0; i < xs.length; i++) {
			const dx = xs[i] - mu;
			const g = Math.exp(-(dx * dx) / (2 * sigma * sigma));
			r.push(fs[i] - amp * g);
			J.push([-g, (-amp * g * dx) / (sigma * sigma), (-amp * g * dx * dx) / sigma ** 3]);
		}
		const JtJ = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
		const Jtr = [0, 0, 0];
		for (let i = 0; i < xs.length; i++) {
			for (let a = 0; a < 3; a++) {
				Jtr[a] += J[i][a] * r[i];
				for (let b = 0; b < 3; b++) JtJ[a][b] += J[i][a] * J[i][b];
			}
		}
		const [dA, dMu, dSigma] = solveLinear(JtJ, Jtr.map((v) => -v));
		amp += dA; mu += dMu; sigma += dSigma;
	}

	const fitted = xs.map((x) => amp * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma)));
	return { mu, sigma, amplitude: amp, rSquared: fitQuality(fs, fitted, 3).rSquared };
}

/** Threshold center-of-mass. Robust to non-Gaussian/asymmetric peak shape, but biased by an
 *  off-center window — always center the window on a coarse argmax first. */
export function centroidPeak(xs: number[], fs: number[], threshold: number): number {
	let num = 0, den = 0;
	for (let i = 0; i < xs.length; i++) {
		const w = Math.max(0, fs[i] - threshold);
		num += w * xs[i]; den += w;
	}
	if (den === 0) throw new Error("centroidPeak: no signal above threshold");
	return num / den;
}

export interface WeightedQuadraticFit { xPeak: number; a: number; b: number; c: number; rSquared: number; }

/**
 * Gaussian-weighted quadratic least-squares: fits y = ax²+bx+c with samples weighted by
 * exp(-(x-x0)²/2σ²) centered on the coarse extremum x0 — a *local* fit that only assumes smoothness
 * near the peak, unlike gaussianLogFit's assumption that the whole sweep is a clean Gaussian. Two
 * consequences that make this the more robust of the two fits on real hardware data: it absorbs any
 * DC offset straight into c (no baseline subtraction needed), and it handles a valley exactly as
 * easily as a peak — only the curvature assertion flips, unlike gaussianLogFit which needs a
 * positive signal with a maximum and can't fit a valley without inverting around an estimated
 * background.
 *
 * Solved via solveLinear (general Gauss-Jordan), not a hand-rolled Cramer's-rule determinant — see
 * docs/open-questions.md's Prior art section for the real bug that shortcut caused in prior art this
 * was adapted from.
 *
 * R² is computed *weighted* (ss_res/ss_tot both weighted by the same Gaussian kernel used for the
 * fit), not over the full unweighted window — a deliberately local fit will diverge in the tails, so
 * penalising it with full-window R² would score it down for something it never attempted. This means
 * its R² is not on the same scale as gaussianLogFit's; treat the two as method-relative, not
 * cross-comparable.
 */
export function weightedQuadraticPeak(
	xs: number[], fs: number[], sigma: number, peakType: "peak" | "valley" = "peak",
): WeightedQuadraticFit {
	let extremumIdx = 0;
	for (let i = 1; i < fs.length; i++) {
		if (peakType === "peak" ? fs[i] > fs[extremumIdx] : fs[i] < fs[extremumIdx]) extremumIdx = i;
	}
	const x0 = xs[extremumIdx];
	const weights = xs.map((x) => Math.exp(-((x - x0) ** 2) / (2 * sigma * sigma)));

	let Sw = 0, Swx = 0, Swx2 = 0, Swx3 = 0, Swx4 = 0, Swy = 0, Swxy = 0, Swx2y = 0;
	for (let i = 0; i < xs.length; i++) {
		const w = weights[i], x = xs[i], x2 = x * x, y = fs[i];
		Sw += w; Swx += w * x; Swx2 += w * x2; Swx3 += w * x2 * x; Swx4 += w * x2 * x2;
		Swy += w * y; Swxy += w * x * y; Swx2y += w * x2 * y;
	}
	const A = [[Swx4, Swx3, Swx2], [Swx3, Swx2, Swx], [Swx2, Swx, Sw]];
	const [a, b, c] = solveLinear(A, [Swx2y, Swxy, Swy]);

	if (peakType === "peak" && a >= 0) throw new Error("weightedQuadraticPeak: not a local maximum");
	if (peakType === "valley" && a <= 0) throw new Error("weightedQuadraticPeak: not a local minimum");

	const xPeak = -b / (2 * a);
	const fitted = xs.map((x) => a * x * x + b * x + c);
	const wMean = Swy / Sw;
	let ssResW = 0, ssTotW = 0;
	for (let i = 0; i < xs.length; i++) {
		ssResW += weights[i] * (fs[i] - fitted[i]) ** 2;
		ssTotW += weights[i] * (fs[i] - wMean) ** 2;
	}
	const rSquared = ssTotW > 0 ? 1 - ssResW / ssTotW : 0;

	return { xPeak, a, b, c, rSquared };
}

export type FitMethod = "gaussianLog" | "weightedQuadratic";

export interface ResolvedPeak {
	x: number;
	rSquared: number;
	peakType: "peak" | "valley";
	/** The fit actually used — may differ from the requested method; see the auto-switch note below. */
	methodUsed: FitMethod;
}

/**
 * Single dispatcher normalising gaussianLogFit's `.mu` and weightedQuadraticPeak's `.xPeak` into one
 * shape. Also owns the one auto-switch in this codebase: gaussianLogFit cannot fit a valley (it needs
 * a positive signal with a maximum — inverting a valley needs the background estimated first, which
 * is deferred work), so requesting "gaussianLog" on a detected valley transparently falls back to the
 * weighted quadratic instead of failing. This is one-directional only — a weightedQuadratic request
 * never falls back to gaussianLog, since it handles peaks natively. Callers MUST compare
 * `methodUsed` against what they requested and report a switch happened; a silent auto-switch would
 * be exactly the kind of misleading-diagnosis bug this function exists to avoid (see
 * docs/open-questions.md).
 */
export function resolvePeakFit(
	xs: number[], fs: number[], method: FitMethod,
	opts: { sigma?: number; peakType?: "peak" | "valley"; baseline?: number } = {},
): ResolvedPeak {
	const peakType = opts.peakType ?? "peak";
	const sigma = opts.sigma ?? 1.0;

	if (method === "weightedQuadratic" || peakType === "valley") {
		const fit = weightedQuadraticPeak(xs, fs, sigma, peakType);
		return { x: fit.xPeak, rSquared: fit.rSquared, peakType, methodUsed: "weightedQuadratic" };
	}
	const fit = gaussianLogFit(xs, fs, opts.baseline ?? 0);
	return { x: fit.mu, rSquared: fit.rSquared, peakType, methodUsed: "gaussianLog" };
}
