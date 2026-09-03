"use client";

import { useEffect, useState } from "react";
import { ThemeProvider } from "@mui/material";
import MobileHere from "@/components/mobile/MobileHere";
import { keepTheme, darkTheme, lightTheme } from "@/lib/themeUtils";

// `/here` — mobile-native "where am I standing and can I see the show?"
// flow. See components/mobile/MobileHere.jsx for the actual view. This
// route is intentionally standalone (no Header, no MapView) — the
// killer mobile scenario is a user physically at a viewing spot with
// 10 seconds to know "yes/no," not a planning session.
export default function HerePage() {
  const [modeName, setModeName] = useState("theme-dark");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    keepTheme(setModeName);
    setMounted(true);
  }, []);
  if (!mounted) return null; // avoids SSR/CSR theme flash
  const isLight = modeName === "theme-light";
  return (
    <ThemeProvider theme={isLight ? lightTheme : darkTheme}>
      <MobileHere />
    </ThemeProvider>
  );
}
