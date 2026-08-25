/**
 * Motion + sampling orchestration for a per-tool eddy-current scan.
 *
 * Decoupled from Vue/DWC behind two injected seams, same shape as duet-tool-align's orchestrator:
 *   - MachineIO: send G-code + read machine axis positions.
 *   - ReadProbe: return one settled Scanning Z Probe reading (or null if it didn't settle in time).
 *
 * ReadProbe exists specifically so the still-open question in docs/open-questions.md — exactly which
 * object-model field or gcode gives a single settled SZP reading on a standalone (no-SBC) Duet — can
 * be resolved later without touching the sweep/fit sequencing below. Until then, this defaults to
 * **triggered step-and-sample**: jog to each point, M400, read once. That only needs whatever RRF
 * already exposes for a settled reading, not a position-synced stream during continuous motion — see
 * docs/open-questions.md for why that's the safer starting assumption on standalone Duet.
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
