import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import Wordmark from "@/components/nav/Wordmark";
import DarkModeToggle from "@/components/nav/DarkModeToggle";
import ShareButton from "@/components/nav/ShareButton";
import SearchBox from "@/components/nav/SearchBox";
import PropTypes from "prop-types";

// The header bar carries what a VANTAGE user actually needs: the
// wordmark, a share-current-view button (picks up launch state via
// lib/launchUrlState.js), the light/dark toggle, and a place search
// for jumping to a city. Deliberately minimal — every extra button
// is one more thing distracting from the analysis on screen.
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
        <Wordmark href="/" />
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
