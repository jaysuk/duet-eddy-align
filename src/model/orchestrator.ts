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
import { gaussianLogFit } from "./eddyScan/peak1d";
import { isIncompleteSweep } from "./eddyScan/quality";

export interface MachineIO {
	sendCode(code: string): Promise<unknown>;
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
 *  completes before the next read — same motion contract as duet-tool-align's jogCode. */
export function jogAxisCode(axis: "X" | "Y", d: number, feed: number): string {
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
		const reply = await io.sendCode(`M409 K"sensors.probes[${probeIndex}].value[0]"`);
		try {
			const parsed = JSON.parse(String(reply)) as { result?: unknown };
			const value = parsed.result;
			return typeof value === "number" && Math.abs(value) !== INVALID_READING_SENTINEL ? value : null;
		} catch {
			return null;
		}
	};
}

export interface CrossScanResult {
	ok: boolean;
	position?: { x: number; y: number };
	confidence?: number;
	error?: string;
}

export interface ProgressSink { status?: (message: string) => void; }

/**
 * Cross scan: sweep X then Y through the current position, sub-sample fit each independently
 * (peak1d.ts's gaussianLogFit — the inductive coil's response is expected to be Gaussian-ish, and
 * unlike a raw parabolic fit it's exact for a true Gaussian regardless of how the sample window sits
 * relative to the peak), and combine into an (x, y) center estimate. Cheaper than a full 2D raster
 * (see peak2d.ts) — reserve that for a refinement pass once this is working on real hardware.
 *
 * No baseline/high-pass correction is applied here yet (see baseline.ts) — real background shape is
 * still unverified against hardware, so wiring it in now would be guessing at parameters. Add it once
 * a real sweep's background is characterised.
 */
export async function runCrossScan(
	io: MachineIO, readProbe: ReadProbe, offsets: number[], params: SweepParams, progress?: ProgressSink,
): Promise<CrossScanResult> {
	try {
		progress?.status?.("Sweeping X…");
		const xSamples = await sweepLine(io, readProbe, "X", offsets, params);
		if (params.shouldAbort?.()) return { ok: false, error: "aborted" };
		if (isIncompleteSweep(xSamples.map((p) => p.f))) {
			return { ok: false, error: "X sweep incomplete — peak sat at the edge of the scan window" };
		}
		const xFit = gaussianLogFit(xSamples.map((p) => p.x), xSamples.map((p) => p.f));

		progress?.status?.("Sweeping Y…");
		const ySamples = await sweepLine(io, readProbe, "Y", offsets, params);
		if (params.shouldAbort?.()) return { ok: false, error: "aborted" };
		if (isIncompleteSweep(ySamples.map((p) => p.f))) {
			return { ok: false, error: "Y sweep incomplete — peak sat at the edge of the scan window" };
		}
		const yFit = gaussianLogFit(ySamples.map((p) => p.x), ySamples.map((p) => p.f));

		return {
			ok: true,
			position: { x: xFit.mu, y: yFit.mu },
			confidence: Math.min(xFit.rSquared, yFit.rSquared),
		};
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
