import PropTypes from "prop-types";
import { Drawer, Tabs, Tab, Box, IconButton } from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import LayerTree from "@/components/LayerTree";
import ProfilePanel from "@/components/analysis/ProfilePanel";

const DRAWER_WIDTH = 340;

// The Explore / Inspect / Features tab set is Overture Explorer's own
// layer-editor UI — VANTAGE only uses the Features tab (ProfilePanel).
// Off by default; flip to true if a future debugging need brings back
// the raw layer-tree editor. Same pattern the compare-slider disable
// (components/MapView.jsx) uses, for the same reason: keep the code
// intact so it's cheap to bring back.
export const ENABLE_LAYER_TABS = false;

export default function SidePanel({
  mode,
  drawerOpen,
  setDrawerOpen,
  activeTab,
  setActiveTab,
  visibleTypes,
  setVisibleTypes,
  defaultVisibleTypes,
  inspectVisibleTypes,
  setInspectVisibleTypes,
  defaultInspectVisibleTypes,
  zoom,
  features,
  setFeatures,
  activeFeature,
  setActiveFeature,
}) {
  const isDark = mode === "theme-dark";

  return (
    <>
      {/* Toggle button — visible when drawer is closed */}
      {!drawerOpen && (
        <IconButton
          aria-label="Open details panel"
          onClick={() => setDrawerOpen(true)}
          sx={{
            position: "fixed",
            left: 8,
            top: 68,
            zIndex: 1200,
            bgcolor: isDark ? "#121212" : "white",
            color: isDark ? "white" : "#333",
            boxShadow: 2,
            "&:hover": {
              bgcolor: isDark ? "#333" : "#eee",
            },
            width: 36,
            height: 36,
          }}
        >
          <LayersIcon />
        </IconButton>
      )}

      <Drawer
        variant="persistent"
        anchor="left"
        open={drawerOpen}
        sx={{
          zIndex: 1000,
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            top: "60px !important",
            height: "calc(100vh - 60px)",
            zIndex: 1000,
            bgcolor: isDark ? "#121212" : "#fff",
            color: isDark ? "#fff" : "#000",
            borderRight: isDark
              ? "1px solid rgba(255,255,255,0.12)"
              : "1px solid rgba(0,0,0,0.12)",
          },
        }}
      >
        {/* Header with close button */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            px: 1,
            minHeight: 40,
          }}
        >
          <IconButton
            aria-label="Close details panel"
            onClick={() => setDrawerOpen(false)}
            sx={{ color: isDark ? "white" : "#333" }}
          >
            <ChevronLeftIcon />
          </IconButton>
        </Box>

        {ENABLE_LAYER_TABS && (
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            variant="fullWidth"
            sx={{
              minHeight: 36,
              borderBottom: 1,
              borderColor: "divider",
              "& .MuiTabs-indicator": {
                backgroundColor: isDark ? "#fff" : "#000",
              },
              "& .MuiTab-root": {
                minHeight: 36,
                textTransform: "none",
                fontFamily: "Montserrat, sans-serif",
                fontSize: 13,
                fontWeight: 500,
                color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)",
                "&.Mui-selected": {
                  color: isDark ? "#fff" : "#000",
                },
              },
            }}
          >
            <Tab label="Explore" value="layers" />
            <Tab label="Inspect" value="inspect" />
            <Tab label="Features" value="features" />
          </Tabs>
        )}

        {/* Tab content. ProfilePanel's default product path is the bottom
            ProfileDock (see MapView); this drawer only hosts it when the
            layer-editor tabs are back on. */}
        <Box sx={{ overflow: "auto", flex: 1 }}>
          {ENABLE_LAYER_TABS && activeTab === "layers" && (
            <LayerTree
              visibleTypes={visibleTypes}
              setVisibleTypes={setVisibleTypes}
              defaultVisibleTypes={defaultVisibleTypes}
              zoom={zoom}
            />
          )}
          {ENABLE_LAYER_TABS && activeTab === "inspect" && (
            <LayerTree
              inspect
              visibleTypes={inspectVisibleTypes}
              setVisibleTypes={setInspectVisibleTypes}
              defaultVisibleTypes={defaultInspectVisibleTypes}
              zoom={zoom}
            />
          )}
          {ENABLE_LAYER_TABS && activeTab === "features" && <ProfilePanel isDark={isDark} />}
        </Box>
      </Drawer>
    </>
  );
}

SidePanel.propTypes = {
  mode: PropTypes.string.isRequired,
  drawerOpen: PropTypes.bool.isRequired,
  setDrawerOpen: PropTypes.func.isRequired,
  activeTab: PropTypes.string.isRequired,
  setActiveTab: PropTypes.func.isRequired,
  visibleTypes: PropTypes.array.isRequired,
  setVisibleTypes: PropTypes.func.isRequired,
  defaultVisibleTypes: PropTypes.array,
  inspectVisibleTypes: PropTypes.array.isRequired,
  setInspectVisibleTypes: PropTypes.func.isRequired,
  defaultInspectVisibleTypes: PropTypes.array,
  zoom: PropTypes.number.isRequired,
  features: PropTypes.array.isRequired,
  setFeatures: PropTypes.func.isRequired,
  activeFeature: PropTypes.object,
  setActiveFeature: PropTypes.func.isRequired,
};
