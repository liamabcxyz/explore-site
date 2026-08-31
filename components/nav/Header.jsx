import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import OvertureWordmark from "@/components/nav/OvertureWordmark";
import DarkModeToggle from "@/components/nav/DarkModeToggle";
import ShareButton from "@/components/nav/ShareButton";
import SearchBox from "@/components/nav/SearchBox";
import PropTypes from "prop-types";

// The Overture Explorer version of this bar also carried GitHub / docs /
// bug-report links (all pointing at Overture Maps' repo, not this project),
// a language switcher, and a globe/flat toggle. None of them serve a
// VANTAGE user — the analysis is fireworks visibility, not raw-data
// inspection — so they're gone. What's left is what the app actually
// needs: the wordmark, a share-current-view button (already picks up
// launch state via lib/launchUrlState.js), theme, and a place search
// for jumping to a city.
export default function Header({ mode, setMode, visibleTypes, activeFeature, onGersSelect }) {
  const isDark = mode === "theme-dark";

  return (
    <AppBar
      position="fixed"
      elevation={3}
      sx={{
        bgcolor: isDark ? "#1e1e1e" : "#ffffff",
        color: isDark ? "#fff" : "#213547",
        zIndex: 1100,
      }}
    >
      <Toolbar variant="dense" sx={{ minHeight: 60 }}>
        <OvertureWordmark href="/" />
        <Box sx={{ flexGrow: 1 }} />
        <ShareButton visibleTypes={visibleTypes} activeFeature={activeFeature} />
        <DarkModeToggle mode={mode} setMode={setMode} />
        <SearchBox mode={mode} onGersSelect={onGersSelect} />
      </Toolbar>
    </AppBar>
  );
}

Header.propTypes = {
  mode: PropTypes.string.isRequired,
  setMode: PropTypes.func.isRequired,
  visibleTypes: PropTypes.array.isRequired,
  activeFeature: PropTypes.object,
  onGersSelect: PropTypes.func,
};
