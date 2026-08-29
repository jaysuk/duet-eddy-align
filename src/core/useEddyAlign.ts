/**
 * The whole Eddy Align page's logic — scan orchestration, offsets, repeatability, prepare-tool,
 * manual jog/probe-position, the Stop/abort flag, the confirm-before-send dialog. Takes a
 * `HostAdapter` (see `./host.ts`) instead of importing any store directly, so this same file compiles
 * and runs against both the Pinia (DWC 3.7) and Vuex (DWC 3.6) builds — each UI layer's `.vue` file
 * just binds its own markup to whatever this returns.
 *
 * Self-update state (`updateState`/`applying`/`pendingReload`/`dismissedVersion`/`applyUpdateNow`/
 * `dismissCurrentUpdate`) is deliberately NOT routed through here — those are plain module-level
 * singletons already exported by `updateCheck.ts` (itself host-injected via `setUpdateHost`),
 * so every UI layer imports them directly from there instead of threading them through this composable
 * too. Same split ClosedLoopTuningPlugin/resonance-lab use.
 */
import { computed, onUnmounted, ref } from "vue";

import type { HostAdapter } from "./host";
import { axisPosition, currentToolNumber, toolList } from "../model/machineIO";
import { startPolling } from "../model/liveProbe";
import { computeOffsetRows } from "../model/offsets";
import { jogAxisCode, makeProbeReader, type MachineIO } from "../model/orchestrator";
import { type RepeatabilityResult, runRepeatabilityCheck } from "../model/repeatability";
import { goToProbePosition, scanTool, type ScanCapture } from "../model/scanWorkflow";

