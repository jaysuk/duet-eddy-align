/**
 * Ties the per-tool scan sequence together: load the tool (unless scanning in place for a "point"
 * reference datum), travel to the saved probe position, run orchestrator.ts's cross scan, return a
 * capture. Kept separate from orchestrator.ts because it's plugin-config-shaped (probe position, feed
 * rates, safe-Z travel) rather than a generic motion/sampling primitive.
 */
import type { EddyAlignConfig } from "./config";
import { type CrossScanResult, type MachineIO, type ProgressSink, type ReadProbe, runCrossScan } from "./orchestrator";

export interface ScanCapture {
	x: number;
	y: number;
	confidence: number;
	/** Detected response polarity for this capture. */
	peakType?: "peak" | "valley";
	/** The fit actually used — differs from cfg.fitMethod exactly when a detected valley
	 *  auto-switched to weightedQuadratic; always report it, never assume it matches cfg. */
	methodUsed?: "gaussianLog" | "weightedQuadratic";
	/** Bidirectional mode only — see orchestrator.ts's CrossScanResult.directionalSpread. */
	directionalSpread?: { x: number; y: number };
	/** Goal-seeking refinement only — see runRefinedScan below. */
	refinement?: RefinementInfo;
}

export interface ScanOutcome {
	ok: boolean;
	capture?: ScanCapture;
	error?: string;
}

/** Evenly spaced offsets from -halfWidth to +halfWidth (inclusive), step apart. */
export function buildScanOffsets(halfWidth: number, step: number): number[] {
	if (!(halfWidth > 0) || !(step > 0)) throw new Error("buildScanOffsets: halfWidth and step must be positive");
	const offsets: number[] = [];
	const steps = Math.round((2 * halfWidth) / step);
	for (let i = 0; i <= steps; i++) offsets.push(Number((-halfWidth + i * step).toFixed(6)));
	return offsets;
}

/**
 * Lift to at least safeZ (if set and the machine is currently below it), travel to the saved probe
 * XY, then descend to the scan height.
 *
 * safeZ is a clearance *floor*, not a fixed waypoint — deliberately only ever moves Z up, never down.
 * An earlier version issued an unconditional absolute `G1 Z<safeZ>`, which is safe only if the
 * machine always happens to be below safeZ when this runs; whenever it wasn't (jogged up manually,
 * or just sitting wherever the previous command left it — e.g. probeZ from the end of a prior scan,
 * if that happens to be above this run's safeZ), that command moved Z *down* toward safeZ instead,
 * exactly backwards from what "safe" means. Reading the current position first and skipping the move
 * entirely when it's already at or above safeZ fixes that without losing the clearance guarantee.
 */
/**
 * `scanZ`, if given, overrides cfg.probeZ for the final descent -- scanTool uses this to resolve a
 * per-tool scan height (config.ts's toolScanZ). Omit it entirely (undefined) to fall back to
 * cfg.probeZ exactly as before; pass it explicitly (including null) to pin the descent to that
 * specific value instead, with null meaning "don't descend" same as an unset probeZ always has.
 */
export async function goToProbePosition(io: MachineIO, cfg: EddyAlignConfig, scanZ?: number | null): Promise<void> {
	if (cfg.probeX == null || cfg.probeY == null) {
		throw new Error("Set the probe position first (Setup panel)");
	}
	const g53 = cfg.useG53 ? "G53 " : "";
	const lines: string[] = [];
	if (cfg.safeZ != null) {
		const currentZ = io.machinePos("Z");
		if (currentZ == null || currentZ < cfg.safeZ) {
			lines.push(`${g53}G1 Z${cfg.safeZ} F${cfg.travelFeed}`);
		}
	}
	lines.push(`${g53}G1 X${cfg.probeX} Y${cfg.probeY} F${cfg.travelFeed}`);
	const z = scanZ !== undefined ? scanZ : cfg.probeZ;
	if (z != null) lines.push(`${g53}G1 Z${z} F${cfg.travelFeed}`);
	lines.push("M400");
	await io.sendCode(lines.join("\n"));
}

/** Absolute XY move at travelFeed, honouring cfg.useG53 — mirrors goToProbePosition's G-code shape.
 *  Z is deliberately untouched: the scan height is already set by the time runRefinedScan calls this
 *  between passes, and must not move. */
