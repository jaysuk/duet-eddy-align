/**
 * Motion + sampling orchestration for a per-tool eddy-current scan.
 *
 * Decoupled from Vue/DWC behind two injected seams, same shape as duet-tool-align's orchestrator:
 *   - MachineIO: send G-code + read machine axis positions.
 *   - ReadProbe: return one settled Scanning Z Probe reading (or null if it didn't settle in time).
 *
 * ReadProbe is the seam docs/open-questions.md flagged as needing verification against real RRF
 * source before implementing — see makeProbeReader() below for the resolved, source-verified
 * implementation (sensors.probes[n].value[0] via M409, confirmed against Endstops/ZProbe.cpp,
 * Endstops/EndstopsManager.cpp and Platform/RepRap.cpp). The sweep strategy stays **triggered
 * step-and-sample** (jog to each point, M400, read once) rather than polling during continuous
 * motion — that was a platform/UX choice, not something the object-model answer forces.
 */
import { estimateDcBaseline } from "./eddyScan/baseline";
import { type FitMethod, type ResolvedPeak, resolvePeakFit } from "./eddyScan/peak1d";
import { detectPeakType, estimateSnr, fitConfidence, isIncompleteSweep } from "./eddyScan/quality";

export interface MachineIO {
	/** `quiet`, when true, asks the implementation not to surface this particular call as a
	 *  notification/log entry — for the high-frequency, low-meaning traffic a scan generates (see
	 *  makeProbeReader below), not for anything a user would want a record of. Purely advisory: a
	 *  MachineIO that doesn't distinguish is free to ignore it. */
	sendCode(code: string, quiet?: boolean): Promise<unknown>;
	machinePos(letter: "X" | "Y" | "Z"): number | null;
}

/** One settled probe reading, or null if it didn't settle within the caller's own retry/timeout. */
export type ReadProbe = () => Promise<number | null>;

export interface ScanPoint { x: number; f: number; }

