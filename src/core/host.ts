/**
 * The seam between the scan/offset logic and whichever DuetWebControl it is running inside.
 *
 * DWC 3.7 is Vue 3 / Pinia / vue-i18n 11; DWC 3.6 is Vue 2.7 / Vuex 3 / vue-i18n 8. Those differ in
 * how you reach the object model, dispatch G-code, persist settings, and raise a notification — but
 * in nothing else `core/useEddyAlign.ts` or `updateCheck.ts` care about. Both take a
 * `HostAdapter` instead of importing any store directly, so the whole scan/offset/update-check flow
 * is written once and each UI layer supplies a small implementation (`ui37/host.ts`, `ui36/host.ts`).
 *
 * Deliberately raw: no Vue types cross this boundary, and every method is a plain read, a promise, or
 * a live reactive object — which is what lets the same file compile against both Vue versions.
 *
 * Pattern and most of this doc comment ported from `ClosedLoopTuningPlugin`/`resonance-lab`'s own
 * `src/core/host.ts` (both already ship real DWC 3.6 builds) — this is a proven seam, not a new idea.
 */
import type { EddyAlignConfig } from "../model/config";

export type NotifyLevel = "success" | "info" | "warning" | "error";

export interface HostAdapter {
	/**
	 * Read the machine object model.
	 *
	 * MUST touch the host's reactive state on every call rather than returning a cached snapshot —
	 * `tools`/`currentTool`/`prepareToolScanZ` and every other computed in `useEddyAlign` depend on
	 * this being tracked at read time, not memoised.
	 */
	model(): unknown;

	/**
	 * Send a G-code line, resolving with the firmware's reply once it has completed.
	 *
	 * `opts.log` controls whether DWC echoes the command into its own console/notifications, exactly
	 * like a command the user typed. Defaults to `true`. The M409 probe-poll traffic in
	 * `orchestrator.ts`'s `makeProbeReader` passes `{ log: false }` explicitly — see machineIO.ts's
	 * `quiet` param — since it fires once per sample point and would otherwise spam a notification on
	 * every single step of a scan.
	 */
	sendCode(code: string, opts?: { log?: boolean }): Promise<string>;

	/** Install a plugin ZIP through DWC's own installer — the one-click self-update path. */
	installPlugin(filename: string, blob: Blob, start: boolean): Promise<void>;

	/**
	 * Which release asset this DWC generation can actually install.
	 *
	 * A release carries one ZIP per supported DWC generation (`DuetEddyAlign-<version>.zip` for 3.7,
	 * `DuetEddyAlign-<version>-dwc36.zip` for 3.6) plus a debug source-map ZIP — the update checker
	 * otherwise just takes the first `*.zip` it finds, GitHub's asset order isn't guaranteed, and that
	 * would silently offer a 3.6 user the Vue 3 package (or the srcmap one). Each host narrows to its
	 * own — see `core/assetPatterns.ts`.
	 */
	assetPattern: RegExp;

	/** Raise a DWC toast/notification. */
	notify(level: NotifyLevel, title: string, message: string): void;

	/**
	 * Translate a key relative to this plugin's own namespace — implementations prepend
	 * `plugins.duetEddyAlign.`, so callers pass e.g. `"updates.title"`. Only needed by shared,
	 * non-component modules (`updateCheck.ts`) — component templates use the ambient `$t`
	 * directly, which both DWC generations install identically as a global mixin/property.
	 */
	t(key: string, args?: Record<string, unknown>): string;

	/**
	 * The live, reactive, persisted plugin config — same object identity on every call (a singleton,
	 * like `model/config.ts`'s existing `useConfig()`), so `host.config().probeX = value` and similar
	 * direct nested mutations (already how every call site in the widget works today, e.g.
	 * `cfg.toolScanZ[key] = z`) stay reactive and persist board-side on both DWC generations. See
	 * `ui37/host.ts` (wraps the existing Pinia-backed `useConfig()` unchanged) and `ui36/host.ts`
	 * (Vuex `settings/registerPluginData`+`settings/setPluginData`, same board-side/exportable
	 * mechanism, verified against DWC 3.6's real `src/store/settings.ts` before choosing this over the
	 * `localStorage` shortcut ClosedLoopTuning took — that would have been a real regression here,
	 * given how much this plugin's captures/datumPoint persistence already relies on surviving
	 * reload/reconnect).
	 */
	config(): EddyAlignConfig;
}
