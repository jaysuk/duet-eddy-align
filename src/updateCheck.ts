/**
 * Self-update for Duet Eddy Align, working WITH the shared cross-plugin update hub in
 * dwc-plugin-runtime (the same one Flexible Layouts and Duet Tool Align use).
 *
 * On load it checks GitHub Releases for a newer build and, when one is found, ANNOUNCES it into the
 * hub (`announceUpdate`). If a host is present (e.g. FL's shell, which claims the host), that host
 * renders ONE aggregated popup listing every plugin with an update — so this plugin appears in the
 * unified popup rather than nagging separately. When no host is active we fall back to our own
 * one-shot notification, and the widget always shows an in-context banner with a one-click apply.
 *
 * Lives here, not in `model/` — that directory's whole point is "zero DWC/Vue coupling, ever," and
 * this file (even though host-injected, not store-coupled) is fundamentally about talking to DWC.
 * Shared by both DWC generations (see `./core/host.ts`) — reaches DWC only through the injected
 * `HostAdapter`, never through a store directly. That's what lets this same file compile and run
 * against both the Pinia (3.7) and Vuex (3.6) builds. Ported from duet-tool-align's updateCheck.ts,
 * including its already-learned assetPattern fix — each host supplies its own `assetPattern` (see
 * `core/assetPatterns.ts`), so no need to rediscover that bug here.
 */
// Deep subpaths, not the package barrel: the barrel also re-exports AboutDialog (a Vue 3 render
// function using resolveComponent, absent in Vue 2.7) — pulling it into this shared module would
// break a DWC 3.6 build. These specific modules import no Vue at all.
import { applyUpdate, checkForUpdate, type UpdateResult } from "dwc-plugin-runtime/updates";
import { announceUpdate, clearAnnouncedUpdate, isUpdateHostActive } from "dwc-plugin-runtime/updateHub";
import { ref } from "vue";

import type { HostAdapter } from "./core/host";
import { PLUGIN_MANIFEST_ID } from "./model/constants";

/** Set once at plugin load by whichever entry point is running (ui37/index.ts or ui36/index.ts). This
 *  module runs before any component mounts, so it cannot reach a store directly — see ./core/host. */
let host: HostAdapter | null = null;
export function setUpdateHost(h: HostAdapter): void { host = h; }

const OWNER = "jaysuk";
const REPO = "duet-eddy-align";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-check at most once a day on load

const LS_ENABLED = "duetEddyAlign.updateCheck.enabled";
const LS_LAST = "duetEddyAlign.updateCheck.lastCheck";
const LS_DISMISSED = "duetEddyAlign.updateCheck.dismissed";

export const updateState = ref<UpdateResult | null>(null);
export const applying = ref(false);
/** True after a one-click update: the running bundle is stale until the page reloads. */
export const pendingReload = ref(false);
export const dismissedVersion = ref<string | null>(safeGet(LS_DISMISSED));

const t = (key: string, named?: Record<string, unknown>) => host?.t(`updates.${key}`, named) ?? "";
const pluginTitle = () => host?.t("title") ?? "Duet Eddy Align";

function safeGet(key: string): string | null {
	try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
	try { localStorage.setItem(key, value); } catch { /* storage disabled */ }
}

/** Installed plugin version, from the object model's plugins map (authoritative). */
function currentVersion(): string {
	const plugins = (host?.model() as { plugins?: Map<string, { version?: string }> } | undefined)?.plugins;
	return plugins?.get(PLUGIN_MANIFEST_ID)?.version ?? "0.0.0";
}

export function updateChecksEnabled(): boolean {
	return safeGet(LS_ENABLED) !== "false";
}
export function setUpdateChecksEnabled(on: boolean): void {
	safeSet(LS_ENABLED, on ? "true" : "false");
	if (!on) clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
}

/** Mirror the current result into the shared hub so a host's aggregated popup can include us. */
function syncHub(): void {
	const s = updateState.value;
	if (s?.updateAvailable && dismissedVersion.value !== s.latestVersion) {
		announceUpdate(PLUGIN_MANIFEST_ID, pluginTitle(), s);
	} else {
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
	}
}

/**
 * Run a check. Throttled to once per {@link CHECK_INTERVAL_MS} unless forced, skipped when disabled.
 * Announces into the hub; with `notify` (and no host present) raises a one-off fallback notification.
 * Never throws.
 */
export async function runUpdateCheck(opts: { force?: boolean; notify?: boolean } = {}): Promise<UpdateResult | null> {
	if (!opts.force) {
		if (!updateChecksEnabled()) return null;
		const last = Number(safeGet(LS_LAST) || 0);
		if (Date.now() - last < CHECK_INTERVAL_MS) {
			syncHub();
			return updateState.value;
		}
	}
	try {
		const result = await checkForUpdate({
			owner: OWNER, repo: REPO, currentVersion: currentVersion(),
			...(host?.assetPattern ? { assetPattern: host.assetPattern } : {}),
		});
		updateState.value = result;
		safeSet(LS_LAST, String(Date.now()));
		if (opts.notify && result.updateAvailable && dismissedVersion.value !== result.latestVersion && !isUpdateHostActive()) {
			const message = result.scenario === "dwcUpdate"
				? t("notifyDwc", { version: result.latestVersion, dwc: result.requiredDwc })
				: t("notifyPlugin", { version: result.latestVersion });
			host?.notify("info", t("title"), message);
		}
		syncHub();
		return result;
	} catch {
		return null; // offline / rate-limited / CORS — never throw
	}
}

/** Stop offering the current version (until a newer release); also drops us from the unified popup. */
export function dismissCurrentUpdate(): void {
	const v = updateState.value?.latestVersion;
	if (v) {
		safeSet(LS_DISMISSED, v);
		dismissedVersion.value = v;
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
	}
}

/** Download the release ZIP and install it via DWC (hot-reloads the bundle). Falls back to a link. */
export async function applyUpdateNow(): Promise<void> {
	const result = updateState.value;
	if (!result?.assetUrl || !result.assetName || !host) {
		host?.notify("warning", t("title"), t("applyFailed"));
		return;
	}
	applying.value = true;
	try {
		await applyUpdate({
			assetUrl: result.assetUrl,
			assetName: result.assetName,
			installPlugin: (filename, blob, start) => host!.installPlugin(filename, blob, start),
		});
		pendingReload.value = true;
		clearAnnouncedUpdate(PLUGIN_MANIFEST_ID);
		host.notify("success", t("title"), t("installedReload", { version: result.latestVersion }));
	} catch (e) {
		console.warn("[DuetEddyAlign] update failed:", e);
		host.notify("warning", t("title"), t("corsBlocked"));
		window.location.href = result.assetUrl; // manual download fallback
	} finally {
		applying.value = false;
	}
}