export interface SweepParams {
	jogFeed: number;
	settleMs: number;
	/** Returns true to abort in-progress loops promptly (wired to a Stop button). */
	shouldAbort?: () => boolean;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Relative single-axis jog wrapped to preserve absolute mode and finished with M400 so motion
 *  completes before the next read — same motion contract as duet-tool-align's jogCode. Accepts Z too
 *  (unlike sweepLine, which is XY-only) since the Setup panel's manual jog buttons reuse this for
 *  Z-focus jogs. */
export function jogAxisCode(axis: "X" | "Y" | "Z", d: number, feed: number): string {
	return `M120\nG91\nG1 ${axis}${d.toFixed(4)} F${feed}\nG90\nM121\nM400`;
}

/**
 * Sweeps one axis through a list of offsets (mm, relative to the position at call time), sampling
 * one settled probe reading per point. Always returns to the starting position, even on abort. Points
 * where readProbe() resolves null (didn't settle) are dropped rather than recorded as zero.
 */
export async function sweepLine(
	io: MachineIO, readProbe: ReadProbe, axis: "X" | "Y", offsets: number[], params: SweepParams,
): Promise<ScanPoint[]> {
	const start = io.machinePos(axis);
	if (start == null) throw new Error(`sweepLine: ${axis} position unavailable — home first`);

	const points: ScanPoint[] = [];
	let current = 0;
	for (const offset of offsets) {
		if (params.shouldAbort?.()) break;
		const dx = offset - current;
		if (dx !== 0) {
			await io.sendCode(jogAxisCode(axis, dx, params.jogFeed));
			current = offset;
		}
		if (params.settleMs > 0) await sleep(params.settleMs);
		const value = await readProbe();
		if (value != null) points.push({ x: start + offset, f: value });
	}

	if (current !== 0) await io.sendCode(jogAxisCode(axis, -current, params.jogFeed));
	return points;
}

/**
 * Concrete ReadProbe implementation, verified against RepRapFirmware source rather than assumed:
 *
 *   - `sensors.probes[<K>].value[0]` is a live object-model field (Endstops/EndstopsManager.cpp:
 *     `{ "probes", OBJECT_MODEL_FUNC_ARRAY(4), ObjectModelEntryFlags::live }`, mounted at the
 *     top-level `sensors` key in Platform/RepRap.cpp: `{ "sensors",
 *     OBJECT_MODEL_FUNC(&self->platform->GetEndstops()), ObjectModelEntryFlags::live }`), where `<K>`
 *     is the probe number the scanning probe was configured with (`M558 K<n> P11 ...`, default 0).
 *   - For a scanning probe (`type == ZProbeType::scanningAnalog`, i.e. `M558 P11`), that field is
 *     `ZProbe::GetRawReading()` with **no filtering** — Endstops/ZProbe.cpp's `GetReading()` switch
 *     comments it explicitly: "scanning analog probes are unfiltered for speed". That's exactly the
 *     raw signal peak1d.ts/peak2d.ts expect, not an RRF-smoothed value.
 *   - `M409 K"<path>"` returns `{"key":...,"flags":...,"result":<value>}\n` synchronously
 *     (GCodes/GCodes2.cpp's `case 409`, backed by `RepRap::GetModelResponse` in Platform/RepRap.cpp)
 *     — a fresh on-demand read at the moment it's sent, not whatever DWC's ambient object-model poll
 *     last cached. Sending it right after the sweep's M400 is exactly the "one settled reading"
 *     ReadProbe needs.
 *
 * `settleMs` in SweepParams is therefore purely about mechanical/coil settling after the jog, not
 * about waiting out a polling interval — M409 always returns the value as of when it's asked.
 *
 * `INVALID_READING_SENTINEL`: the wiki's Scanning Z Probe Calibration guide documents 999999 as the
 * firmware's out-of-range/no-lock reading (drive current miscalibrated, or the sensor too far from
 * any metal) — "the aim is to get sensible readings (i.e. not 999999)". Treated as null here so it
 * doesn't get fitted as if it were a real sample.
 */
const INVALID_READING_SENTINEL = 999999;

export function makeProbeReader(io: MachineIO, probeIndex = 0): ReadProbe {
	return async () => {
		// quiet: true -- this fires once per sample point (dozens of times per scan, more with
		// bidirectional/refinement), and its JSON reply is never empty, so unlike a jog it would
		// otherwise pop a notification and a Console log line on every single sample.
		const reply = await io.sendCode(`M409 K"sensors.probes[${probeIndex}].value[0]"`, true);
		try {
			const parsed = JSON.parse(String(reply)) as { result?: unknown };
			const value = parsed.result;
			return typeof value === "number" && Math.abs(value) !== INVALID_READING_SENTINEL ? value : null;
		} catch {
			return null;
		}
	};
}

/** runCrossScan's own params, extending SweepParams with fit-selection knobs sweepLine itself has no
 *  business knowing about — a new type rather than a mutation of SweepParams, so every field here
 *  stays optional and every existing SweepParams call site keeps compiling unchanged. */
export interface CrossScanParams extends SweepParams {
	/** Requested fit method — may be overridden per axis by resolvePeakFit's auto-switch on a
	 *  detected valley; see CrossScanResult.methodUsed for what was actually used. Default
	 *  "gaussianLog". */
	fitMethod?: FitMethod;
	/** Gaussian weighting bandwidth (mm) for the weightedQuadratic fit, whether requested directly
	 *  or reached via auto-switch. */
	weightedQuadraticSigma?: number;
	/**
	 * Sweep each axis both forward (`offsets` as given) and reversed, fit independently, and average
	 * the two positions — cancels direction-dependent bias (backlash/settling asymmetry) from the
	 * per-step travel direction flipping between passes. Opt-in (default false): roughly doubles
	 * scan time per axis, and the reverse pass runs after the forward one, so what
	 * `directionalSpread` reports is genuinely **direction/time disagreement**, not backlash alone —
	 * SZP temperature sensitivity is explicitly unresolved (docs/open-questions.md), and averaging
	 * removes direction-dependent bias while doing nothing about drift accumulated in the meantime.
	 * `settleMs` remains the only lever for undersettled samples, applied identically in both
	 * directions and unchanged by this option.
	 */
	bidirectional?: boolean;
}

export interface CrossScanResult {
	ok: boolean;
	position?: { x: number; y: number };
	confidence?: number;
	/** Detected response polarity, shared by both axes (see the X/Y agreement check below). */
	peakType?: "peak" | "valley";
	/** The fit actually used. Differs from the requested fitMethod exactly when resolvePeakFit
	 *  auto-switched on a detected valley — always report this, never assume it matches the request. */
	methodUsed?: FitMethod;
	/** Bidirectional mode only: |forward - reverse| position per axis. A real diagnostic (large
	 *  spread means direction/time-dependent bias is actually present on this machine) but not a
	 *  pure backlash measurement — see CrossScanParams.bidirectional's doc comment. */
	directionalSpread?: { x: number; y: number };
	error?: string;
}

export interface ProgressSink { status?: (message: string) => void; }

interface AxisScanResult {
	ok: true;
	peakType: "peak" | "valley";
	fit: ResolvedPeak;
	/** quality.ts's fitConfidence(fit.rSquared, SNR) for this one axis/direction pass — combined
	 *  (worst-of) across axes/directions in runCrossScan, same way rSquared alone used to be. */
	confidence: number;
}
interface AxisScanFailure { ok: false; error: string; }

/**
 * Sweep one axis (in whatever offset order it's given — the caller controls forward vs. reverse) and
 * fit it, sharing the completeness/curvature/DC-baseline logic between runCrossScan's plain and
 * bidirectional paths. `label` is what appears in error messages ("X" vs. "X reverse") — the actual
 * motion axis is always just "X" or "Y", sweepLine doesn't know or care about direction.
 */
async function sweepAndFit(
	io: MachineIO, readProbe: ReadProbe, axis: "X" | "Y", offsets: number[], params: CrossScanParams, label: string,
): Promise<AxisScanResult | AxisScanFailure> {
	const samples = await sweepLine(io, readProbe, axis, offsets, params);
	if (params.shouldAbort?.()) return { ok: false, error: "aborted" };

	const fs = samples.map((p) => p.f);
	const peakType = detectPeakType(fs);
	if (isIncompleteSweep(fs, peakType)) {
		return { ok: false, error: `${label} sweep incomplete — peak sat at the edge of the scan window` };
	}

	const fitMethod = params.fitMethod ?? "gaussianLog";
	const fit = resolvePeakFit(samples.map((p) => p.x), fs, fitMethod, {
		peakType, sigma: params.weightedQuadraticSigma, baseline: estimateDcBaseline(fs),
	});
	const confidence = fitConfidence(fit.rSquared, estimateSnr(fs, peakType));
	return { ok: true, peakType, fit, confidence };
}

/**
 * Cross scan: sweep X then Y through the current position, sub-sample fit each independently, and
 * combine into an (x, y) center estimate. Cheaper than a full 2D raster (see peak2d.ts) — reserve
 * that for a refinement pass once this is working on real hardware.
 *
 * Each axis's response polarity is detected per scan (quality.ts's detectPeakType) rather than
 * assumed — whether sensors.probes[n].value[0] rises or falls with nozzle proximity is unverified on
 * real hardware. peak1d.ts's resolvePeakFit() picks the fit and auto-switches gaussianLog ->
 * weightedQuadratic on a detected valley (gaussianLog can't fit one — it needs a positive signal
 * with a maximum). X and Y must agree on polarity: they measure the same physical coupling through
 * the same coil seconds apart, so disagreement means something's wrong (most likely one sweep missed
 * the coil), not two independently-valid measurements to average past. With `bidirectional` on, the
 * same agreement requirement applies to each axis's forward vs. reverse pass, for the same reason.
 *
 * Only a DC-offset baseline (baseline.ts's estimateDcBaseline) is applied here — subtracting the
 * mean of the outer samples so gaussianLogFit's near-peak minFraction filter actually engages on a
 * raw reading that carries a large constant offset (weightedQuadraticPeak needs no such help — it
 * absorbs any DC straight into its own constant term). The background-*shape* correction
 * (polyBaselineIRLS/highpassDoG) is still deferred — real background shape is unverified against
 * hardware, so wiring that in now would be guessing at parameters. Add it once a real sweep's
 * background is characterised.
 *
 * Reported `confidence` is quality.ts's fitConfidence (R² blended with SNR estimated from the raw
 * samples), not plain R² — the worst axis/direction's fitConfidence, same "most conservative wins"
 * rule R² alone used to follow. See fitConfidence's own doc comment for why it isn't
 * confidenceScore() with placeholder inputs.
 */
export async function runCrossScan(
	io: MachineIO, readProbe: ReadProbe, offsets: number[], params: CrossScanParams, progress?: ProgressSink,
): Promise<CrossScanResult> {
	try {
		progress?.status?.("Sweeping X…");
		const xFwd = await sweepAndFit(io, readProbe, "X", offsets, params, "X");
		if (!xFwd.ok) return { ok: false, error: xFwd.error };

		let xRev: AxisScanResult | null = null;
		if (params.bidirectional) {
			progress?.status?.("Sweeping X (reverse)…");
			const rev = await sweepAndFit(io, readProbe, "X", offsets.slice().reverse(), params, "X reverse");
			if (!rev.ok) return { ok: false, error: rev.error };
			if (rev.peakType !== xFwd.peakType) {
				return {
					ok: false,
					error: "X forward and reverse sweeps disagree on response polarity — the response may be too marginal to trust",
				};
			}
			xRev = rev;
		}

		progress?.status?.("Sweeping Y…");
		const yFwd = await sweepAndFit(io, readProbe, "Y", offsets, params, "Y");
		if (!yFwd.ok) return { ok: false, error: yFwd.error };

		let yRev: AxisScanResult | null = null;
		if (params.bidirectional) {
			progress?.status?.("Sweeping Y (reverse)…");
			const rev = await sweepAndFit(io, readProbe, "Y", offsets.slice().reverse(), params, "Y reverse");
			if (!rev.ok) return { ok: false, error: rev.error };
			if (rev.peakType !== yFwd.peakType) {
				return {
					ok: false,
					error: "Y forward and reverse sweeps disagree on response polarity — the response may be too marginal to trust",
				};
			}
			yRev = rev;
		}

		if (xFwd.peakType !== yFwd.peakType) {
			return {
				ok: false,
				error: "X and Y disagree on response polarity — the scan may not be centred on the coil",
			};
		}

		if (xRev && yRev) {
			return {
				ok: true,
				position: { x: (xFwd.fit.x + xRev.fit.x) / 2, y: (yFwd.fit.x + yRev.fit.x) / 2 },
				confidence: Math.min(xFwd.confidence, xRev.confidence, yFwd.confidence, yRev.confidence),
				peakType: xFwd.peakType,
				methodUsed: xFwd.fit.methodUsed,
				directionalSpread: {
					x: Math.abs(xFwd.fit.x - xRev.fit.x),
					y: Math.abs(yFwd.fit.x - yRev.fit.x),
				},
			};
		}

		return {
			ok: true,
			position: { x: xFwd.fit.x, y: yFwd.fit.x },
			confidence: Math.min(xFwd.confidence, yFwd.confidence),
			peakType: xFwd.peakType,
			methodUsed: xFwd.fit.methodUsed,
		};
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
