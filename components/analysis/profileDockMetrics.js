// Shared dock metrics so ProfileDock (shell) and ProfilePanel (contents)
// agree on height without importing each other. Heights are constants on
// purpose: measuring the DOM on every analysis update resized the map
// canvas and looked like a full-page refresh.

export const PROFILE_DOCK_HEIGHT_VAR = "--vantage-profile-dock-height";
export const PROFILE_DOCK_PROMPT_PX = 44;
export const PROFILE_DOCK_HEADER_PX = 56;
export const PROFILE_DOCK_CHART_PX = 236;
export const PROFILE_DOCK_OPEN_PX = PROFILE_DOCK_HEADER_PX + PROFILE_DOCK_CHART_PX;

export function dockHeightPx(analysis) {
  if (!analysis) return 0;
  if (analysis.observer && analysis.profile) return PROFILE_DOCK_OPEN_PX;
  if (analysis.loading || analysis.fetchError) return PROFILE_DOCK_OPEN_PX;
  return PROFILE_DOCK_PROMPT_PX;
}
