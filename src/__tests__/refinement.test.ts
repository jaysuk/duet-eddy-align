import { describe, expect, it } from "vitest";

import { defaultConfig, type EddyAlignConfig } from "../model/config";
import type { MachineIO, ReadProbe } from "../model/orchestrator";
import { MIN_REFINE_STEP_MM, runRefinedScan } from "../model/scanWorkflow";

/**
 * Unlike the flat queueReader used elsewhere, refinement genuinely needs a fake IO that tracks the
 * machine's XY position as G-code streams through it, and a ReadProbe that computes its response from
 * that live position -- otherwise there's no way to express "pass 2 sampled a narrower range, centred
 * on wherever pass 1's fit landed". Parses the same two G-code shapes scanWorkflow.ts emits: sweepLine's
 * relative jogs (wrapped `G91 ... G1 X<d> ... G90`) and moveToXY's absolute `G1 X<x> Y<y>`.
 */
function trackingIO(start: { x: number; y: number }) {
	let x = start.x, y = start.y;
	const codes: string[] = [];
	const io: MachineIO = {
		sendCode: async (code) => {
			codes.push(code);
			let relative = false;
			for (const line of code.split("\n")) {
				if (line === "G91") relative = true;
				else if (line === "G90") relative = false;
				const m = line.match(/^(?:G53\s+)?G1\s+(.+)$/);
				if (!m) continue;
				const xm = m[1].match(/X(-?[\d.]+)/);
				const ym = m[1].match(/Y(-?[\d.]+)/);
				if (xm) x = relative ? x + Number(xm[1]) : Number(xm[1]);
				if (ym) y = relative ? y + Number(ym[1]) : Number(ym[1]);
			}
			return "";
		},
		machinePos: (letter) => (letter === "X" ? x : letter === "Y" ? y : null),
	};
	return { io, codes, pos: () => ({ x, y }) };
}

/** A 2D Gaussian (or, negated, a valley) response centred at `target`, sampled at wherever `io`'s
 *  tracked position currently is -- so a better-centred pass genuinely reads a stronger signal, as on
 *  real hardware, rather than replaying a pre-baked sequence. */
function syntheticReader(
	io: MachineIO, target: { x: number; y: number },
	opts: { sigma?: number; amplitude?: number; valley?: boolean } = {},
): ReadProbe {
	const sigma = opts.sigma ?? 1;
	const amplitude = opts.amplitude ?? 10;
	const baseline = opts.valley ? 100 : 0;
	const sign = opts.valley ? -1 : 1;
	return async () => {
		const x = io.machinePos("X") ?? 0;
		const y = io.machinePos("Y") ?? 0;
		const dx = x - target.x, dy = y - target.y;
		return baseline + sign * amplitude * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
	};
}

function baseCfg(overrides: Partial<EddyAlignConfig> = {}): EddyAlignConfig {
	return {
		...defaultConfig(),
		probeX: 100, probeY: 50, probeZ: null, safeZ: null,
		scanHalfWidth: 2, scanStep: 0.5, settleMs: 0,
		fitMethod: "weightedQuadratic", weightedQuadraticSigma: 1,
		refineScan: true, refineMaxPasses: 4, refineShrink: 0.5, refineTolerance: 0.01,
		...overrides,
	};
}

