/**
 * Turns tool captures into offset-table rows. Pulled out of the widget so the two reference modes —
 * "tool" (measure everyone against a chosen reference tool) and "point" (measure everyone against a
 * fixed carriage datum, e.g. a homing switch) — and the zeroReferenceOffset escape hatch are
 * unit-testable without mounting a component.
 */
import type { EddyAlignConfig } from "./config";
import type { ToolInfo } from "./machineIO";
import type { ScanCapture } from "./scanWorkflow";
import { computeToolOffset, formatG10, type ToolOffset } from "../util/toolAlign";

export interface OffsetRow {
	number: number;
	name: string;
	curX: number | null;
	curY: number | null;
	capture: ScanCapture | null;
	g10: string | null;
}

type ReferenceConfig = Pick<EddyAlignConfig, "referenceMode" | "referenceTool" | "invertOffsets" | "zeroReferenceOffset">;

/** Whichever capture the whole table is measured against: the reference tool's own scan in "tool"
 *  mode, or the captured datum in "point" mode. Null until that capture exists. */
export function referenceCapture(
	cfg: Pick<ReferenceConfig, "referenceMode" | "referenceTool">,
	captures: Record<number, ScanCapture>,
	datumCapture: ScanCapture | null,
): ScanCapture | null {
	return cfg.referenceMode === "point" ? datumCapture : (captures[cfg.referenceTool] ?? null);
}

/**
 * The offset the reference itself carries forward into every other tool's computed offset:
 *  - "point" mode: always zero — a fixed carriage datum has no G10 offset of its own.
 *  - "tool" mode, zeroReferenceOffset off (default false): the reference tool's *existing* G10,
 *    preserving whatever mapping it already established — matches duet-tool-align's convention.
 *  - "tool" mode, zeroReferenceOffset on: also zero. For a from-scratch calibration where the
 *    reference tool's current G10 shouldn't be trusted — its own freshly-scanned position becomes
 *    the new baseline instead of whatever it happened to have before.
 */
export function baseReferenceOffset(
	cfg: Pick<ReferenceConfig, "referenceMode" | "referenceTool" | "zeroReferenceOffset">,
	tools: Array<ToolInfo>,
): ToolOffset {
	if (cfg.referenceMode === "point" || cfg.zeroReferenceOffset) return { x: 0, y: 0 };
	const refTool = tools.find((t) => t.number === cfg.referenceTool);
	return { x: refTool?.curX ?? 0, y: refTool?.curY ?? 0 };
}

export function computeOffsetRows(
	tools: Array<ToolInfo>,
	captures: Record<number, ScanCapture>,
	datumCapture: ScanCapture | null,
	cfg: ReferenceConfig,
): Array<OffsetRow> {
	const ref = referenceCapture(cfg, captures, datumCapture);
	const refOffset = baseReferenceOffset(cfg, tools);
	return tools.map((t) => {
		const capture = captures[t.number] ?? null;
		const offset = capture && ref
			? computeToolOffset({ x: ref.x, y: ref.y }, { x: capture.x, y: capture.y }, refOffset, cfg.invertOffsets)
			: null;
		return {
			number: t.number,
			name: t.name,
			curX: t.curX,
			curY: t.curY,
			capture,
			g10: offset ? formatG10(t.number, offset) : null,
		};
	});
}
