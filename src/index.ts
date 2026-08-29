/**
 * Duet Eddy Align — entry point.
 *
 * Registers the standalone DWC page. No embeddable-widget wiring yet (no Flexible-Layouts host
 * merge, unlike duet-tool-align) — self-update wiring is in, following the same
 * dwc-plugin-runtime hub pattern.
 */
import { registerPluginMessages, registerRoute, unregisterRoute } from "@/plugins";
import Events from "@/utils/events";
import { clearAnnouncedUpdate, installErrorCapture } from "dwc-plugin-runtime";

import EddyAlignPage from "./EddyAlignPage.vue";
import { PLUGIN_ID, PLUGIN_MANIFEST_ID, ROUTE_PATH } from "./model/constants";
import { runUpdateCheck } from "./model/updateCheck";
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

// Check GitHub for a newer release shortly after load and announce it into the shared update hub
// (FL's shell, if active, shows it in the unified popup; otherwise we fall back to our own banner +
// notification). Deferred so the connection/object-model has settled enough to read the version.
setTimeout(() => { void runUpdateCheck({ notify: true }); }, 4000);

function onPluginUnloaded(id: string): void {
	if (id === PLUGIN_MANIFEST_ID) {
		unregisterRoute(ROUTE_PATH);
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID); // drop us from the unified popup
		uninstallErrorCapture();
		Events.off("dwcPluginUnloaded", onPluginUnloaded);
	}
}
Events.on("dwcPluginUnloaded", onPluginUnloaded);
