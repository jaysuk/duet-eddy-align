/**
 * Small, dependency-free linear algebra: Gauss-Jordan elimination with partial pivoting for the
 * normal-equation solves in peak1d.ts/peak2d.ts/baseline.ts, plus a closed-form 3x3 inverse for the
 * peak-location covariance in peak1d.ts. Nothing here needs to scale past a 6x6 system (the 2D
 * paraboloid fit), so a full sparse/iterative solver would be overkill.
 */

export type Mat = number[][]; // row-major

export function solveLinear(A: Mat, b: number[]): number[] {
	const n = A.length;
	const M = A.map((row, i) => [...row, b[i]]);

	for (let col = 0; col < n; col++) {
		let pivot = col;
		for (let r = col + 1; r < n; r++) {
			if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
		}
		if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];

		const pv = M[col][col];
		if (Math.abs(pv) < 1e-12) throw new Error("solveLinear: singular matrix");

		for (let r = 0; r < n; r++) {
			if (r === col) continue;
			const factor = M[r][col] / pv;
			for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
		}
	}

	return M.map((row, i) => row[n] / row[i]);
}

/** Closed-form cofactor/adjugate inverse — avoids three solveLinear() calls for the common 3x3 case. */
export function invert3x3(A: Mat): Mat {
	const [[a, b, c], [d, e, f], [g, h, i]] = A;
	const A_ = e * i - f * h, B_ = -(d * i - f * g), C_ = d * h - e * g;
	const D_ = -(b * i - c * h), E_ = a * i - c * g, F_ = -(a * h - b * g);
	const G_ = b * f - c * e, H_ = -(a * f - c * d), I_ = a * e - b * d;
	const det = a * A_ + b * B_ + c * C_;
	if (Math.abs(det) < 1e-12) throw new Error("invert3x3: singular matrix");
	const inv = 1 / det;
	return [
		[A_ * inv, D_ * inv, G_ * inv],
		[B_ * inv, E_ * inv, H_ * inv],
		[C_ * inv, F_ * inv, I_ * inv],
	];
}
