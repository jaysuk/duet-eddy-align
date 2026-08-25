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
		expect(cfg.fitMethod).toBe("gaussianLog"); // weightedQuadratic is opt-in / auto-switch only
		expect(cfg.weightedQuadraticSigma).toBeGreaterThan(0);
		expect(cfg.bidirectionalScan).toBe(false); // opt-in, roughly doubles scan time
		expect(cfg.repeatabilityRuns).toBe(3);
		expect(cfg.refineScan).toBe(false); // opt-in, multiplies scan time
		expect(cfg.refineMaxPasses).toBe(3);
		expect(cfg.refineShrink).toBe(0.5);
		expect(cfg.refineTolerance).toBeGreaterThan(0);
		expect(cfg.datumPoint).toBeNull();
	});
});
