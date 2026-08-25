import { describe, expect, it } from "vitest";

import { defaultConfig } from "../model/config";

describe("defaultConfig", () => {
	it("starts with no probe position set and the M500 P10 save command", () => {
		const cfg = defaultConfig();
		expect(cfg.probeX).toBeNull();
		expect(cfg.probeY).toBeNull();
		expect(cfg.saveCommand).toBe("M500 P10");
		expect(cfg.referenceMode).toBe("tool");
		expect(cfg.referenceTool).toBe(0);
		expect(cfg.zeroReferenceOffset).toBe(true); // scan the reference tool fresh by default, don't trust a stale G10
	});
});
