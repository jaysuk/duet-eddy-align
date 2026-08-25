/**
 * Ties the per-tool scan sequence together: load the tool (unless scanning in place for a "point"
 * reference datum), travel to the saved probe position, run orchestrator.ts's cross scan, return a
 * capture. Kept separate from orchestrator.ts because it's plugin-config-shaped (probe position, feed
 * rates, safe-Z travel) rather than a generic motion/sampling primitive.
 */
import type { EddyAlignConfig } from "./config";
import { type MachineIO, type ProgressSink, type ReadProbe, runCrossScan } from "./orchestrator";

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
export async function goToProbePosition(io: MachineIO, cfg: EddyAlignConfig): Promise<void> {
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
	if (cfg.probeZ != null) lines.push(`${g53}G1 Z${cfg.probeZ} F${cfg.travelFeed}`);
	lines.push("M400");
	await io.sendCode(lines.join("\n"));
}

/**
 * Scan one tool: optionally load it (T<n>), travel to the probe, cross-scan, return the captured
 * machine-coordinate center. `toolNumber` is omitted for a "point" reference datum capture, which
 * scans whatever tool is currently loaded in place instead of sending a T-command.
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
		await goToProbePosition(io, cfg);

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
