/**
 * Automated repeatability check — run a tool's scan N times and report the spread, instead of
 * manually re-clicking Scan and eyeballing it. Same idea as the Klipper/Kalico prior art's
 * EDDY_REPEATABILITY / EDDY_SEEK_ACCURACY commands, adapted to this repo's scanTool() primitive.
 */
import type { EddyAlignConfig } from "./config";
import type { MachineIO, ProgressSink, ReadProbe } from "./orchestrator";
import { type ScanCapture, scanTool } from "./scanWorkflow";

export interface RepeatabilityResult {
	runs: number;
	succeeded: number;
	meanX: number | null;
	meanY: number | null;
	/** Sample standard deviation (÷(n−1)), not population (÷n) — see the module doc below for why.
	 *  null whenever fewer than 2 runs succeeded, not 0: a single run reading "perfectly repeatable"
	 *  would be actively misleading. */
	stdX: number | null;
	stdY: number | null;
	captures: ScanCapture[];
}

function mean(values: number[]): number {
	return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Sample standard deviation (Bessel's correction, ÷(n−1)); null for n<2. */
function sampleStd(values: number[]): number | null {
	if (values.length < 2) return null;
	const m = mean(values);
	const sumSq = values.reduce((s, v) => s + (v - m) ** 2, 0);
	return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Runs scanTool() `runs` times sequentially on the same tool (or in place, for a "point" datum, when
 * toolNumber is null) and reports mean ± spread per axis.
 *
 * Sample standard deviation, deliberately not jaak0b's population stddev: this number exists to tell
 * the user whether to trust a single scan — estimating the *true* repeatability from a small sample
 * (typically 3-5 runs) is exactly what sample stddev is for. Population stddev underestimates it
 * (~22% low at n=3), and for a metric whose failure mode is "operator sees a falsely reassuring
 * number and trusts a bad calibration," under-reporting is the wrong bias to have.
 */
export async function runRepeatabilityCheck(
	io: MachineIO, readProbe: ReadProbe, cfg: EddyAlignConfig, toolNumber: number | null, runs: number,
	progress?: ProgressSink, shouldAbort?: () => boolean,
): Promise<RepeatabilityResult> {
	const captures: ScanCapture[] = [];

	for (let i = 0; i < runs; i++) {
		if (shouldAbort?.()) break;
		progress?.status?.(`Repeatability run ${i + 1}/${runs}…`);
		const outcome = await scanTool(io, readProbe, cfg, toolNumber, progress, shouldAbort);
		if (outcome.ok && outcome.capture) captures.push(outcome.capture);
	}

	const xs = captures.map((c) => c.x);
	const ys = captures.map((c) => c.y);

	return {
		runs,
		succeeded: captures.length,
		meanX: xs.length > 0 ? mean(xs) : null,
		meanY: ys.length > 0 ? mean(ys) : null,
		stdX: sampleStd(xs),
		stdY: sampleStd(ys),
		captures,
	};
}
