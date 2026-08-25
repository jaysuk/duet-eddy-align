<template>
  <v-tabs v-model="tab" density="compact">
    <v-tab value="setup">{{ $t("plugins.duetEddyAlign.tabs.setup") }}</v-tab>
    <v-tab value="scan">{{ $t("plugins.duetEddyAlign.tabs.scan") }}</v-tab>
  </v-tabs>

  <v-window v-model="tab">
    <v-window-item value="setup">
      <v-card-text>
        <v-card variant="outlined" class="mb-4 pa-3">
          <div class="d-flex align-center ga-3 flex-wrap">
            <div class="text-h5 font-weight-medium ea-live-value">{{ liveValue ?? "—" }}</div>
            <v-btn size="small" :color="liveActive ? 'error' : 'primary'" variant="tonal" @click="toggleLive">
              {{ liveActive ? $t("plugins.duetEddyAlign.live.stop") : $t("plugins.duetEddyAlign.live.start") }}
            </v-btn>
            <span class="text-caption text-medium-emphasis">{{ $t("plugins.duetEddyAlign.live.hint") }}</span>
          </div>
        </v-card>

        <div class="mb-4">
          <div class="text-subtitle-2 mb-1">{{ $t("plugins.duetEddyAlign.jog.label") }}</div>
          <div class="d-flex ga-2 flex-wrap">
            <v-btn size="small" @click="jog('X', -cfg.xyStep)">X−</v-btn>
            <v-btn size="small" @click="jog('X', cfg.xyStep)">X+</v-btn>
            <v-btn size="small" @click="jog('Y', -cfg.xyStep)">Y−</v-btn>
            <v-btn size="small" @click="jog('Y', cfg.xyStep)">Y+</v-btn>
            <v-btn size="small" @click="jog('Z', -cfg.zStep)">Z−</v-btn>
            <v-btn size="small" @click="jog('Z', cfg.zStep)">Z+</v-btn>
          </div>
        </div>

        <div class="mb-4">
          <div class="text-subtitle-2 mb-1">{{ $t("plugins.duetEddyAlign.setup.probePos") }}</div>
          <div class="text-body-2 mb-2">
            X: {{ cfg.probeX ?? "—" }}&nbsp; Y: {{ cfg.probeY ?? "—" }}&nbsp; Z (scan height): {{ cfg.probeZ ?? "—" }}
          </div>
          <div class="d-flex ga-2 flex-wrap">
            <v-btn size="small" variant="tonal" @click="setProbeXY">{{ $t("plugins.duetEddyAlign.setup.setProbeXY") }}</v-btn>
            <v-btn size="small" variant="tonal" @click="setProbeZ">{{ $t("plugins.duetEddyAlign.setup.setProbeZ") }}</v-btn>
            <v-btn size="small" variant="tonal" :disabled="cfg.probeX == null" @click="onGoToProbe">
              {{ $t("plugins.duetEddyAlign.setup.goToProbe") }}
            </v-btn>
          </div>
        </div>

        <v-divider class="mb-4" />

        <v-row dense>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.probeIndex" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.probeIndex')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.safeZ" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.safeZ')" />
          </v-col>
          <v-col cols="6" sm="4" class="d-flex align-center">
            <v-switch v-model="cfg.useG53" density="compact" hide-details :label="$t('plugins.duetEddyAlign.setup.useG53')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.travelFeed" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.travelFeed')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.jogFeed" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.jogFeed')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.settleMs" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.settleMs')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.scanHalfWidth" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.scanHalfWidth')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.scanStep" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.scanStep')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.xyStep" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.xyStep')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.zStep" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.zStep')" />
          </v-col>
        </v-row>
      </v-card-text>
    </v-window-item>

    <v-window-item value="scan">
      <v-card-text>
        <div v-if="statusText" class="text-body-2 mb-2">{{ statusText }}</div>
        <v-alert v-if="lastError" type="error" density="compact" class="mb-3" closable @click:close="lastError = ''">
          {{ lastError }}
        </v-alert>

        <v-row dense class="mb-2">
          <v-col cols="12" sm="4">
            <v-select v-model="cfg.referenceMode" density="compact" :items="referenceModeItems"
              :label="$t('plugins.duetEddyAlign.reference.mode')" />
          </v-col>
          <v-col v-if="cfg.referenceMode === 'tool'" cols="12" sm="4">
            <v-select v-model.number="cfg.referenceTool" density="compact" :items="toolOptions"
              :label="$t('plugins.duetEddyAlign.reference.tool')" />
          </v-col>
          <v-col v-else cols="12" sm="4" class="d-flex align-center ga-2">
            <v-btn size="small" variant="tonal" :loading="scanningTool === DATUM_SENTINEL" @click="onCaptureDatum">
              {{ $t("plugins.duetEddyAlign.reference.captureDatum") }}
            </v-btn>
            <span class="text-caption">
              {{ datumCapture ? `X${datumCapture.x.toFixed(3)} Y${datumCapture.y.toFixed(3)}` : $t("plugins.duetEddyAlign.reference.noDatum") }}
            </span>
          </v-col>
          <v-col cols="12" sm="4" class="d-flex align-center">
            <v-switch v-model="cfg.invertOffsets" density="compact" hide-details :label="$t('plugins.duetEddyAlign.reference.invert')" />
          </v-col>
        </v-row>

        <v-btn size="small" color="primary" variant="tonal" class="mb-3" :disabled="!tools.length"
          :loading="scanningAll" @click="onScanAll">
          {{ $t("plugins.duetEddyAlign.tools.scanAll") }}
        </v-btn>

        <v-table density="compact">
          <thead>
            <tr>
              <th>{{ $t("plugins.duetEddyAlign.tools.tool") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.current") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.captured") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.confidence") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.offset") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.number">
              <td>{{ row.name }}</td>
              <td>{{ row.curX != null ? `${row.curX.toFixed(2)}, ${row.curY?.toFixed(2)}` : "—" }}</td>
              <td>{{ row.capture ? `${row.capture.x.toFixed(3)}, ${row.capture.y.toFixed(3)}` : "—" }}</td>
              <td>{{ row.capture ? row.capture.confidence.toFixed(2) : "—" }}</td>
              <td>{{ row.g10 ?? "—" }}</td>
              <td>
                <v-btn size="x-small" variant="tonal" :loading="scanningTool === row.number" @click="onScanTool(row.number)">
                  {{ $t("plugins.duetEddyAlign.tools.scan") }}
                </v-btn>
              </td>
            </tr>
            <tr v-if="!tools.length">
              <td colspan="6" class="text-caption text-medium-emphasis">{{ $t("plugins.duetEddyAlign.tools.empty") }}</td>
            </tr>
          </tbody>
        </v-table>

        <div class="d-flex ga-2 mt-3">
          <v-btn size="small" variant="tonal" :disabled="!anyApplicable" @click="onApplyAll">
            {{ $t("plugins.duetEddyAlign.offsets.applyAll") }}
          </v-btn>
          <v-btn size="small" variant="tonal" :disabled="!cfg.saveCommand" @click="onSave">
            {{ $t("plugins.duetEddyAlign.offsets.save") }}
          </v-btn>
        </div>
      </v-card-text>
    </v-window-item>
  </v-window>

  <v-dialog v-model="confirmOpen" max-width="480" persistent>
    <v-card>
      <v-card-title>{{ $t("plugins.duetEddyAlign.offsets.confirmTitle") }}</v-card-title>
      <v-card-text>
        <div class="mb-2">{{ $t("plugins.duetEddyAlign.offsets.confirmBody") }}</div>
        <pre class="ea-confirm-body">{{ confirmBody }}</pre>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="resolveConfirm(false)">{{ $t("plugins.duetEddyAlign.offsets.confirmCancel") }}</v-btn>
        <v-btn color="primary" variant="flat" @click="resolveConfirm(true)">{{ $t("plugins.duetEddyAlign.offsets.confirmConfirm") }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";

import { useMachineStore } from "@/stores/machine";

import { useConfig } from "../model/config";
import { startPolling } from "../model/liveProbe";
import { axisPosition, toolList, useEddyMachineIO } from "../model/machineIO";
import { jogAxisCode, makeProbeReader } from "../model/orchestrator";
import { goToProbePosition, scanTool, type ScanCapture } from "../model/scanWorkflow";
import { computeToolOffset, formatG10, type ToolOffset } from "../util/toolAlign";

const DATUM_SENTINEL = -1;

const machineStore = useMachineStore();
const cfg = useConfig();
const io = useEddyMachineIO();

const tab = ref("setup");
const tools = computed(() => toolList(machineStore.model));
const toolOptions = computed(() => tools.value.map((t) => ({ title: t.name, value: t.number })));
const referenceModeItems = [
	{ title: "Reference tool", value: "tool" as const },
	{ title: "Fixed datum point", value: "point" as const },
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
	cfg.probeX = axisPosition(machineStore.model, "X");
	cfg.probeY = axisPosition(machineStore.model, "Y");
}
function setProbeZ(): void {
	cfg.probeZ = axisPosition(machineStore.model, "Z");
}
async function onGoToProbe(): Promise<void> {
	lastError.value = "";
	try {
		await goToProbePosition(io, cfg);
	} catch (err) {
		lastError.value = err instanceof Error ? err.message : String(err);
	}
}

// --- Scanning ------------------------------------------------------------------------------

const captures = reactive<Record<number, ScanCapture>>({});
const datumCapture = ref<ScanCapture | null>(null);
const scanningTool = ref<number | null>(null);
const scanningAll = ref(false);
const statusText = ref("");
const lastError = ref("");

async function runScan(toolNumber: number | null): Promise<ScanCapture | null> {
	const readProbe = makeProbeReader(io, cfg.probeIndex);
	const outcome = await scanTool(io, readProbe, cfg, toolNumber, { status: (m) => { statusText.value = m; } });
	statusText.value = "";
	if (!outcome.ok || !outcome.capture) {
		lastError.value = outcome.error ?? "Scan failed";
		return null;
	}
	return outcome.capture;
}

async function onScanTool(toolNumber: number): Promise<void> {
	lastError.value = "";
	scanningTool.value = toolNumber;
	const capture = await runScan(toolNumber);
	if (capture) captures[toolNumber] = capture;
	scanningTool.value = null;
}

async function onScanAll(): Promise<void> {
	scanningAll.value = true;
	for (const t of tools.value) {
		await onScanTool(t.number);
	}
	scanningAll.value = false;
}

async function onCaptureDatum(): Promise<void> {
	lastError.value = "";
	scanningTool.value = DATUM_SENTINEL;
	const capture = await runScan(null);
	if (capture) datumCapture.value = capture;
	scanningTool.value = null;
}

// --- Offsets ---------------------------------------------------------------------------------

function referenceCapture(): ScanCapture | null {
	return cfg.referenceMode === "point" ? datumCapture.value : (captures[cfg.referenceTool] ?? null);
}

/** The offset the reference itself carries forward: its own existing G10 in "tool" mode (so the
 *  reference tool keeps its offset unchanged), or zero in "point" mode (a fixed carriage datum has
 *  no G10 offset of its own — every tool including the one used to capture it is offset from it). */
function baseRefOffset(): ToolOffset {
	if (cfg.referenceMode === "point") return { x: 0, y: 0 };
	const refTool = tools.value.find((t) => t.number === cfg.referenceTool);
	return { x: refTool?.curX ?? 0, y: refTool?.curY ?? 0 };
}

const rows = computed(() => {
	const ref = referenceCapture();
	const refOffset = baseRefOffset();
	return tools.value.map((t) => {
		const capture = captures[t.number] ?? null;
		const offset = capture && ref
			? computeToolOffset({ x: ref.x, y: ref.y }, { x: capture.x, y: capture.y }, refOffset, cfg.invertOffsets)
			: null;
		return {
			number: t.number,
			name: t.name,
			curX: t.curX,
			curY: t.curY,
			capture,
			g10: offset ? formatG10(t.number, offset) : null,
		};
	});
});

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
</script>

<style scoped>
.ea-live-value { min-width: 8ch; font-variant-numeric: tabular-nums; }
.ea-confirm-body { white-space: pre-wrap; font-family: monospace; }
</style>
