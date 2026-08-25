import { beforeEach, describe, expect, it } from "vitest";
import { mountInDwc, resetDwc } from "dwc-plugin-test-kit";

import EddyAlignPage from "../src/EddyAlignPage.vue";

describe("EddyAlignPage", () => {
	beforeEach(() => resetDwc());

	it("mounts without throwing", () => {
		expect(mountInDwc(EddyAlignPage).exists()).toBe(true);
	});
});
