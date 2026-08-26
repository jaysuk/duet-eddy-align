/**
 * Plugin configuration model + persistence. Stored under DWC's settings store at
 * `plugins.duetEddyAlign.config`, the same pattern duet-tool-align uses for `duetToolAlign.config` —
 * persisted with the rest of DWC's settings (on the board by default) and survives export/import.
 */
import { reactive } from "vue";

import { useSettingsStore } from "@/stores/settings";

import { PLUGIN_ID } from "./constants";
import type { ScanCapture } from "./scanWorkflow";

export interface EddyAlignConfig {
	/** M558 K parameter — which configured probe is the scanning probe. */
	probeIndex: number;

	/** Saved SZP coil position in machine coordinates (where a tool needs to sit to be scanned). */
	probeX: number | null;
	probeY: number | null;
	/** Scan height — Z to descend to before sweeping. */
	probeZ: number | null;
	/** Clearance floor before travelling between tools/the probe — only ever raises Z (never lowers
	 *  it) to at least this height, and does nothing if already at or above it. See
	 *  scanWorkflow.ts's goToProbePosition for why this must not be an unconditional target. */
	safeZ: number | null;
	/** Use G53 (machine coords) for travel moves so a mid-run tool offset can't shift them. */
	useG53: boolean;

	/** Feed rates (mm/min). */
	travelFeed: number;
	jogFeed: number;
	/** Settle dwell after each jog before sampling, in ms (mechanical/coil settling). */
	settleMs: number;

	/** Cross-scan window: samples run from -scanHalfWidth to +scanHalfWidth in scanStep increments. */
	scanHalfWidth: number;
	scanStep: number;

	/**
	 * Which sub-sample peak fit to use — see peak1d.ts. "gaussianLog" (default) assumes the whole
	 * sweep is a clean Gaussian; "weightedQuadratic" only assumes smoothness near the peak, is
	 * immune to a DC-offset signal, and handles a valley-shaped response natively. A detected valley
	 * auto-switches to weightedQuadratic regardless of this setting — no separate toggle needed for
	 * that, since the switch always reports itself (never silent) via the scan result.
	 */
	fitMethod: "gaussianLog" | "weightedQuadratic";
	/** Gaussian weighting bandwidth (mm) for the weightedQuadratic fit. Fixed placeholder default,
	 *  deliberately not derived from scanHalfWidth (that would couple the scan window's size to the
	 *  fit's bias/variance tradeoff) — same "pending real hardware calibration" status as
	 *  quality.ts's sigmaNominal, see docs/open-questions.md. */
	weightedQuadraticSigma: number;
	/** Sweep each axis both forward and reversed, averaging the two fits to cancel
	 *  direction-dependent bias (backlash/settling asymmetry). Off by default — roughly doubles scan
	 *  time per axis. See orchestrator.ts's CrossScanParams.bidirectional for what the resulting
	 *  directionalSpread diagnostic does and doesn't measure. */
	bidirectionalScan: boolean;
	/** Number of runs for the repeatability check. */
	repeatabilityRuns: number;

	/**
	 * Goal-seeking refinement: after the initial cross scan, move to the fitted centre and re-scan
	 * with a narrower window, repeating until the centre stops moving (within refineTolerance) or
	 * refineMaxPasses is reached. See scanWorkflow.ts's runRefinedScan for the loop and its design
	 * rationale. Off by default, consistent with bidirectionalScan — it multiplies scan time.
	 */
	refineScan: boolean;
	/** Hard cap on refinement passes, including the first. The loop always terminates by this count
	 *  even if it never converges. */
	refineMaxPasses: number;
	/** Factor applied to both scanHalfWidth and scanStep between passes -- scaling both together keeps
	 *  the sample count (and therefore the fit's characteristics) unchanged while doubling resolution.
	 *  See runRefinedScan's design note for why only the window, or only the step, would be wrong. */
	refineShrink: number;
	/** Converged when a pass's fitted centre moves less than this (mm) in both X and Y from the centre
	 *  it was scanned around. Placeholder pending real repeatability numbers -- see
	 *  docs/open-questions.md, same status as weightedQuadraticSigma. */
	refineTolerance: number;

