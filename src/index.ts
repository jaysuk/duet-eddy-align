/**
 * Duet Eddy Align — entry point.
 *
 * DWC picks this up regardless of generation; the real entry point lives per-UI-shell.
 * `scripts/stage-dwc36.mjs` generates a 3.6-specific replacement of this file pointing at
 * `./ui36/index` inside its staged tree — this one is only ever built for 3.7.
 */
export * from "./ui37/index";
