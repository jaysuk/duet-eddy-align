/**
 * Duet Eddy Align — entry point.
 *
 * v0.1.0: registers the standalone DWC page only. No embeddable widget / self-update wiring yet —
 * those get added once there's an actual scan workflow to embed and a first tagged release to check
 * against.
 */
import { registerPluginMessages, registerRoute, unregisterRoute } from "@/plugins";
import Events from "@/utils/events";
import { installErrorCapture } from "dwc-plugin-runtime";

import EddyAlignPage from "./EddyAlignPage.vue";
import { PLUGIN_ID, PLUGIN_MANIFEST_ID, ROUTE_PATH } from "./model/constants";
import en from "./i18n/en.json";

registerPluginMessages(PLUGIN_ID, { en });

registerRoute(EddyAlignPage, {
	Plugins: {
		DuetEddyAlign: {
			icon: "mdi-magnet",
			caption: "plugins.duetEddyAlign.menuCaption",
			path: ROUTE_PATH,
		},
	},
});

// Buffer uncaught errors/rejections for diagnostics; cleaned up on unload.
const uninstallErrorCapture = installErrorCapture();

function onPluginUnloaded(id: string): void {
	if (id === PLUGIN_MANIFEST_ID) {
		unregisterRoute(ROUTE_PATH);
		uninstallErrorCapture();
		Events.off("dwcPluginUnloaded", onPluginUnloaded);
	}
}
Events.on("dwcPluginUnloaded", onPluginUnloaded);
