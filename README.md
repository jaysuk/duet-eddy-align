# Duet Eddy Align

Automated tool-offset alignment for RepRapFirmware toolchangers, using the fixed-mount **Scanning Z
Probe** (an inductive eddy-current coil) instead of a camera — a DWC 3.7 plugin.

Sibling project to [duet-tool-align](https://github.com/jaysuk/duet-tool-align) (the camera/OpenCV
equivalent): same goal, different sensor. A nozzle swept across the coil produces a localized
resonant-frequency response; fitting that response's sub-sample peak per tool gives the relative
`ΔX, ΔY` offsets for `G10`.

## Status

**v0.2.0 — first real UI, ready to test on hardware.** The signal-processing core
(`src/model/eddyScan/`) and `src/model/orchestrator.ts`'s cross-scan sequencing are complete and unit
tested, `makeProbeReader()` is verified directly against RepRapFirmware source (see
[docs/open-questions.md](docs/open-questions.md)), and `src/widgets/EddyAlignWidget.vue` now gives a
working control panel:

- **Setup tab** — a live, polling raw-probe-reading display (the fastest way to confirm the sensor +
  `M409` query work on your hardware before trusting anything automated), manual X/Y/Z jog, saved
  probe position (set from current machine position, or jog back to it), and all the scan/motion
  settings (probe `K` index, feeds, settle time, scan window, safe-Z travel).
- **Scan & Offsets tab** — per-tool or scan-all, a results table (captured position, confidence,
  computed `G10`), and Apply/Save with the same show-the-exact-command confirm dialog
  `duet-tool-align` uses. `computeToolOffset`/`formatG10` (`src/util/toolAlign.ts`) are ported
  verbatim from there, same sign convention. Two reference modes, matching two real E3D
  Tool Changer setups: **"tool"** mode measures every tool against a chosen reference tool (e.g. T0);
  **"point"** mode measures every tool against a fixed carriage datum instead — captured as a raw
  position snapshot (jog the bare carriage to trigger a fixed reference like a homing switch that
  never touches a tool, then Capture), not a coil measurement, mirroring exactly how
  duet-tool-align's own "Capture datum" works.

Not built yet / still open: baseline correction isn't wired into the scan workflow (deferred until a
real sweep's background shape is characterised — the 30mm metal-proximity warning in
[docs/open-questions.md](docs/open-questions.md) says it'll matter), and the expected scan `σ`/window
size are defaults, not calibrated. No self-update or embeddable-widget wiring yet either.

## Math

| Module | Covers |
| --- | --- |
| `linalg.ts` | Gauss-Jordan solve + closed-form 3x3 inverse — the only linear algebra dependency anywhere in this plugin |
| `smoothing.ts` | Median despiking, Gaussian smoothing, Savitzky-Golay (coefficients derived, not hardcoded) |
| `baseline.ts` | Asymmetric IRLS polynomial baseline, difference-of-Gaussians high-pass |
| `peak1d.ts` | 3-point parabolic, least-squares parabolic (+ standard error via the delta method), Gaussian log-fit, optional Gauss-Newton refinement, thresholded centroid |
| `peak2d.ts` | 2D paraboloid and axis-aligned 2D Gaussian fits for a raster scan |
| `quality.ts` | Robust noise estimate, incomplete-sweep detection, combined confidence score |

Every function above is pure (no Vue/DOM/DWC dependency) and covered by `src/__tests__/*.test.ts`
against synthetic, closed-form-known signals — no mocking needed.

## Setup

Scaffolded per [dwc-plugin-template](https://github.com/jaysuk/dwc-plugin-template)'s conventions —
same `plugin.json`/`package.json`/CI shape as the other plugins in this family
(`dwc-plugin-runtime`, `dwc-plugin-test-kit`, tests via `dwc-plugin-test-kit/vitest`).

```bash
npm install
npm test                                   # pure-logic + component tests, no DWC checkout needed
DWC_DIR=/path/to/DuetWebControl npm run typecheck
DWC_DIR=/path/to/DuetWebControl npm run verify-build
```

## License

GPL-3.0-or-later
