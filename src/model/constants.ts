/**
 * Shared plugin identifiers. Kept in a leaf module so any file can import them without pulling in
 * index.ts (which would create an import cycle).
 */

/** Manifest id (plugin.json `id`) — used for dwcPluginLoaded/Unloaded events and the dwcFiles manifest. */
export const PLUGIN_MANIFEST_ID = "DuetEddyAlign";

/** camelCase key for settings persistence and i18n (`plugins.duetEddyAlign.*`). */
export const PLUGIN_ID = "duetEddyAlign";

/** Route path for the standalone DWC page. */
export const ROUTE_PATH = "/Plugins/DuetEddyAlign";
