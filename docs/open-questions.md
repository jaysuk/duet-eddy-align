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

## Still open

- The physical scan parameters (Z clearance/standoff, sweep width, feed rate, expected `σ` of the
  Gaussian response) — these need a real SZP + nozzle to characterise, not something source-reading
  resolves. `src/model/eddyScan/quality.ts`'s `sigmaNominal` and `docs/math` background-separation
  guidance both assume this gets measured once on real hardware.
- Whether the background from the heater block/wiring (see the artifact's §4 reasoning, ported into
  `src/model/eddyScan/baseline.ts`) is small enough at typical scan heights to ignore initially, or
  needs wiring into the orchestrator from day one. Deferred until there's a real sweep to look at.

## Prior art

A Klipper `klippy/extras` plugin (github.com/chengxg/tool_eddy_calibration) does the LDC1612-coil
equivalent of this for Klipper: per-tool coil, multi-direction scan, parabolic sub-sample peak/valley
fit, paired-direction reconstruction. Same idea, different firmware — RRF just needs the sensor layer
Klipper builds in Python, since `M558 P11` already does that natively (see above).
