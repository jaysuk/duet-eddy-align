# Open integration questions

## Decided (2026-08-25)

- **Platform:** standalone Duet (no SBC) is a hard requirement — no DSF/direct-I2C path, everything
  has to go through RRF's normal object-model/gcode interface.
- **Sampling strategy:** default to **triggered step-and-sample** (jog to a point, `M400`, read one
  settled value, repeat) rather than polling during continuous motion. Slower per point, but doesn't
  depend on resolving position-synced streaming first — see `src/model/orchestrator.ts`. A continuous
  synced sweep stays a possible future speed-up, not a blocker.
- **Still unresolved:** whether raw SZP samples are exposed on the object model at all outside of
  `M400`-settled reads (needed either way, since `ReadProbe` in `orchestrator.ts` needs a concrete
  implementation) — this is the one item below that still needs checking against real firmware/docs.

## Raw scanning-probe samples during an XY sweep

RRF's Scanning Z Probe (`M558 P11`) reads an LDC1612 coil natively, so the sensor/driver layer this
plugin needs already exists in firmware — unlike a camera-based approach, there's no equivalent of
`duet-webcam-bridge` to build.

**Unverified:** whether RRF exposes raw frequency samples fast enough, and position-synced enough, to
sweep the probe across the coil in XY and reconstruct a profile from it. Its built-in use
(`G29`/mesh compensation) is a Z-height sampler, not an XY raster/cross scanner.

Before committing to a continuous-sweep orchestration design, check:
- the current G-code dictionary (`Duet3D/wiki-content`, `User_manual/Reference/Gcodes.md`) for
  `M558`/`G31` scanning-probe fields exposed on the object model
- the Duet3D forum for prior art reading raw SZP samples during motion
- whether `M558.x`-family commands (calibration/diagnostic variants) expose a raw sample stream

If continuous position-synced sampling isn't available, the fallback is triggered single-point reads
at controlled jog positions instead of a continuous sweep — that only changes the sampling/orchestration
layer (`src/model/orchestrator.ts`, not yet written), not the fitting math in `src/model/eddyScan/`.

## Prior art

A Klipper `klippy/extras` plugin (github.com/chengxg/tool_eddy_calibration) does the LDC1612-coil
equivalent of this for Klipper: per-tool coil, multi-direction scan, parabolic sub-sample peak/valley
fit, paired-direction reconstruction. Same idea, different firmware — RRF just needs the sensor layer
Klipper builds in Python, since `M558 P11` already does that natively (see above).
