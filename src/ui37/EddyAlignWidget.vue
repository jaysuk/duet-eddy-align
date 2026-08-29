<template>
  <!-- Update notice (also surfaced in Flexible Layouts' unified popup via the shared hub) -->
  <v-alert v-if="pendingReload" type="success" density="compact" variant="tonal" class="ma-1">
    {{ $t("plugins.duetEddyAlign.updates.reloadPrompt") }}
    <template #append>
      <v-btn size="small" variant="tonal" @click="reloadPage">{{ $t("plugins.duetEddyAlign.updates.reload") }}</v-btn>
    </template>
  </v-alert>
  <v-alert v-else-if="updateBannerVisible" type="info" density="compact" variant="tonal" class="ma-1">
    {{ $t("plugins.duetEddyAlign.updates.available", { version: updateState!.latestVersion }) }}
    <template #append>
      <div class="d-flex align-center ga-1 flex-wrap">
        <v-btn v-if="updateState!.scenario === 'pluginUpdate'" size="small" color="primary" variant="flat" :loading="applying" @click="applyUpdateNow">
          {{ $t("plugins.duetEddyAlign.updates.updateNow") }}
        </v-btn>
        <span v-else class="text-caption">{{ $t("plugins.duetEddyAlign.updates.needsDwc", { dwc: updateState!.requiredDwc, running: updateState!.runningDwc }) }}</span>
        <v-btn size="small" variant="text" :href="updateState!.releaseUrl || undefined" target="_blank" rel="noopener">{{ $t("plugins.duetEddyAlign.updates.notes") }}</v-btn>
        <v-btn size="small" variant="text" @click="dismissCurrentUpdate">{{ $t("plugins.duetEddyAlign.updates.dismiss") }}</v-btn>
      </div>
    </template>
  </v-alert>

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
import { useEddyAlign } from "../core/useEddyAlign";
import { applying, applyUpdateNow, dismissCurrentUpdate, dismissedVersion, pendingReload, updateState } from "../updateCheck";
import { computed } from "vue";
import { createHost } from "./host";

const {
	cfg, tab, tools, toolOptions, currentTool, referenceModeItems, fitMethodItems,
	liveValue, liveActive, toggleLive,
	jog, setProbeXY, setProbeZ, onGoToProbe,
	prepareToolNumber, onLoadPrepareTool, onSetToolScanZ, onClearToolScanZ, prepareToolScanZ,
	captures, scanningTool, scanningAll, statusText, lastError,
	isBusy, stopOperation,
	onScanTool, onScanAll, onClearCapture, onClearAllCaptures,
	repeatabilityTool, repeatabilityOpen, repeatabilityResult, onCheckRepeatability,
	onCaptureDatum, onClearDatum,
	rows, formatSigned, anyApplicable,
	confirmOpen, confirmBody, resolveConfirm, onApplyAll, onSave,
} = useEddyAlign(createHost());

// --- Update notification (announced into the shared hub; banner is the in-context surface) ---
// Whether checks happen at all is toggled from the About dialog (the ⓘ button) or Flexible Layouts'
// unified update hub when embedded there -- not duplicated here.
const updateBannerVisible = computed(() =>
	!!updateState.value?.updateAvailable && updateState.value.latestVersion !== dismissedVersion.value);
function reloadPage(): void {
	window.location.reload();
}
</script>

<style scoped>
.ea-live-value { min-width: 8ch; font-variant-numeric: tabular-nums; }
.ea-confirm-body { white-space: pre-wrap; font-family: monospace; }
.ea-current-tool-row { background: rgba(var(--v-theme-primary), 0.08); }
</style>
