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

        <div class="text-subtitle-1 font-weight-medium mb-1">{{ $t("plugins.duetEddyAlign.setup.groupProbePosition") }}</div>
        <div class="text-body-2 mb-2">
          X: {{ cfg.probeX ?? "—" }}&nbsp; Y: {{ cfg.probeY ?? "—" }}&nbsp; Z (scan height): {{ cfg.probeZ ?? "—" }}
        </div>
        <div class="d-flex ga-2 flex-wrap mb-3">
          <v-btn size="small" variant="tonal" @click="setProbeXY">{{ $t("plugins.duetEddyAlign.setup.setProbeXY") }}</v-btn>
          <v-btn size="small" variant="tonal" @click="setProbeZ">{{ $t("plugins.duetEddyAlign.setup.setProbeZ") }}</v-btn>
          <v-btn size="small" variant="tonal" :disabled="cfg.probeX == null" @click="onGoToProbe">
            {{ $t("plugins.duetEddyAlign.setup.goToProbe") }}
          </v-btn>
        </div>
        <v-row dense class="mb-3">
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.safeZ" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.safeZ')" />
          </v-col>
          <v-col cols="6" sm="4" class="d-flex align-center">
            <v-switch v-model="cfg.useG53" density="compact" hide-details :label="$t('plugins.duetEddyAlign.setup.useG53')" />
          </v-col>
        </v-row>

        <v-divider class="mb-4" />

        <div class="text-subtitle-1 font-weight-medium mb-1">{{ $t("plugins.duetEddyAlign.setup.groupMotion") }}</div>
        <div class="d-flex ga-2 flex-wrap mb-3">
          <v-btn size="small" @click="jog('X', -cfg.xyStep)">X−</v-btn>
          <v-btn size="small" @click="jog('X', cfg.xyStep)">X+</v-btn>
          <v-btn size="small" @click="jog('Y', -cfg.xyStep)">Y−</v-btn>
          <v-btn size="small" @click="jog('Y', cfg.xyStep)">Y+</v-btn>
          <v-btn size="small" @click="jog('Z', -cfg.zStep)">Z−</v-btn>
          <v-btn size="small" @click="jog('Z', cfg.zStep)">Z+</v-btn>
        </div>
        <v-row dense class="mb-3">
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.xyStep" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.xyStep')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.zStep" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.zStep')" />
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
        </v-row>

        <v-divider class="mb-4" />

        <div class="text-subtitle-1 font-weight-medium mb-1">{{ $t("plugins.duetEddyAlign.setup.groupScanWindow") }}</div>
        <v-row dense class="mb-3">
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.scanHalfWidth" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.scanHalfWidth')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.scanStep" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.scanStep')" />
          </v-col>
        </v-row>

        <v-divider class="mb-4" />

        <div class="text-subtitle-1 font-weight-medium mb-1">{{ $t("plugins.duetEddyAlign.setup.groupFit") }}</div>
        <v-row dense class="mb-1">
          <v-col cols="6" sm="4">
            <v-select v-model="cfg.fitMethod" density="compact" :items="fitMethodItems"
              :label="$t('plugins.duetEddyAlign.setup.fitMethod')" />
          </v-col>
          <v-col v-if="cfg.fitMethod === 'weightedQuadratic'" cols="6" sm="4">
            <v-text-field v-model.number="cfg.weightedQuadraticSigma" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.weightedQuadraticSigma')" />
          </v-col>
          <v-col cols="12" sm="8" class="d-flex align-center">
            <v-switch v-model="cfg.bidirectionalScan" density="compact" hide-details
              :label="$t('plugins.duetEddyAlign.setup.bidirectionalScan')" />
          </v-col>
        </v-row>
        <div class="text-caption text-medium-emphasis mb-2">{{ $t("plugins.duetEddyAlign.setup.fitMethodHint") }}</div>
        <div v-if="cfg.bidirectionalScan" class="text-caption text-medium-emphasis mb-3">
          {{ $t("plugins.duetEddyAlign.setup.bidirectionalHint") }}
        </div>

        <v-divider class="mb-4" />

        <div class="text-subtitle-1 font-weight-medium mb-1">{{ $t("plugins.duetEddyAlign.setup.groupRefinement") }}</div>
        <v-row dense class="mb-1">
          <v-col cols="12" sm="8" class="d-flex align-center">
            <v-switch v-model="cfg.refineScan" density="compact" hide-details
              :label="$t('plugins.duetEddyAlign.setup.refineScan')" />
          </v-col>
          <v-col v-if="cfg.refineScan" cols="6" sm="4">
            <v-text-field v-model.number="cfg.refineMaxPasses" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.refineMaxPasses')" />
          </v-col>
          <v-col v-if="cfg.refineScan" cols="6" sm="4">
            <v-text-field v-model.number="cfg.refineShrink" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.refineShrink')" />
          </v-col>
          <v-col v-if="cfg.refineScan" cols="6" sm="4">
            <v-text-field v-model.number="cfg.refineTolerance" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.refineTolerance')" />
          </v-col>
        </v-row>
        <div class="text-caption text-medium-emphasis mb-2">{{ $t("plugins.duetEddyAlign.setup.refineHint") }}</div>

        <v-divider class="mb-4" />

        <div class="text-subtitle-1 font-weight-medium mb-1">{{ $t("plugins.duetEddyAlign.setup.groupAdvanced") }}</div>
        <v-row dense>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.probeIndex" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.probeIndex')" />
          </v-col>
          <v-col cols="6" sm="4">
            <v-text-field v-model.number="cfg.repeatabilityRuns" type="number" density="compact"
              :label="$t('plugins.duetEddyAlign.setup.repeatabilityRuns')"
              :hint="$t('plugins.duetEddyAlign.setup.repeatabilityRunsHint')" persistent-hint />
          </v-col>
        </v-row>
      </v-card-text>
    </v-window-item>

    <v-window-item value="scan">
      <v-card-text>
        <div v-if="statusText || isBusy" class="d-flex align-center ga-2 mb-2">
          <div v-if="statusText" class="text-body-2">{{ statusText }}</div>
          <v-btn v-if="isBusy" size="small" variant="tonal" color="error" @click="stopOperation">
            {{ $t("plugins.duetEddyAlign.tools.stop") }}
          </v-btn>
        </div>
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
          <v-col v-else cols="12" sm="4" class="d-flex align-center flex-wrap ga-2">
            <v-btn size="small" variant="tonal" @click="onCaptureDatum">
              {{ $t("plugins.duetEddyAlign.reference.captureDatum") }}
            </v-btn>
            <span v-if="cfg.datumPoint" class="text-caption">
              X{{ cfg.datumPoint.x.toFixed(3) }} Y{{ cfg.datumPoint.y.toFixed(3) }}
              — {{ $t("plugins.duetEddyAlign.reference.datumCapturedAt", { date: new Date(cfg.datumPoint.capturedAt).toLocaleString() }) }}
            </span>
            <span v-else class="text-caption">{{ $t("plugins.duetEddyAlign.reference.noDatum") }}</span>
            <v-btn v-if="cfg.datumPoint" size="small" variant="text" @click="onClearDatum">
              {{ $t("plugins.duetEddyAlign.reference.clearDatum") }}
            </v-btn>
          </v-col>
          <v-col cols="12" sm="4" class="d-flex align-center">
            <v-switch v-model="cfg.invertOffsets" density="compact" hide-details :label="$t('plugins.duetEddyAlign.reference.invert')" />
          </v-col>
          <v-col v-if="cfg.referenceMode === 'tool'" cols="12" sm="8" class="d-flex align-center">
            <v-switch v-model="cfg.zeroReferenceOffset" density="compact" hide-details
              :label="$t('plugins.duetEddyAlign.reference.zeroReference')" />
          </v-col>
        </v-row>
        <div v-if="cfg.referenceMode === 'point'" class="text-caption text-medium-emphasis mb-2">
          {{ $t("plugins.duetEddyAlign.reference.captureDatumHint") }}
        </div>
        <div v-else-if="cfg.zeroReferenceOffset" class="text-caption text-medium-emphasis mb-2">
          {{ $t("plugins.duetEddyAlign.reference.zeroReferenceHint") }}
        </div>

        <v-card variant="outlined" class="mb-4 pa-3">
          <div class="d-flex align-center justify-space-between mb-2">
            <div class="text-subtitle-2">{{ $t("plugins.duetEddyAlign.prepare.title") }}</div>
            <div class="text-caption text-medium-emphasis">
              {{ currentTool != null
                ? $t("plugins.duetEddyAlign.prepare.currentTool", { tool: tools.find((t) => t.number === currentTool)?.name ?? `T${currentTool}` })
                : $t("plugins.duetEddyAlign.prepare.noCurrentTool") }}
            </div>
          </div>
          <div class="d-flex align-center ga-2 flex-wrap">
            <v-select v-model.number="prepareToolNumber" density="compact" hide-details style="max-width: 160px"
              :items="toolOptions" :label="$t('plugins.duetEddyAlign.tools.tool')" />
            <v-btn size="small" variant="tonal" :disabled="prepareToolNumber == null" @click="onLoadPrepareTool">
              {{ $t("plugins.duetEddyAlign.prepare.load") }}
            </v-btn>
            <v-btn size="small" @click="jog('Z', -cfg.zStep)">Z−</v-btn>
            <v-btn size="small" @click="jog('Z', cfg.zStep)">Z+</v-btn>
            <div class="text-body-2 ea-live-value">{{ liveValue ?? "—" }}</div>
            <v-btn size="small" :color="liveActive ? 'error' : 'primary'" variant="tonal" @click="toggleLive">
              {{ liveActive ? $t("plugins.duetEddyAlign.live.stop") : $t("plugins.duetEddyAlign.live.start") }}
            </v-btn>
          </div>
          <div class="d-flex align-center ga-2 flex-wrap mt-2">
            <v-btn size="small" variant="tonal" :disabled="prepareToolNumber == null" @click="onSetToolScanZ">
              {{ $t("plugins.duetEddyAlign.prepare.setScanZ") }}
            </v-btn>
            <v-btn v-if="prepareToolScanZ?.isOverride" size="small" variant="text" @click="onClearToolScanZ">
              {{ $t("plugins.duetEddyAlign.prepare.clearScanZ") }}
            </v-btn>
            <span v-if="prepareToolScanZ" class="text-caption text-medium-emphasis">
              {{ prepareToolScanZ.value != null
                ? $t(prepareToolScanZ.isOverride ? "plugins.duetEddyAlign.prepare.willScanAtOverride" : "plugins.duetEddyAlign.prepare.willScanAtDefault", { z: prepareToolScanZ.value.toFixed(3) })
                : $t("plugins.duetEddyAlign.prepare.noScanZ") }}
            </span>
          </div>
        </v-card>

        <div class="d-flex ga-2 mb-3">
          <v-btn size="small" color="primary" variant="tonal" :disabled="!tools.length"
            :loading="scanningAll" @click="onScanAll">
            {{ $t("plugins.duetEddyAlign.tools.scanAll") }}
          </v-btn>
          <v-btn size="small" variant="text" :disabled="!Object.keys(captures).length" @click="onClearAllCaptures">
            {{ $t("plugins.duetEddyAlign.tools.clearAll") }}
          </v-btn>
        </div>

        <v-table density="compact">
          <thead>
            <tr>
              <th>{{ $t("plugins.duetEddyAlign.tools.tool") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.current") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.captured") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.confidence") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.offset") }}</th>
              <th>{{ $t("plugins.duetEddyAlign.tools.variation") }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.number" :class="{ 'ea-current-tool-row': row.number === currentTool }">
              <td>{{ row.name }}</td>
              <td>{{ row.curX != null ? `${row.curX.toFixed(2)}, ${row.curY?.toFixed(2)}` : "—" }}</td>
              <td>
                {{ row.capture ? `${row.capture.x.toFixed(3)}, ${row.capture.y.toFixed(3)}` : "—" }}
                <div v-if="row.capture?.directionalSpread" class="text-caption text-medium-emphasis">
                  {{ $t("plugins.duetEddyAlign.tools.directionalSpread", {
                    x: row.capture.directionalSpread.x.toFixed(3), y: row.capture.directionalSpread.y.toFixed(3),
                  }) }}
                </div>
              </td>
              <td>
                {{ row.capture ? row.capture.confidence.toFixed(2) : "—" }}
                <div v-if="row.capture?.methodUsed && row.capture.methodUsed !== cfg.fitMethod" class="text-caption text-medium-emphasis">
                  {{ $t("plugins.duetEddyAlign.tools.methodSwitched", { type: row.capture.peakType, method: row.capture.methodUsed }) }}
                </div>
              </td>
              <td>{{ row.g10 ?? "—" }}</td>
              <td>
                <span v-if="row.deltaFromCurrent">{{ formatSigned(row.deltaFromCurrent.x) }}, {{ formatSigned(row.deltaFromCurrent.y) }}</span>
                <span v-else>—</span>
              </td>
              <td>
                <v-btn size="x-small" variant="tonal" :loading="scanningTool === row.number" @click="onScanTool(row.number)">
                  {{ $t("plugins.duetEddyAlign.tools.scan") }}
                </v-btn>
                <v-btn size="x-small" variant="text" class="ml-1" :loading="repeatabilityTool === row.number"
                  @click="onCheckRepeatability(row.number)">
                  {{ $t("plugins.duetEddyAlign.tools.repeatability") }}
                </v-btn>
                <v-btn v-if="row.capture" size="x-small" variant="text" class="ml-1" @click="onClearCapture(row.number)">
                  {{ $t("plugins.duetEddyAlign.tools.clear") }}
                </v-btn>
              </td>
            </tr>
            <tr v-if="!tools.length">
              <td colspan="7" class="text-caption text-medium-emphasis">{{ $t("plugins.duetEddyAlign.tools.empty") }}</td>
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

  <v-dialog v-model="repeatabilityOpen" max-width="480">
    <v-card>
      <v-card-title>{{ $t("plugins.duetEddyAlign.repeatability.title") }}</v-card-title>
      <v-card-text v-if="repeatabilityResult">
        <p class="mb-2">
          {{ $t("plugins.duetEddyAlign.repeatability.summary", {
            succeeded: repeatabilityResult.succeeded, runs: repeatabilityResult.runs,
          }) }}
        </p>
        <div v-if="repeatabilityResult.meanX != null && repeatabilityResult.meanY != null" class="text-body-2 mb-3">
          X: {{ repeatabilityResult.meanX.toFixed(3) }}
          ± {{ repeatabilityResult.stdX != null ? repeatabilityResult.stdX.toFixed(3) : "—" }}
          {{ $t("plugins.duetEddyAlign.repeatability.stdLabel") }}<br>
          Y: {{ repeatabilityResult.meanY.toFixed(3) }}
          ± {{ repeatabilityResult.stdY != null ? repeatabilityResult.stdY.toFixed(3) : "—" }}
          {{ $t("plugins.duetEddyAlign.repeatability.stdLabel") }}
        </div>
        <v-table density="compact">
          <thead><tr><th>#</th><th>X</th><th>Y</th></tr></thead>
          <tbody>
            <tr v-for="(c, i) in repeatabilityResult.captures" :key="i">
              <td>{{ i + 1 }}</td>
              <td>{{ c.x.toFixed(3) }}</td>
              <td>{{ c.y.toFixed(3) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="repeatabilityOpen = false">{{ $t("plugins.duetEddyAlign.repeatability.close") }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from "vue";

import { useMachineStore } from "@/stores/machine";

import { useConfig } from "../model/config";
import { startPolling } from "../model/liveProbe";
import { axisPosition, currentToolNumber, toolList, useEddyMachineIO } from "../model/machineIO";
import { computeOffsetRows } from "../model/offsets";
import { jogAxisCode, makeProbeReader } from "../model/orchestrator";
import { type RepeatabilityResult, runRepeatabilityCheck } from "../model/repeatability";
import { goToProbePosition, scanTool, type ScanCapture } from "../model/scanWorkflow";

const machineStore = useMachineStore();
const cfg = useConfig();
const io = useEddyMachineIO();

const tab = ref("setup");
const tools = computed(() => toolList(machineStore.model));
const toolOptions = computed(() => tools.value.map((t) => ({ title: t.name, value: t.number })));
const currentTool = computed(() => currentToolNumber(machineStore.model));
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
	const z = axisPosition(machineStore.model, "Z");
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

const captures = reactive<Record<number, ScanCapture>>({});
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
	const x = axisPosition(machineStore.model, "X");
	const y = axisPosition(machineStore.model, "Y");
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
</script>

<style scoped>
.ea-live-value { min-width: 8ch; font-variant-numeric: tabular-nums; }
.ea-confirm-body { white-space: pre-wrap; font-family: monospace; }
.ea-current-tool-row { background: rgba(var(--v-theme-primary), 0.08); }
</style>
