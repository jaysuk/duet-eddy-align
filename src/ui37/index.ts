/**
 * Duet Eddy Align — DuetWebControl 3.7+ entry point.
 *
 * The repo's top-level `src/index.ts` just re-exports this; `scripts/stage-dwc36.mjs` generates a
 * replacement pointing at `../ui36/index` inside its staged tree for the 3.6 build. See `../ui36/index.ts`
 * for the registration differences (documented there, not here — 3.7's own `@/plugins` API is what
 * this file already uses natively).
 */
import { registerPluginMessages, registerRoute, unregisterRoute } from "@/plugins";
import Events from "@/utils/events";
import { clearAnnouncedUpdate, installErrorCapture } from "dwc-plugin-runtime";

import EddyAlignPage from "./EddyAlignPage.vue";
import { createHost } from "./host";
import { PLUGIN_ID, PLUGIN_MANIFEST_ID, ROUTE_PATH } from "../model/constants";
import { runUpdateCheck, setUpdateHost } from "../updateCheck";
import en from "../i18n/en.json";

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

setUpdateHost(createHost());

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