export function useEddyAlign(host: HostAdapter) {
	const cfg = host.config();

	// A plain MachineIO built from the host -- everything in model/ (orchestrator.ts, scanWorkflow.ts,
	// repeatability.ts) already only needs this narrow seam, unchanged from before this refactor.
	const io: MachineIO = {
		sendCode: (code, quiet) => host.sendCode(code, { log: !quiet }),
		machinePos: (letter) => axisPosition(host.model(), letter),
	};

	const tab = ref("setup");
	const tools = computed(() => toolList(host.model()));
	const toolOptions = computed(() => tools.value.map((t) => ({ title: t.name, value: t.number })));
	const currentTool = computed(() => currentToolNumber(host.model()));
	const referenceModeItems = [
		{ title: "Reference tool", value: "tool" as const },
		{ title: "Fixed datum point", value: "point" as const },
	];
	const fitMethodItems = [
		{ title: "Gaussian log-fit", value: "gaussianLog" as const },
		{ title: "Weighted quadratic", value: "weightedQuadratic" as const },
	];

	// --- Live reading -----------------------------------------------------------------------------

	const liveValue = ref<number | null>(null);
	const liveActive = ref(false);
	let stopLive: (() => void) | null = null;

	function toggleLive(): void {
		if (liveActive.value) {
			stopLive?.();
			stopLive = null;
			liveActive.value = false;
			return;
		}
		liveActive.value = true;
		const read = makeProbeReader(io, cfg.probeIndex);
		stopLive = startPolling(read, cfg.livePollMs, (v) => { liveValue.value = v; });
	}
	onUnmounted(() => stopLive?.());

	// --- Manual jog + probe position ---------------------------------------------------------------

	async function jog(axis: "X" | "Y" | "Z", delta: number): Promise<void> {
		await io.sendCode(jogAxisCode(axis, delta, cfg.jogFeed));
	}

	function setProbeXY(): void {
		cfg.probeX = axisPosition(host.model(), "X");
		cfg.probeY = axisPosition(host.model(), "Y");
	}
	function setProbeZ(): void {
		cfg.probeZ = axisPosition(host.model(), "Z");
	}
	async function onGoToProbe(): Promise<void> {
		lastError.value = "";
		try {
			await goToProbePosition(io, cfg);
		} catch (err) {
			lastError.value = err instanceof Error ? err.message : String(err);
		}
	}

	// --- Prepare tool (Scan tab) -------------------------------------------------------------------
	// Lets a tool be loaded and its scan Z adjusted -- while watching the live reading -- without
	// leaving the Scan tab or disturbing cfg.probeZ, the global default every other tool still falls
	// back to. Deliberately writes a stored per-tool value (cfg.toolScanZ) rather than trusting
	// wherever Z happens to be at scan time -- see scanWorkflow.ts's goToProbePosition.

	const prepareToolNumber = ref<number | null>(null);

	async function onLoadPrepareTool(): Promise<void> {
		if (prepareToolNumber.value == null) return;
		lastError.value = "";
		try {
			await io.sendCode(`T${prepareToolNumber.value}`);
		} catch (err) {
			lastError.value = err instanceof Error ? err.message : String(err);
		}
	}

	function onSetToolScanZ(): void {
		if (prepareToolNumber.value == null) return;
		const z = axisPosition(host.model(), "Z");
		if (z == null) {
			lastError.value = "Z position unavailable — home first";
			return;
		}
		cfg.toolScanZ[String(prepareToolNumber.value)] = z;
	}

	function onClearToolScanZ(): void {
		if (prepareToolNumber.value == null) return;
		delete cfg.toolScanZ[String(prepareToolNumber.value)];
	}

	/** What Set-Scan-Z's caption line for the currently selected prepare-tool should say: its stored
	 *  override if it has one, else the global default (cfg.probeZ, which may itself be unset). */
	const prepareToolScanZ = computed<{ value: number | null; isOverride: boolean } | null>(() => {
		if (prepareToolNumber.value == null) return null;
		const key = String(prepareToolNumber.value);
		const override = cfg.toolScanZ[key];
		return override != null ? { value: override, isOverride: true } : { value: cfg.probeZ, isOverride: false };
	});

	// --- Scanning ------------------------------------------------------------------------------

	/** Backed directly by cfg.captures (persisted, see config.ts) rather than a session-only ref --
	 *  a disconnect/reconnect, an accidental reload, or Stop-then-hung-scan used to lose every capture
	 *  from the session so far, with no way back except re-scanning. Just an alias: cfg is already a
	 *  reactive proxy on both DWC generations, so this nested object stays fully reactive, same as
	 *  cfg.toolScanZ used directly elsewhere here. */
	const captures = cfg.captures;
	/** Derived from the persisted cfg.datumPoint (see config.ts) rather than held as its own ref, so a
	 *  captured datum survives a reload. Shaped as a ScanCapture (confidence: 1) purely for
	 *  computeOffsetRows's sake -- that "confidence" isn't a real fit quality, just a placeholder for a
	 *  raw position reading, same as before this became persisted. */
	const datumCapture = computed<ScanCapture | null>(() => {
		const d = cfg.datumPoint;
		return d ? { x: d.x, y: d.y, confidence: 1 } : null;
	});
	const scanningTool = ref<number | null>(null);
	const scanningAll = ref(false);
	const statusText = ref("");
	const lastError = ref("");

	// --- Stop --------------------------------------------------------------------------------------
	// aborting is read (never reset) by whatever's currently running; only the top-level action that
	// *starts* an operation (a single Scan, Scan all, or Check repeatability) resets it. onScanAll's
	// per-tool loop must NOT reset it between tools -- that would make Stop only cancel the tool in
	// progress and silently continue to the next one, defeating the point of a whole-run Stop.
	const aborting = ref(false);
	const isBusy = computed(() => scanningTool.value !== null || scanningAll.value || repeatabilityTool.value !== null);
	function stopOperation(): void { aborting.value = true; }

	async function runScan(toolNumber: number | null): Promise<ScanCapture | null> {
		const readProbe = makeProbeReader(io, cfg.probeIndex);
		const outcome = await scanTool(
			io, readProbe, cfg, toolNumber, { status: (m) => { statusText.value = m; } }, () => aborting.value,
		);
		statusText.value = "";
		if (!outcome.ok || !outcome.capture) {
			lastError.value = outcome.error ?? "Scan failed";
			return null;
		}
		return outcome.capture;
	}

	/** Shared by onScanTool and onScanAll's loop -- does not touch `aborting`, so it composes correctly
	 *  under a run that's aborting mid-loop (see the note on `aborting` above). */
	async function performScan(toolNumber: number): Promise<void> {
		scanningTool.value = toolNumber;
		const capture = await runScan(toolNumber);
		if (capture) captures[toolNumber] = capture;
		scanningTool.value = null;
	}

	async function onScanTool(toolNumber: number): Promise<void> {
		lastError.value = "";
		aborting.value = false;
		await performScan(toolNumber);
	}

	async function onScanAll(): Promise<void> {
		lastError.value = "";
		aborting.value = false;
		scanningAll.value = true;
		for (let i = 0; i < tools.value.length; i++) {
			if (aborting.value) break;
			const t = tools.value[i];
			statusText.value = `Scanning T${t.number} (${i + 1} of ${tools.value.length})…`;
			await performScan(t.number);
		}
		statusText.value = "";
		scanningAll.value = false;
	}

	function onClearCapture(toolNumber: number): void {
		delete captures[toolNumber];
	}

	function onClearAllCaptures(): void {
		for (const key of Object.keys(captures)) delete captures[Number(key)];
	}

	const repeatabilityTool = ref<number | null>(null);
	const repeatabilityOpen = ref(false);
	const repeatabilityResult = ref<RepeatabilityResult | null>(null);

	async function onCheckRepeatability(toolNumber: number): Promise<void> {
		lastError.value = "";
		aborting.value = false;
		repeatabilityTool.value = toolNumber;
		const readProbe = makeProbeReader(io, cfg.probeIndex);
		repeatabilityResult.value = await runRepeatabilityCheck(
			io, readProbe, cfg, toolNumber, cfg.repeatabilityRuns,
			{ status: (m) => { statusText.value = m; } }, () => aborting.value,
		);
		statusText.value = "";
		repeatabilityTool.value = null;
		repeatabilityOpen.value = true;
	}

	/**
	 * "Point" mode's datum is a raw position snapshot, not a coil measurement — mirroring how
	 * duet-tool-align's own "Capture datum" works: jog the bare carriage to trigger your fixed
	 * reference (e.g. a homing switch that never touches a tool), then capture, no scan involved. This
	 * intentionally does NOT run the coil sweep — the whole point of a switch/reference that "doesn't
	 * interact with the tools" is that it gives a repeatable position independent of any nozzle, and
	 * every tool's coil-scanned position is already expressed in that same homed coordinate system, so
	 * no extra measurement is needed here, just a readout of where you currently are.
	 */
	function onCaptureDatum(): void {
		lastError.value = "";
		const x = axisPosition(host.model(), "X");
		const y = axisPosition(host.model(), "Y");
		if (x == null || y == null) {
			lastError.value = "X/Y position unavailable — home first";
			return;
		}
		cfg.datumPoint = { x, y, capturedAt: new Date().toISOString() };
	}

	function onClearDatum(): void {
		cfg.datumPoint = null;
	}

	// --- Offsets ---------------------------------------------------------------------------------

	const rows = computed(() => computeOffsetRows(tools.value, captures, datumCapture.value, cfg));

	/** Explicit +/− sign so the variation column's direction is unmissable at a glance, not just its
	 *  magnitude -- a real minus sign (not a hyphen) to match the leading plus visually. */
	function formatSigned(v: number, precision = 3): string {
		return (v < 0 ? "−" : "+") + Math.abs(v).toFixed(precision);
	}
	const anyApplicable = computed(() => rows.value.some((r) => r.g10));

	const confirmOpen = ref(false);
	const confirmBody = ref("");
	let confirmResolve: ((v: boolean) => void) | null = null;
	function confirmApply(cmds: Array<string>): Promise<boolean> {
		confirmBody.value = cmds.join("\n");
		confirmOpen.value = true;
		return new Promise<boolean>((resolve) => { confirmResolve = resolve; });
	}
	function resolveConfirm(v: boolean): void {
		confirmOpen.value = false;
		confirmResolve?.(v);
		confirmResolve = null;
	}

	async function onApplyAll(): Promise<void> {
		const cmds = rows.value.map((r) => r.g10).filter((c): c is string => !!c);
		if (!cmds.length) return;
		if (await confirmApply(cmds)) await io.sendCode(cmds.join("\n"));
	}
	async function onSave(): Promise<void> {
		if (!cfg.saveCommand) return;
		if (await confirmApply([cfg.saveCommand])) await io.sendCode(cfg.saveCommand);
	}

	return {
		cfg, io, tab, tools, toolOptions, currentTool, referenceModeItems, fitMethodItems,
		liveValue, liveActive, toggleLive,
		jog, setProbeXY, setProbeZ, onGoToProbe,
		prepareToolNumber, onLoadPrepareTool, onSetToolScanZ, onClearToolScanZ, prepareToolScanZ,
		captures, datumCapture, scanningTool, scanningAll, statusText, lastError,
		isBusy, stopOperation,
		onScanTool, onScanAll, onClearCapture, onClearAllCaptures,
		repeatabilityTool, repeatabilityOpen, repeatabilityResult, onCheckRepeatability,
		onCaptureDatum, onClearDatum,
		rows, formatSigned, anyApplicable,
		confirmOpen, confirmBody, resolveConfirm, onApplyAll, onSave,
	};
}

export type EddyAlign = ReturnType<typeof useEddyAlign>;
