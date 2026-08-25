# Duet Eddy Align

Automated tool-offset alignment for RepRapFirmware toolchangers, using the fixed-mount **Scanning Z
Probe** (an inductive eddy-current coil) instead of a camera — a DWC 3.7 plugin.

Sibling project to [duet-tool-align](https://github.com/jaysuk/duet-tool-align) (the camera/OpenCV
equivalent): same goal, different sensor. A nozzle swept across the coil produces a localized
resonant-frequency response; fitting that response's sub-sample peak per tool gives the relative
`ΔX, ΔY` offsets for `G10`.

## Status

**v0.1.0 — scaffold.** The signal-processing core (`src/model/eddyScan/`) is complete and unit-tested:
baseline removal, Savitzky-Golay smoothing, 1D/2D sub-sample peak fitting (parabolic, Gaussian,
centroid), and confidence scoring. `src/model/orchestrator.ts` sequences a per-tool **cross scan**
(sweep X, sweep Y, Gaussian-fit each) behind injected `MachineIO`/`ReadProbe` seams — its exact
G-code and an end-to-end synthetic recovery are both unit tested — using **triggered step-and-sample**
(jog, `M400`, read one settled value) rather than a continuous synced sweep, since it's standalone-Duet
target means it can't assume a native/DSF sampling path. What `ReadProbe` actually calls on real
firmware is still open — see [docs/open-questions.md](docs/open-questions.md). Not built yet: the scan
UI, and baseline correction wired into the orchestrator (deferred until a real sweep's background
shape is characterised on hardware).

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
