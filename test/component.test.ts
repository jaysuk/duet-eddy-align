import { beforeEach, describe, expect, it } from "vitest";
import { mountInDwc, resetDwc } from "dwc-plugin-test-kit";

import EddyAlignPage from "../src/ui37/EddyAlignPage.vue";

describe("EddyAlignPage", () => {
	beforeEach(() => resetDwc());

	it("mounts without throwing", () => {
		expect(mountInDwc(EddyAlignPage).exists()).toBe(true);
	});
});