describe("runRefinedScan", () => {
	it("converges on a known centre, ending up closer than a single coarse pass would", async () => {
		const target = { x: 100.37, y: 49.82 };
		const { io } = trackingIO({ x: 100, y: 50 });
		const readProbe = syntheticReader(io, target);
		const cfg = baseCfg();

		const result = await runRefinedScan(io, readProbe, cfg);

		expect(result.ok).toBe(true);
		expect(result.refinement.converged).toBe(true);
		expect(result.refinement.passes.length).toBeGreaterThan(1);

		const firstPass = result.refinement.passes[0];
		const firstPassError = Math.hypot(firstPass.x - target.x, firstPass.y - target.y);
		const finalError = Math.hypot((result.position?.x ?? NaN) - target.x, (result.position?.y ?? NaN) - target.y);
		expect(finalError).toBeLessThan(firstPassError);
	});

	it("re-centres and narrows on pass 2: moves to pass 1's result, then samples a halfWidth x refineShrink window around it", async () => {
		const target = { x: 100.6, y: 49.6 };
		const { io, codes } = trackingIO({ x: 100, y: 50 });
		const readProbe = syntheticReader(io, target);
		const cfg = baseCfg({ refineMaxPasses: 2, refineTolerance: 1e-9 }); // force exactly 2 passes

		const result = await runRefinedScan(io, readProbe, cfg);

		expect(result.refinement.passes.length).toBe(2);
		const [pass1, pass2] = result.refinement.passes;
		expect(pass2.halfWidth).toBeCloseTo(pass1.halfWidth * cfg.refineShrink, 6);
		expect(pass2.step).toBeCloseTo(pass1.step * cfg.refineShrink, 6);

		// A move to pass 1's fitted centre must appear between the two scans' G-code.
		const moveCode = codes.find((c) => c.includes(`X${pass1.x}`) && c.includes(`Y${pass1.y}`));
		expect(moveCode).toBeTruthy();
	});

	it("preserves sample count across passes (halfWidth and step shrink by the same factor)", async () => {
		const target = { x: 100.2, y: 50.1 };
		const { io } = trackingIO({ x: 100, y: 50 });
		const readProbe = syntheticReader(io, target);
		const cfg = baseCfg({ refineMaxPasses: 3, refineTolerance: 1e-9 });

		const result = await runRefinedScan(io, readProbe, cfg);

		const counts = result.refinement.passes.map((p) => Math.round((2 * p.halfWidth) / p.step) + 1);
		expect(new Set(counts).size).toBe(1); // every pass sampled the same number of points
	});

	it("stops at refineMaxPasses when the tolerance is never met", async () => {
		const target = { x: 100.6, y: 49.4 };
		const { io } = trackingIO({ x: 100, y: 50 });
		const readProbe = syntheticReader(io, target);
		const cfg = baseCfg({ refineMaxPasses: 3, refineTolerance: 1e-12 }); // unreachable

		const result = await runRefinedScan(io, readProbe, cfg);

		expect(result.ok).toBe(true);
		expect(result.refinement.converged).toBe(false);
		expect(result.refinement.passes.length).toBe(3);
		expect(result.refinement.stoppedReason).toBeUndefined(); // hitting the cap isn't an anomaly
	});

	it("stops on the refine-step floor before it would go below MIN_REFINE_STEP_MM", async () => {
		const target = { x: 100.6, y: 49.4 };
		const { io } = trackingIO({ x: 100, y: 50 });
		const readProbe = syntheticReader(io, target);
		// step 0.5 shrinking by 0.1 crosses MIN_REFINE_STEP_MM (0.01) after 2 shrinks (0.05 -> 0.005).
		const cfg = baseCfg({ refineMaxPasses: 10, refineShrink: 0.1, refineTolerance: 1e-12 });

		const result = await runRefinedScan(io, readProbe, cfg);

		expect(result.ok).toBe(true);
		expect(result.refinement.converged).toBe(false);
		expect(result.refinement.stoppedReason).toMatch(/step floor/i);
		expect(result.refinement.finalStep).toBeGreaterThanOrEqual(MIN_REFINE_STEP_MM);
	});

	it("keeps the last good result when a later pass fails, and names the failure", async () => {
		const target = { x: 100.3, y: 49.7 };
		const { io } = trackingIO({ x: 100, y: 50 });
		// Pass 1 (halfWidth 2, step 0.5) reads 9 samples per axis x 2 axes = 18 reads and must
		// complete cleanly; every read from pass 2 onward returns null (never settles), which
		// sweepLine drops -- an empty sweep fails inside sweepAndFit.
		const real = syntheticReader(io, target);
		let call = 0;
		const readProbe: ReadProbe = async () => {
			call++;
			return call <= 18 ? real() : null;
		};
		const cfg = baseCfg({ refineMaxPasses: 3, refineTolerance: 1e-12 });

		const result = await runRefinedScan(io, readProbe, cfg);

		expect(result.ok).toBe(true);
		expect(result.refinement.passes.length).toBe(1);
		expect(result.position?.x).toBeCloseTo(result.refinement.passes[0].x, 9);
		expect(result.position?.y).toBeCloseTo(result.refinement.passes[0].y, 9);
		expect(result.refinement.stoppedReason).toMatch(/pass 2 failed/);
	});

	it("refines a valley-polarity response identically -- the loop is extremum-agnostic", async () => {
		const target = { x: 100.4, y: 49.75 };
		const { io } = trackingIO({ x: 100, y: 50 });
		const readProbe = syntheticReader(io, target, { valley: true });
		const cfg = baseCfg();

		const result = await runRefinedScan(io, readProbe, cfg);

		expect(result.ok).toBe(true);
		expect(result.peakType).toBe("valley");
		expect(result.refinement.converged).toBe(true);
		expect(Math.hypot((result.position?.x ?? NaN) - target.x, (result.position?.y ?? NaN) - target.y))
			.toBeLessThan(0.05);
	});

	it("stops and keeps the last good result when shouldAbort trips between passes", async () => {
		const target = { x: 100.5, y: 49.5 };
		const { io } = trackingIO({ x: 100, y: 50 });
		const real = syntheticReader(io, target);
		// Pass 1 needs exactly 18 reads (9 samples/axis x 2 axes at halfWidth 2, step 0.5); trip the
		// abort flag right after that, so pass 1 completes cleanly and pass 2 never gets under way.
		let reads = 0;
		const readProbe: ReadProbe = async () => { reads++; return real(); };
		const cfg = baseCfg({ refineMaxPasses: 5, refineTolerance: 1e-12 });

		const result = await runRefinedScan(io, readProbe, cfg, undefined, () => reads > 18);

		expect(result.ok).toBe(true);
		expect(result.refinement.passes.length).toBe(1);
		expect(result.refinement.stoppedReason).toMatch(/aborted/i);
		expect(result.position?.x).toBeCloseTo(result.refinement.passes[0].x, 9);
	});
});
