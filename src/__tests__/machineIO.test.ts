import { describe, expect, it } from "vitest";

import { axisPosition, toolList } from "../model/machineIO";

describe("axisPosition", () => {
	it("finds the named axis's machine position", () => {
		const model = { move: { axes: [{ letter: "X", machinePosition: 12.5 }, { letter: "Y", machinePosition: -3 }] } };
		expect(axisPosition(model, "X")).toBe(12.5);
		expect(axisPosition(model, "Y")).toBe(-3);
	});

	it("returns null for a missing axis or malformed model", () => {
		expect(axisPosition({ move: { axes: [] } }, "Z")).toBeNull();
		expect(axisPosition({}, "X")).toBeNull();
		expect(axisPosition(null, "X")).toBeNull();
	});
});

describe("toolList", () => {
	it("maps tools with their current G10 X/Y offset", () => {
		const model = {
			tools: [
				{ number: 0, name: "Tool 0", offsets: [1.5, -0.2, 0] },
				{ number: 1, offsets: [] },
			],
		};
		expect(toolList(model)).toEqual([
			{ number: 0, name: "Tool 0", curX: 1.5, curY: -0.2 },
			{ number: 1, name: "T1", curX: null, curY: null },
		]);
	});

	it("returns an empty list when tools are missing", () => {
		expect(toolList({})).toEqual([]);
	});
});
