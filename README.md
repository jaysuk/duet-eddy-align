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
centroid), and confidence scoring. Motion orchestration and the scan UI are not built yet — see
[docs/open-questions.md](docs/open-questions.md) for the integration question that needs answering
first (whether RRF exposes raw scanning-probe samples position-synced during an XY move).

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
