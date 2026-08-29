/**
 * Which release ZIP each DWC generation's self-update checker should install. A release carries three
 * assets (`DuetEddyAlign-<version>.zip`, `DuetEddyAlign-<version>-dwc36.zip`, and a debug
 * `-srcmap.zip`) — see `core/host.ts`'s `assetPattern` doc comment for why picking the wrong one is a
 * real, previously-hit bug (duet-tool-align), not a theoretical one.
 */
export const ASSET_PATTERN_37 = /^DuetEddyAlign-[\d.]+\.zip$/i;
export const ASSET_PATTERN_36 = /^DuetEddyAlign-[\d.]+-dwc36\.zip$/i;