export async function moveToXY(io: MachineIO, x: number, y: number, cfg: EddyAlignConfig): Promise<void> {
	const g53 = cfg.useG53 ? "G53 " : "";
	await io.sendCode(`${g53}G1 X${x} Y${y} F${cfg.travelFeed}\nM400`);
}

/** Below roughly this step size, further passes resolve machine repeatability rather than signal — a
 *  physical floor, not a tuning preference, so it isn't a config field. */
export const MIN_REFINE_STEP_MM = 0.01;

export interface RefinementPass {
	/** 1-based. */
	pass: number;
	/** The window this pass actually scanned with. */
	halfWidth: number;
	step: number;
	x: number;
	y: number;
	confidence: number;
	/** Movement of the fitted centre from the centre this pass was scanned around (the initial probe
	 *  position for pass 1) — this is also what's compared against refineTolerance to decide
	 *  convergence, so a small pass-1 delta here is a real, valid "already centred" result, not a
	 *  placeholder. */
	deltaX: number;
	deltaY: number;
}

export interface RefinementInfo {
	passes: RefinementPass[];
	converged: boolean;
	/** Set only when the loop stopped before converging *and* before exhausting refineMaxPasses —
	 *  hitting the pass cap on its own isn't an anomaly and leaves this unset. */
	stoppedReason?: string;
	/** The scanStep the final (or last successful) pass used. */
	finalStep: number;
}

interface RefinedScanResult {
	ok: boolean;
	position?: { x: number; y: number };
	confidence?: number;
	peakType?: "peak" | "valley";
	methodUsed?: "gaussianLog" | "weightedQuadratic";
	directionalSpread?: { x: number; y: number };
	refinement: RefinementInfo;
	error?: string;
}

function fromCrossScan(result: CrossScanResult, refinement: RefinementInfo): RefinedScanResult {
	return {
		ok: true, position: result.position, confidence: result.confidence,
		peakType: result.peakType, methodUsed: result.methodUsed, directionalSpread: result.directionalSpread,
		refinement,
	};
}

/**
 * Iteratively narrows the cross-scan window onto the fitted extremum ("extremum", not "peak" — a
 * detected valley is refined identically, see orchestrator.ts's polarity auto-detection): scan, move
 * to the fitted centre, shrink halfWidth/step together (preserving sample count, see
 * config.ts:refineShrink), repeat until converged, capped at refineMaxPasses, or the step would fall
 * below MIN_REFINE_STEP_MM.
 *
 * Assumes the machine is already at the probe position — scanTool calls goToProbePosition before this
 * — and deliberately leaves it at the final refined centre rather than travelling back: that costs no
 * extra motion and is more informative than returning to the original (now superseded) probe position.
 *
 * A failed pass, once at least one pass has already succeeded, keeps that last good result instead of
 * discarding it — the opposite rule from bidirectional scanning, where both passes are needed for the
 * guarantee the user opted into. Here the coarse result is independently valid on its own and
 * refinement is purely additive, so losing it to a later hiccup would be strictly worse than reporting
 * "refined N of M passes, stopped: …".
 */
