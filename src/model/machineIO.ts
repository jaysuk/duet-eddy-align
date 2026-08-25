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

export function useEddyMachineIO(): MachineIO {
	const machine = useMachineStore();
	return {
		sendCode: (code: string) => machine.sendCode(code),
		machinePos: (letter) => axisPosition(machine.model, letter),
	};
}
