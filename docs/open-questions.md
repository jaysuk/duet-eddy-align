# Open integration questions

## Resolved (2026-08-25): raw scanning-probe samples via the object model

Checked directly against `Duet3D/RepRapFirmware` source (`3.7-dev` branch). RRF **does** expose a
live, unfiltered raw reading for a Scanning Z Probe through the normal object model — no SBC/DSF
needed, works on a standalone Duet exactly as required.

- `sensors.probes[<K>].value[0]` is registered as a **live** object-model field:
  `src/Endstops/EndstopsManager.cpp` — `{ "probes", OBJECT_MODEL_FUNC_ARRAY(4), ObjectModelEntryFlags::live }`,
  mounted at the top-level `sensors` key in `src/Platform/RepRap.cpp` — `{ "sensors",
  OBJECT_MODEL_FUNC(&self->platform->GetEndstops()), ObjectModelEntryFlags::live }`. `<K>` is the
  probe number the scanning probe was configured with (`M558 K<n> P11 ...`, default 0).
- For a scanning probe (`ZProbeType::scanningAnalog`, i.e. `M558 P11`), that field is
  `ZProbe::GetRawReading()` with **no filtering** — `src/Endstops/ZProbe.cpp`'s `GetReading()` switch
  comments it explicitly: *"scanning analog probes are unfiltered for speed"*. That's exactly the raw
  signal the peak-fitting math (`src/model/eddyScan/`) expects.
- `M409 K"<path>"` returns `{"key":...,"flags":...,"result":<value>}\n` **synchronously** —
  `src/GCodes/GCodes2.cpp`'s `case 409`, backed by `RepRap::GetModelResponse` in
  `src/Platform/RepRap.cpp`. It's a fresh on-demand read at the moment it's sent, not whatever DWC's
  ambient object-model poll last cached — sending it right after a sweep point's `M400` is exactly the
  "one settled reading" `ReadProbe` needs.
- Array-index path syntax (`probes[0]`, `value[0]`) is real, general object-model query syntax —
  confirmed `[` is handled as a path token in `src/ObjectModel/ObjectModel.cpp`'s path parser, not
  something specific to this field.

Implemented as `makeProbeReader(io, probeIndex)` in `src/model/orchestrator.ts`, unit tested in
`src/__tests__/orchestrator.test.ts` (query path, result parsing, malformed-reply handling).

## Decided (2026-08-25): platform and sampling strategy

- **Platform:** standalone Duet (no SBC) is a hard requirement — no DSF/direct-I2C path, everything
  goes through RRF's normal object-model/gcode interface (which, per the above, is sufficient).
- **Sampling strategy:** triggered step-and-sample (jog to a point, `M400`, `M409`-query one settled
  value, repeat) rather than polling during continuous motion. This was a deliberate choice for
  simplicity/robustness, not something the object-model answer forced — a continuous synced sweep
  (polling `sensors.probes[n].value[0]` while a `G1` move is in flight, interpolating position against
  elapsed time) is a plausible future speed-up now that the raw field is confirmed live, but adds
  timing/interpolation error that step-and-sample avoids.

## Still open, now with real numbers (2026-08-25, from Duet3D/wiki-content)

Checked `User_manual/Tuning/scanning_z_probe_calibration.md` and the `M558`/`M558.1`/`M558.2` gcode
dictionary pages directly. Doesn't fully resolve the remaining items but replaces guesswork with
Duet3D's own published numbers:

- **The heater-block/wiring background is confirmed, not just plausible.** The official mounting
  guidance says outright: *"Make sure there is no metal in the 30mm ABOVE the coil, or it will pick
  this up and give false readings."* That's a hard, quantified confirmation of the artifact's §4
  reasoning behind `baseline.ts` — the background isn't a theoretical concern, Duet3D's own docs treat
  it as the primary mounting hazard. Use 30mm as the starting scale for `highpassDoG`'s `sigmaWide`
  (should be well inside that radius so it captures the background but not the tip) once there's a
  real sweep to tune it against.
- **Typical standoff, from the same guide:** coil sits 1-2mm above the nozzle tip; trigger height
  (`G31 Z`) is commonly set around 2mm, putting the coil ~4mm from the bed. A reasonable starting
  point for the scan-height default, not a substitute for calibrating it on real hardware.
- **`999999` (and presumably `-999999`) is a documented invalid-reading sentinel**, not just an
  observed one — "the aim is to get sensible readings (i.e. not 999999)" from drive-current
  calibration (`M558.2 S-1`). `orchestrator.ts`'s `makeProbeReader` now filters it out.
- **Typical drive current ~15 for a 12mm coil** (`M558.2 K<n> S15 R<offset>` in the example config) —
  a plausible default to suggest in setup UI, still something to actually calibrate per-unit via
  `M558.2 S-1` rather than hardcode.
