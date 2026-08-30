'use client';

import { useState, useEffect } from "react";
import { ThemeProvider } from "@mui/material";
import CitySearch from "@/components/landing/CitySearch";
import { keepTheme, darkTheme, lightTheme } from "@/lib/themeUtils";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [modeName, setModeName] = useState("theme-dark");

  useEffect(() => {
    keepTheme(setModeName);

    // A hash like #14.5/37.77/-122.42 on `/` is an old map deep-link (or a
    // pasted MapLibre position). Send it to /map so those URLs still work.
    const hash = window.location.hash.replace("#", "");
    const parts = hash.split("/");
    if (parts.length >= 3) {
      const [z, lat, lng] = parts.map(Number);
      if (!isNaN(z) && !isNaN(lat) && !isNaN(lng)) {
        window.location.replace(`/map${window.location.search}${window.location.hash}`);
        return;
      }
    }

    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <ThemeProvider theme={modeName === "theme-dark" ? darkTheme : lightTheme}>
      <CitySearch mode={modeName} />
    </ThemeProvider>
  );
}
