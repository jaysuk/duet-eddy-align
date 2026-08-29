/**
 * `HostAdapter` for DuetWebControl 3.7+ (Vue 3, Pinia, vue-i18n 11).
 *
 * Must be called from inside a component's setup, or after Pinia is otherwise active (`index.ts`
 * calls it at plugin-load time, which DWC guarantees runs after Pinia is installed) — `useMachineStore`/
 * `useUiStore`/`useSettingsStore` need an active Pinia instance. See `../ui36/host.ts` for the Vue 2.7
 * / Vuex 3 counterpart.
 */
import { useMachineStore } from "@/stores/machine";
import { LogLevel, useUiStore } from "@/stores/ui";
import i18n from "@/i18n";

import { ASSET_PATTERN_37 } from "../core/assetPatterns";
import type { HostAdapter, NotifyLevel } from "../core/host";
import { useConfig } from "../model/config";
import { SEND_CODE_TIMEOUT_MS, withTimeout } from "../model/machineIO";

const LEVELS: Record<NotifyLevel, LogLevel> = {
	success: LogLevel.success,
	info: LogLevel.info,
	warning: LogLevel.warning,
	error: LogLevel.error,
};

/** Extra store members not on the public typings (mirrors the same pattern in machineIO.ts/updateCheck.ts). */
type MachineExtras = {
	installPlugin(filename: string, blob: Blob, start: boolean): Promise<void>;
};

/**
 * Each method resolves its store on call rather than once up front, so this can safely be built at
 * plugin-load time (from index.ts, before any component exists) as well as inside setup.
 */
export function createHost(): HostAdapter {
	const machine = () => useMachineStore();

	return {
		// Property read (not a cached destructure) so Pinia tracks it for every computed that depends
		// on it, same reasoning as the existing machineIO.ts seam this replaces.
		model: () => machine().model,

		// withTimeout: a connection drop mid-scan must not leave every await in the sweepLine/scanTool/
		// runRepeatabilityCheck chain unresolved forever -- see machineIO.ts's own doc comment on this
		// (this is exactly the fix for the "Stop does nothing after a disconnect" bug from earlier).
		sendCode: async (code, opts) => String(
			await withTimeout(machine().sendCode(code, false, opts?.log ?? true), SEND_CODE_TIMEOUT_MS, "sendCode") ?? "",
		),
		installPlugin: (filename, blob, start) => (machine() as unknown as MachineExtras).installPlugin(filename, blob, start),

		assetPattern: ASSET_PATTERN_37,

		notify: (level, title, message) => { useUiStore().makeNotification(LEVELS[level], title, message); },
		t: (key, args) => i18n.global.t(`plugins.duetEddyAlign.${key}`, args ?? {}),

		// useConfig() already returns the same reactive singleton on every call (see model/config.ts) --
		// this is a zero-cost wrap, not a copy.
		config: () => useConfig(),
	};
}
