"use client";

import { useState } from "react";
import { Box, Chip, Link, Menu, MenuItem, Stack, Typography } from "@mui/material";

// Fixed bottom-right "BETA · v[sha] · Send feedback" chip. Present on
// every route (mounted from app/layout.jsx) so:
//   1. Every bug report we get carries the version it was seen on
//      (SHA is copyable from the menu the badge opens).
//   2. Users don't confuse the beta with a stable release and quietly
//      abandon it — the visible label sets expectations.
//   3. There's always an obvious way to send feedback, even on pages
//      that don't have a domain-specific "report" button.
//
// Auto-hides in production via NEXT_PUBLIC_HIDE_BETA_BADGE=true so the
// chip disappears when the site graduates without needing a code change.
export default function BetaBadge() {
  const [anchor, setAnchor] = useState(null);

  if (process.env.NEXT_PUBLIC_HIDE_BETA_BADGE === "true") return null;

  const sha = (process.env.NEXT_PUBLIC_GIT_SHA || "dev").slice(0, 8);
  const builtAt = process.env.NEXT_PUBLIC_BUILD_TIME;
  // Same "+feedback" Gmail alias fallback as MobileHere — routes to
  // vantagespots@gmail.com but filterable, and works even before the
  // deployer sets NEXT_PUBLIC_FEEDBACK_EMAIL explicitly.
  const feedbackEmail = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "vantagespots+feedback@gmail.com";

  const feedbackHref = feedbackEmail
    ? `mailto:${feedbackEmail}?subject=${encodeURIComponent(`VANTAGE beta feedback (v${sha})`)}` +
      `&body=${encodeURIComponent(
        "What happened:\n\n\n" +
          "What did you expect:\n\n\n" +
          "URL: " + (typeof window !== "undefined" ? window.location.href : "") + "\n" +
          "Version: " + sha + "\n" +
          "Browser: " + (typeof navigator !== "undefined" ? navigator.userAgent : "") + "\n"
      )}`
    : null;

  return (
    <>
      <Box
        sx={{
          position: "fixed",
          bottom: 8,
          right: 8,
          zIndex: 2000,
          pointerEvents: "auto",
        }}
      >
        <Chip
          size="small"
          label={`BETA · v${sha}`}
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            fontFamily: "monospace",
            fontSize: 11,
            fontWeight: 600,
            bgcolor: "rgba(255, 145, 0, 0.9)",
            color: "white",
            cursor: "pointer",
            "&:hover": { bgcolor: "rgba(255, 145, 0, 1)" },
          }}
        />
      </Box>
      <Menu
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <MenuItem sx={{ pointerEvents: "none", opacity: 1 }}>
          <Stack spacing={0.25}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              This is a testing release.
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
              version: {sha}
            </Typography>
            {builtAt && (
              <Typography variant="caption" sx={{ fontFamily: "monospace", color: "text.secondary" }}>
                built: {new Date(builtAt).toLocaleString()}
              </Typography>
            )}
          </Stack>
        </MenuItem>
        {feedbackHref ? (
          <MenuItem
            component={Link}
            href={feedbackHref}
            underline="none"
            sx={{ color: "primary.main" }}
          >
            Send feedback via email
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              try {
                navigator.clipboard?.writeText(sha);
              } catch { /* clipboard blocked, no fallback needed */ }
              setAnchor(null);
            }}
          >
            Copy version tag
          </MenuItem>
        )}
      </Menu>
    </>
  );
}
