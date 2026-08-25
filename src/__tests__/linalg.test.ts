import { describe, expect, it } from "vitest";

import { invert3x3, solveLinear } from "../model/eddyScan/linalg";

describe("solveLinear", () => {
	it("solves a diagonal system exactly", () => {
		expect(solveLinear([[2, 0], [0, 3]], [4, 9])).toEqual([2, 3]);
	});

	it("solves a general 3x3 system (pivoting required)", () => {
		// 0x + 2y + z = 5 ; x + y + z = 6 ; 2x + y + 0z = 5  ->  x=2, y=1, z=3
		const A = [[0, 2, 1], [1, 1, 1], [2, 1, 0]];
		const [x, y, z] = solveLinear(A, [5, 6, 5]);
		expect(x).toBeCloseTo(2);
		expect(y).toBeCloseTo(1);
		expect(z).toBeCloseTo(3);
	});
});

describe("invert3x3", () => {
	it("produces a true inverse (A * A⁻¹ = I)", () => {
		const A = [[2, 1, 0], [1, 3, 1], [0, 1, 4]];
		const inv = invert3x3(A);
		for (let i = 0; i < 3; i++) {
			for (let j = 0; j < 3; j++) {
				let sum = 0;
				for (let k = 0; k < 3; k++) sum += A[i][k] * inv[k][j];
				expect(sum).toBeCloseTo(i === j ? 1 : 0);
			}
		}
	});

	it("rejects a singular matrix", () => {
		expect(() => invert3x3([[1, 2, 3], [2, 4, 6], [1, 1, 1]])).toThrow();
	});
});