export async function runRefinedScan(
	io: MachineIO, readProbe: ReadProbe, cfg: EddyAlignConfig, progress?: ProgressSink, shouldAbort?: () => boolean,
): Promise<RefinedScanResult> {
	if (cfg.probeX == null || cfg.probeY == null) {
		return { ok: false, error: "Set the probe position first (Setup panel)", refinement: { passes: [], converged: false, finalStep: cfg.scanStep } };
	}

	let centreX = cfg.probeX;
	let centreY = cfg.probeY;
	let halfWidth = cfg.scanHalfWidth;
	let step = cfg.scanStep;

	const passes: RefinementPass[] = [];
	let lastGood: CrossScanResult | null = null;

	for (let pass = 1; pass <= cfg.refineMaxPasses; pass++) {
		if (shouldAbort?.()) {
			if (lastGood) return fromCrossScan(lastGood, { passes, converged: false, stoppedReason: "aborted", finalStep: step });
			return { ok: false, error: "aborted", refinement: { passes, converged: false, stoppedReason: "aborted", finalStep: step } };
		}

		progress?.status?.(`Refining (pass ${pass} of ${cfg.refineMaxPasses})…`);
		const offsets = buildScanOffsets(halfWidth, step);
		const result = await runCrossScan(io, readProbe, offsets, {
			jogFeed: cfg.jogFeed, settleMs: cfg.settleMs,
			fitMethod: cfg.fitMethod, weightedQuadraticSigma: cfg.weightedQuadraticSigma,
			bidirectional: cfg.bidirectionalScan, shouldAbort,
		}, progress);

		if (!result.ok || !result.position) {
			const reason = `pass ${pass} failed: ${result.error ?? "scan failed"}`;
			if (lastGood) return fromCrossScan(lastGood, { passes, converged: false, stoppedReason: reason, finalStep: step });
			return { ok: false, error: result.error ?? "scan failed", refinement: { passes, converged: false, stoppedReason: reason, finalStep: step } };
		}

		const deltaX = Math.abs(result.position.x - centreX);
		const deltaY = Math.abs(result.position.y - centreY);
		passes.push({ pass, halfWidth, step, x: result.position.x, y: result.position.y, confidence: result.confidence ?? 0, deltaX, deltaY });
		lastGood = result;
		centreX = result.position.x;
		centreY = result.position.y;

		if (deltaX < cfg.refineTolerance && deltaY < cfg.refineTolerance) {
			return fromCrossScan(result, { passes, converged: true, finalStep: step });
		}
		if (pass === cfg.refineMaxPasses) break; // cap reached -- not an anomaly, no stoppedReason

		const nextStep = step * cfg.refineShrink;
		if (nextStep < MIN_REFINE_STEP_MM) {
			return fromCrossScan(result, { passes, converged: false, stoppedReason: `refine step floor reached (${MIN_REFINE_STEP_MM}mm)`, finalStep: step });
		}

		await moveToXY(io, centreX, centreY, cfg);
		halfWidth *= cfg.refineShrink;
		step = nextStep;
	}

	return fromCrossScan(lastGood as CrossScanResult, { passes, converged: false, finalStep: step });
}

/**
 * Scan one tool: optionally load it (T<n>), travel to the probe, cross-scan (or, with
 * cfg.refineScan on, goal-seek via runRefinedScan), return the captured machine-coordinate center.
 * `toolNumber` is omitted for a "point" reference datum capture, which scans whatever tool is
 * currently loaded in place instead of sending a T-command.
 */
export async function scanTool(
	io: MachineIO, readProbe: ReadProbe, cfg: EddyAlignConfig, toolNumber: number | null,
	progress?: ProgressSink, shouldAbort?: () => boolean,
): Promise<ScanOutcome> {
	try {
		if (toolNumber != null) {
			progress?.status?.(`Loading T${toolNumber}…`);
			await io.sendCode(`T${toolNumber}`);
		}
		progress?.status?.("Travelling to probe…");
		const scanZ = toolNumber != null ? (cfg.toolScanZ[String(toolNumber)] ?? cfg.probeZ) : cfg.probeZ;
		await goToProbePosition(io, cfg, scanZ);

		if (cfg.refineScan) {
			const refined = await runRefinedScan(io, readProbe, cfg, progress, shouldAbort);
			if (!refined.ok || !refined.position) {
				return { ok: false, error: refined.error ?? "scan failed" };
			}
			return {
				ok: true,
				capture: {
					x: refined.position.x, y: refined.position.y, confidence: refined.confidence ?? 0,
					peakType: refined.peakType, methodUsed: refined.methodUsed,
					directionalSpread: refined.directionalSpread, refinement: refined.refinement,
				},
			};
		}

		const offsets = buildScanOffsets(cfg.scanHalfWidth, cfg.scanStep);
		const result = await runCrossScan(io, readProbe, offsets, {
			jogFeed: cfg.jogFeed, settleMs: cfg.settleMs,
			fitMethod: cfg.fitMethod, weightedQuadraticSigma: cfg.weightedQuadraticSigma,
			bidirectional: cfg.bidirectionalScan, shouldAbort,
		}, progress);
		if (!result.ok || !result.position) {
			return { ok: false, error: result.error ?? "scan failed" };
		}
		return {
			ok: true,
			capture: {
				x: result.position.x, y: result.position.y, confidence: result.confidence ?? 0,
				peakType: result.peakType, methodUsed: result.methodUsed,
				directionalSpread: result.directionalSpread,
			},
		};
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
