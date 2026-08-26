/**
 * Bridges orchestrator.ts's plain MachineIO seam to DWC's real machine store. Kept separate from the
 * pure model/ layer (this file imports "@/stores/machine", so it can't be unit tested without the
 * dwc-plugin-test-kit stub) — the pure helpers below (axisPosition, toolList) are extracted so the
 * object-model reading logic itself stays testable without a live store.
 */
import { useMachineStore } from "@/stores/machine";

import { resolveOmPath } from "../util/omPath";
import type { MachineIO } from "./orchestrator";

interface RawAxis { letter?: string; machinePosition?: number | null }
interface RawTool { number?: number; name?: string; offsets?: Array<number> }

export interface ToolInfo {
	number: number;
	name: string;
	/** The tool's currently-applied G10 X/Y offset, before anything this plugin sends. */
	curX: number | null;
	curY: number | null;
}

/** Current machine position of one axis letter (e.g. "X"), or null if unavailable/not homed. */
export function axisPosition(model: unknown, letter: string): number | null {
	const arr = resolveOmPath(model, "move.axes");
	if (!Array.isArray(arr)) return null;
	const axis = (arr as Array<RawAxis>).find((a) => a?.letter === letter);
	return axis && typeof axis.machinePosition === "number" ? axis.machinePosition : null;
}

/** Tools from the object model, with their current G10 X/Y offset (index 0/1) if any. */
export function toolList(model: unknown): Array<ToolInfo> {
	const arr = resolveOmPath(model, "tools");
	if (!Array.isArray(arr)) return [];
	return (arr as Array<RawTool>)
		.filter((t): t is RawTool & { number: number } => typeof t?.number === "number")
		.map((t) => ({
			number: t.number,
			name: t.name || `T${t.number}`,
			curX: Array.isArray(t.offsets) && typeof t.offsets[0] === "number" ? t.offsets[0] : null,
			curY: Array.isArray(t.offsets) && typeof t.offsets[1] === "number" ? t.offsets[1] : null,
		}));
}

/** The currently loaded tool number, or null if none is selected -- RRF's object model reports this
 *  as state.currentTool, -1 meaning "no tool". */
export function currentToolNumber(model: unknown): number | null {
	const v = resolveOmPath(model, "state.currentTool");
	return typeof v === "number" && v >= 0 ? v : null;
}

/** How long a single sendCode is allowed to sit unresolved before this treats it as failed. A scan
 *  can be many minutes long, dominated entirely by calls like this one -- without a bound, a
 *  connection drop mid-scan means every `await` in the chain (sweepLine, scanTool,
 *  runRepeatabilityCheck) just never returns, which no amount of setting the Stop button's abort
 *  flag can fix: nothing is left running that would ever check it again. Firing a real rejection
 *  here is what lets the existing try/catch chain (and the next loop iteration's shouldAbort check)
 *  actually run. 15s is generous for a normal jog+M400+M409 round trip, which is normally
 *  sub-second, while still bounding a real hang to something a user isn't stuck waiting forever on. */
export const SEND_CODE_TIMEOUT_MS = 15000;

/** Races `promise` against a timer; rejects with a message naming what timed out if the timer wins.
 *  Pure and independently testable -- the DWC-store dependency below is what actually can't be unit
 *  tested without dwc-plugin-test-kit, not this. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`${label} did not respond within ${(ms / 1000).toFixed(0)}s -- the machine may have disconnected`)),
			ms,
		);
		promise.then(
			(v) => { clearTimeout(timer); resolve(v); },
			(e) => { clearTimeout(timer); reject(e); },
		);
	});
}

export function useEddyMachineIO(): MachineIO {
	const machine = useMachineStore();
	return {
		sendCode: (code, quiet) => withTimeout(machine.sendCode(code, false, !quiet), SEND_CODE_TIMEOUT_MS, "sendCode"),
		machinePos: (letter) => axisPosition(machine.model, letter),
	};
}