	/**
	 * How the 0,0 origin is defined — same two modes as duet-tool-align:
	 *  - "tool":  a reference tool (e.g. T0), scanned the same as any other tool. Other tools are
	 *             measured relative to its captured position, and by default the reference tool
	 *             itself keeps its existing G10 (see zeroReferenceOffset to change that).
	 *  - "point": a fixed carriage datum — e.g. a homing switch that never touches a tool — captured
	 *             once via "Capture datum" as a raw position snapshot, no scan involved. EVERY tool,
	 *             including whichever one would otherwise be the reference, is offset from it.
	 */
	referenceMode: "tool" | "point";
	referenceTool: number;
	/**
	 * "tool" mode only: treat the reference tool's offset as zero instead of inheriting its current
	 * G10. Off (the default) matches duet-tool-align's convention — the reference tool keeps whatever
	 * mapping it already established. On is for a from-scratch calibration where that existing G10
	 * shouldn't be trusted: the reference tool still gets scanned like any other, and its own
	 * freshly-captured position becomes the new baseline instead of a value nobody has verified.
	 */
	zeroReferenceOffset: boolean;
	/** Negate computed offsets (machine/firmware sign convention escape hatch). */
	invertOffsets: boolean;

	/**
	 * "point" mode's fixed carriage datum, persisted rather than session-only: with the coil rigidly
	 * bed-mounted and the datum switch fixed to the carriage, this position is stable long-term, so
	 * re-capturing it every session is pure friction. Just {x, y} -- unlike a tool's capture, there's
	 * no confidence/fit involved (it's a raw position readout, not a coil measurement), so it isn't
	 * shaped like a ScanCapture. capturedAt is an ISO timestamp, shown in the UI so a datum that's
	 * silently gone stale (switch bumped, homing changed) is at least visible, not invented.
	 */
	datumPoint: { x: number; y: number; capturedAt: string } | null;

	/**
	 * Per-tool scan height overrides, keyed by tool number as a string (matching duet-tool-align's
	 * detectProfiles convention for per-tool overrides) -- different tools can legitimately need
	 * different Z standoffs (nozzle length, tool geometry). Falls back to probeZ when a tool has no
	 * entry. Deliberately a stored value the "Set scan Z for this tool" button writes, not "whatever Z
	 * currently is" at scan time -- see scanWorkflow.ts's goToProbePosition, which always descends to
	 * a resolved height rather than trusting wherever a stray jog left Z.
	 */
	toolScanZ: Record<string, number>;

	/**
	 * Per-tool scan results, persisted the same way as datumPoint -- session-only storage meant a
	 * disconnect/reconnect (or any accidental reload) during a session lost every capture so far,
	 * with no way back except re-scanning everything. Keyed by tool number, same convention as
	 * toolScanZ. Survives reload, reconnect, and (since this is stored on the board, not in the
	 * browser) even closing the tab entirely.
	 */
	captures: Record<number, ScanCapture>;

	/** Manual jog steps for the Setup panel. */
	xyStep: number;
	zStep: number;

	/** Live-reading poll interval, in ms. */
	livePollMs: number;

	/** Optional macros run at the start/finish of a full scan run, and to persist offsets. Needs the
	 *  P10 parameter — plain M500 does NOT save G10 tool offsets in RRF. */
	startCommand: string;
	finishCommand: string;
	saveCommand: string;
}

export function defaultConfig(): EddyAlignConfig {
	return {
		probeIndex: 0,
		probeX: null,
		probeY: null,
		probeZ: null,
		safeZ: null,
		useG53: true,
		travelFeed: 6000,
		jogFeed: 1200,
		settleMs: 300,
		scanHalfWidth: 3,
		scanStep: 0.5,
		fitMethod: "gaussianLog",
		weightedQuadraticSigma: 1.0,
		bidirectionalScan: false,
		repeatabilityRuns: 3,
		refineScan: false,
		refineMaxPasses: 3,
		refineShrink: 0.5,
		refineTolerance: 0.01,
		referenceMode: "tool",
		referenceTool: 0,
		zeroReferenceOffset: true,
		invertOffsets: false,
		datumPoint: null,
		toolScanZ: {},
		captures: {},
		xyStep: 0.5,
		zStep: 0.1,
		livePollMs: 300,
		startCommand: "",
		finishCommand: "",
		saveCommand: "M500 P10",
	};
}

/**
 * The live, reactive, persisted config object. Reads/writes go straight through DWC's settings store
 * so any edit is saved automatically. Missing keys are backfilled from defaults so a config written
 * by an older plugin version keeps working.
 */
export function useConfig(): EddyAlignConfig {
	const settings = useSettingsStore();
	const plugins = settings.plugins as Record<string, Record<string, unknown>>;
	if (!plugins[PLUGIN_ID]) plugins[PLUGIN_ID] = {};
	const container = plugins[PLUGIN_ID];
	if (!container.config) {
		container.config = reactive(defaultConfig());
	} else {
		const defaults = defaultConfig();
		const cfg = container.config as Record<string, unknown>;
		for (const [k, v] of Object.entries(defaults)) {
			if (!(k in cfg)) cfg[k] = v;
		}
	}
	return container.config as EddyAlignConfig;
}
