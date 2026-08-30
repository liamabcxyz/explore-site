"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import InputBase from "@mui/material/InputBase";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import PropTypes from "prop-types";
import {
  GEOCODER_BASE,
  SUGGESTED_CITIES,
  mapHrefFromPlace,
} from "@/lib/geocoder";

const TYPE_LABELS = {
  locality: "City",
  localadmin: "Local Admin",
  county: "County",
  region: "Region",
  country: "Country",
  neighbourhood: "Neighborhood",
};

function defaultNavigate(href) {
  window.location.assign(href);
}

export default function CitySearch({ mode, onNavigate }) {
  const isDark = mode === "theme-dark";
  const go = onNavigate || defaultNavigate;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  const search = useCallback(async (q) => {
    if (abortRef.current) abortRef.current.abort();
    if (!q || q.length < 2) {
      setResults([]);
      setOpen(false);
      setNotFound(false);
      return [];
    }

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `${GEOCODER_BASE}/search?q=${encodeURIComponent(q)}&limit=6&autocomplete=true`,
        { signal: controller.signal }
      );
      const data = await res.json();
      const items = data.results || [];
      setResults(items);
      setNotFound(items.length === 0);
      setOpen(true);
      return items;
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("Geocoder search failed:", err);
      }
      return [];
    }
  }, []);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 200);
  };

  const handleSelect = (result) => {
    const href = mapHrefFromPlace(result);
    if (!href) return;
    go(href);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (results.length > 0) {
      handleSelect(results[0]);
      return;
    }
    const items = await search(query);
    if (items[0]) handleSelect(items[0]);
  };

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const ink = isDark ? "rgba(255,255,255,0.87)" : "#213547";
  const muted = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";
  const fieldBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
  const pageBg = isDark ? "#121212" : "#f4f4f0";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        bgcolor: pageBg,
        color: ink,
      }}
    >
      <Typography
        component="h1"
        sx={{ fontSize: { xs: 36, sm: 48 }, fontWeight: 700, letterSpacing: 2, mb: 1 }}
      >
        VANTAGE
      </Typography>
      <Typography sx={{ color: muted, mb: 4, textAlign: "center", maxWidth: 420 }}>
        Search a city, then pick a launch point to see where the fireworks will be visible.
      </Typography>

      <Box sx={{ width: "100%", maxWidth: 560, position: "relative" }}>
        <Paper
          component="form"
          onSubmit={handleSubmit}
          elevation={0}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.75,
            bgcolor: fieldBg,
            borderRadius: 2,
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 22, color: muted }}
            aria-hidden
          >
            search
          </span>
          <InputBase
            placeholder="Search for a city…"
            value={query}
            onChange={handleInput}
            onFocus={() => results.length > 0 && setOpen(true)}
            autoFocus
            inputProps={{ "aria-label": "Search for a city" }}
            sx={{ flex: 1, fontSize: 16, color: ink }}
          />
          <Button type="submit" variant="contained" sx={{ textTransform: "none", px: 2 }}>
            Search
          </Button>
        </Paper>

        {open && (results.length > 0 || notFound) && (
          <Paper
            elevation={6}
            sx={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              mt: 0.5,
              zIndex: 10,
              maxHeight: 320,
              overflow: "auto",
              bgcolor: isDark ? "#2a2a2a" : "#fff",
            }}
          >
            {notFound && results.length === 0 ? (
              <Typography
                variant="body2"
                sx={{ px: 2, py: 1.5, color: muted, fontStyle: "italic" }}
              >
                No results found
              </Typography>
            ) : (
              <List dense disablePadding>
                {results.map((r, i) => (
                  <ListItemButton
                    key={r.gers_id || i}
                    onClick={() => handleSelect(r)}
                    sx={{
                      "&:hover": {
                        bgcolor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.04)",
                      },
                    }}
                  >
                    <ListItemText
                      primary={r.name}
                      secondary={
                        <Typography variant="caption" sx={{ color: muted }}>
                          {TYPE_LABELS[r.type] || r.type}
                          {r.region ? `, ${r.region}` : ""}
                          {r.country ? ` · ${r.country}` : ""}
                        </Typography>
                      }
                      primaryTypographyProps={{ fontSize: 15, color: ink }}
                    />
                  </ListItemButton>
                ))}
              </List>
            )}
          </Paper>
        )}
      </Box>

      <Box sx={{ mt: 3, display: "flex", flexWrap: "wrap", gap: 1, justifyContent: "center", maxWidth: 560 }}>
        {SUGGESTED_CITIES.map((city) => (
          <Chip
            key={city.name}
            label={city.name}
            onClick={() => handleSelect(city)}
            clickable
            sx={{
              color: ink,
              bgcolor: fieldBg,
              "&:hover": { bgcolor: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.1)" },
            }}
          />
        ))}
      </Box>
    </Box>
  );
}

CitySearch.propTypes = {
  mode: PropTypes.string.isRequired,
  onNavigate: PropTypes.func,
};