- Still genuinely unresolved (no wiki page addresses it — RRF's built-in scanning workflow is Z-only
  mesh compensation, `G29`/`M558.1`, with no XY raster/cross-scan primitive): the expected `σ` /
  Gaussian-response shape and sweep width for lateral (XY) coil coupling, since that's not what the
  SZP is designed or documented for. `src/model/eddyScan/quality.ts`'s `sigmaNominal` still needs a
  real sweep to calibrate.

## Still open (2026-08-25): response polarity and DC magnitude on real hardware

Whether `sensors.probes[n].value[0]` rises (peak) or falls (valley) as a nozzle approaches the coil
*laterally* is unverified — RRF's `ZProbe::Stopped()` uses `reading >= threshold`, which hints at
rising-with-proximity, but that's a Z-probing convention (vertical approach), not proof for XY
coupling. The plugin works either way now — `quality.ts`'s `detectPeakType()` detects it per scan and
`peak1d.ts`'s `resolvePeakFit()` auto-switches to the weighted-quadratic fit on a detected valley — but
the actual answer, once observed on real hardware, is worth recording here: it settles whether
`gaussianLogFit` (peak-only) or `weightedQuadraticPeak` should be the *default* `fitMethod`, rather than
the common path silently relying on a fallback.

Same status for the DC magnitude of the raw reading (how large a constant offset `M558.2`'s `R`
calibration leaves in place) — `baseline.ts`'s `estimateDcBaseline()` handles it either way, but the
actual number determines how much headroom `gaussianLogFit`'s `minFraction` filter has to work with in
practice.

Both are things Jay's Setup-tab live reading and manual walk-across (see the bring-up guide) will
surface directly — nothing left to derive from documentation, just needs a real scan to observe.

## Prior art

Three Klipper/Kalico plugins do the LDC1612-coil equivalent of this problem. All three were reviewed
2026-08-25 and informed `src/model/eddyScan/peak1d.ts`'s `weightedQuadraticPeak`/`resolvePeakFit`,
`orchestrator.ts`'s bidirectional sweep, and `src/model/repeatability.ts`.

- **github.com/chengxg/tool_eddy_calibration** — the original: per-tool coil, multi-direction scan,
  Gaussian-weighted quadratic sub-sample peak/valley fit, paired-direction reconstruction, repeated
  measurements with mean ± population-stddev built into the core calibration flow. **Its weighted-
  quadratic Cramer's-rule determinant formula for the `b` coefficient has a real bug**, independently
  hand-verified here (not just cited from jaak0b's comments) by expanding both against a textbook
  cofactor expansion: `det`/`det_a`'s formulas are correct (they use a valid shortcut — expanding
  along the substituted column and reusing the original matrix's unchanged-column cofactors — verified
  term-by-term), but `det_b`'s formula doesn't match a correct column-1 expansion, and `det_c` is
  unverified so treat it as suspect too. **Consequence for this repo: no hand-rolled Cramer's-rule
  determinant is ported from either Python project below** — `weightedQuadraticPeak` goes through
  `linalg.ts`'s `solveLinear` (general Gauss-Jordan), the same primitive every other fit in this
  codebase already uses, specifically to avoid this bug class.
- **github.com/jaak0b/kalico-eddy-offset-calibration** — a more mature evolution of the above:
  documents and fixes the `det_b` bug (its own `determinant_3x3`/`replace_column` helpers do a real
  general expansion), adds `detectPeakType`/multi-angle `average_paired_projections` to cancel
  direction-dependent bias, `EDDY_REPEATABILITY` (mean ± stddev over N runs), and Z offset via a
  *separate* fixed contact switch rather than the coil — validates this repo's XY-only scope, same
  as `duet-tool-align`.
- **github.com/charliemayall/EddySeek** — a different architecture: iterative coarse-to-fine search
  (probe a 3×3 grid, move to the weighted centroid, halve the grid spacing, repeat) instead of a fixed
  scan window + curve fit, plus a continuous-motion `sweep_centroid` strategy correlating samples
  against Klipper's stepper position history. Not adopted here — RRF doesn't expose an equivalent
  motion-history API over the object model the way Klipper's internal step-compression does, which is
  a concrete reason continuous-sweep sampling is harder on RRF than on Klipper, not just a platform
  preference (see "Decided: platform and sampling strategy" above). `EDDY_SEEK_ACCURACY` is the same
  repeatability idea as jaak0b's `EDDY_REPEATABILITY`.

RRF just needs the sensor/orchestration layer these plugins build in Python, since `M558 P11` already
does the sensor/driver layer natively (see "Resolved" above) — no `duet-webcam-bridge`-style external
bridge needed, unlike the camera-based `duet-tool-align`.
