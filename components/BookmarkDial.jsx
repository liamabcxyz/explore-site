'use client';
import { useState } from 'react';
import { Fab, Chip } from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import { useMapInstance } from '@/lib/MapContext';

// Known, recurring fireworks displays rather than generic city bookmarks —
// same jump-to-camera mechanism as before, just retargeted to the actual
// launch/viewing spot for each show instead of a city's downtown. Framing is
// a "nice angle to look from," not surveyed venue data — same spirit as the
// city bookmarks these replace.
const BOOKMARKS = [
  {
    name: '🎆 Bastille Day (Paris)',
    center: [2.2945, 48.8584], // Eiffel Tower — the launch point itself
    zoom: 15.5,
    pitch: 55,
    bearing: -20,
  },
  {
    name: "🎆 Macy's July 4th (NYC)",
    center: [-73.966, 40.7527], // East River, facing the Midtown skyline
    zoom: 13.5,
    pitch: 60,
    bearing: 60,
  },
  {
    name: '🎆 NYE Fireworks (London)',
    center: [-0.1195, 51.5033], // The London Eye, on the Thames
    zoom: 15.5,
    pitch: 55,
    bearing: -24,
  },
  {
    name: '🎆 Boston Pops July 4th',
    center: [-71.0729, 42.3554], // Charles River Esplanade / Hatch Shell
    zoom: 15.5,
    pitch: 52,
    bearing: 0,
  },
];

// Spread 4 items in an arc above-right of the button — anchored bottom-left
// now (see the root div below), so the fan opens up and to the right rather
// than the old bottom-center layout's full semicircle, which would push the
// leftmost chips off the edge of the screen from this corner.
const RADIUS = 90;
const ANGLES = [100, 75, 50, 25];

function getArcPosition(angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: RADIUS * Math.cos(rad),
    y: -RADIUS * Math.sin(rad),
  };
}

export default function BookmarkDial({ mode }) {
  const [open, setOpen] = useState(false);
  const map = useMapInstance();
  const isDark = mode === "theme-dark";

  const handleClick = (bookmark) => {
    if (!map) return;
    map.jumpTo({
      center: bookmark.center,
      zoom: bookmark.zoom,
      pitch: bookmark.pitch,
      bearing: bookmark.bearing,
    });
    setOpen(false);
  };

  return (
    <div style={{ position: 'fixed', bottom: 24, left: 24, zIndex: 1000 }}>
      {BOOKMARKS.map((bookmark, i) => {
        const pos = getArcPosition(ANGLES[i]);
        return (
          <Chip
            key={bookmark.name}
            label={bookmark.name}
            onClick={() => handleClick(bookmark)}
            sx={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: open
                ? `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px)) scale(1)`
                : 'translate(-50%, -50%) scale(0)',
              opacity: open ? 1 : 0,
              transition: `transform 0.3s ${i * 0.03}s, opacity 0.2s ${i * 0.03}s`,
              bgcolor: isDark ? '#000000' : '#ffffff',
              color: isDark ? '#ffffff' : '#000000',
              fontWeight: 600,
              cursor: 'pointer',
              maxWidth: 'none',
              '& .MuiChip-label': { overflow: 'visible' },
              '&:hover': { bgcolor: isDark ? '#222222' : '#f0f0f0' },
            }}
          />
        );
      })}
      <Fab
        aria-label="Bookmarks"
        onClick={() => setOpen(!open)}
        sx={{
          bgcolor: isDark ? '#000000' : '#ffffff',
          color: isDark ? '#ffffff' : '#000000',
          '&:hover': { bgcolor: isDark ? '#222222' : '#f0f0f0' },
        }}
      >
        <StarIcon sx={{ fontSize: 28 }} />
      </Fab>
    </div>
  );
}
