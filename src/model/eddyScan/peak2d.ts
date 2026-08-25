/**
 * 2D surface fit for a raster scan, when a cheaper separable row/column pass (run two peak1d.ts fits
 * along the row/column nearest the coarse max) isn't accurate enough — e.g. the peak looks skewed
 * and axis-aligned marginal fits disagree.
 */
import { solveLinear, type Mat } from "./linalg";

export interface Sample2D { x: number; y: number; f: number; }
export interface Paraboloid { a: number; b: number; c: number; d: number; e: number; g: number; }

function normalEquations(rows: number[][], targets: number[]): number[] {
	const p = rows[0].length;
	const XtX: Mat = Array.from({ length: p }, () => new Array(p).fill(0));
	const Xty = new Array(p).fill(0);
	rows.forEach((row, i) => {
		for (let a = 0; a < p; a++) {
			Xty[a] += row[a] * targets[i];
			for (let b = 0; b < p; b++) XtX[a][b] += row[a] * row[b];
		}
	});
	return solveLinear(XtX, Xty);
}

/** f(x,y) = ax² + by² + cxy + dx + ey + g, fit by least squares over the whole raster. */
export function fitParaboloid(points: Sample2D[]): Paraboloid {
	const rows = points.map((p) => [p.x * p.x, p.y * p.y, p.x * p.y, p.x, p.y, 1]);
	const [a, b, c, d, e, g] = normalEquations(rows, points.map((p) => p.f));
	return { a, b, c, d, e, g };
}

/** Vertex of the fitted paraboloid (∇f=0, a 2x2 linear system solved in closed form). A non-positive
 *  `det`, or a≥0, means the surface is a saddle/bowl rather than a peak — reject the scan rather
 *  than report a location; that's the signature of an off-axis crash or a scan that missed the tip. */
export function paraboloidPeak({ a, b, c, d, e }: Paraboloid): { x: number; y: number } {
	const det = 4 * a * b - c * c;
	if (det <= 0 || a >= 0) throw new Error("paraboloidPeak: not a concave maximum — reject scan");
	return { x: (c * e - 2 * b * d) / det, y: (c * d - 2 * a * e) / det };
}

/**
 * Axis-aligned (no xy cross term) bivariate Gaussian, fit via the same log-linearization trick as
 * peak1d.ts's gaussianLogFit. Preferred over the full paraboloid for a circular coil unless the
 * raster shows real skew (scan-direction hysteresis, off-axis background leakage).
 */
export function fitGaussian2D(points: Sample2D[], baseline = 0, minFraction = 0.15) {
	const peak = Math.max(...points.map((p) => p.f)) - baseline;
	const pts = points.filter((p) => p.f - baseline > peak * minFraction);
	const rows = pts.map((p) => [p.x * p.x, p.y * p.y, p.x, p.y, 1]);
	const targets = pts.map((p) => Math.log(p.f - baseline));
	const [a, b, d, e, g0] = normalEquations(rows, targets);
	if (a >= 0 || b >= 0) throw new Error("fitGaussian2D: invalid curvature — reject scan");
	return {
		mux: -d / (2 * a), muy: -e / (2 * b),
		sigmaX: Math.sqrt(-1 / (2 * a)), sigmaY: Math.sqrt(-1 / (2 * b)),
		amplitude: Math.exp(g0 - (d * d) / (4 * a) - (e * e) / (4 * b)),
	};
}
