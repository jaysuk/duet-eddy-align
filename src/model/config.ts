/**
 * Plugin configuration model + persistence. Stored under DWC's settings store at
 * `plugins.duetEddyAlign.config`, the same pattern duet-tool-align uses for `duetToolAlign.config` —
 * persisted with the rest of DWC's settings (on the board by default) and survives export/import.
 */
import { reactive } from "vue";

import { useSettingsStore } from "@/stores/settings";

import { PLUGIN_ID } from "./constants";

export interface EddyAlignConfig {
	/** M558 K parameter — which configured probe is the scanning probe. */
	probeIndex: number;

	/** Saved SZP coil position in machine coordinates (where a tool needs to sit to be scanned). */
	probeX: number | null;
	probeY: number | null;
	/** Scan height — Z to descend to before sweeping. */
	probeZ: number | null;
	/** Safe Z to lift to before travelling between tools/the probe. */
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
		referenceMode: "tool",
		referenceTool: 0,
		zeroReferenceOffset: true,
		invertOffsets: false,
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
