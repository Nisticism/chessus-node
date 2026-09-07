import React from "react";
import { FaChessPawn, FaChessKnight, FaChessBishop } from "react-icons/fa";

// Single source of truth for the main navigation menus. Consumed by both the
// navbar dropdowns and the footer columns so they stay in sync.
export const NAV_MENUS = [
  {
    id: "play",
    label: "Play",
    path: "/play",
    items: [
      { label: "Open Games", path: "/play/games", icon: <FaChessPawn color="#cbd5e1" /> },
      // Points at the game library rather than a Play-specific page: it is the
      // same list, and reaching it only through Create was the thing to fix.
      { label: "All Games", path: "/create/games", icon: "📚" },
      { label: "Tournaments", path: "/play/tournaments", icon: "🏆" },
      { label: "Sandbox", path: "/sandbox", icon: "🪣" },
    ],
  },
  {
    id: "create",
    label: "Create",
    path: "/create",
    items: [
      { label: "New Game", path: "/create/game", icon: "🎲" },
      { label: "New Piece", path: "/create/piece", icon: <FaChessKnight color="#cbd5e1" /> },
      { label: "Game Library", path: "/create/games", icon: "📚" },
      { label: "Piece Library", path: "/create/pieces", icon: <FaChessBishop color="#cbd5e1" /> },
    ],
  },
  {
    id: "community",
    label: "Community",
    path: "/community",
    items: [
      { label: "Players", path: "/community/players", icon: "🧑‍🤝‍🧑" },
      { label: "Forums", path: "/forums", icon: "💬" },
      { label: "Social Media", path: "/community/social", icon: "🌐" },
      { label: "Streams", path: "/community/streams", icon: "📺" },
    ],
  },
  {
    id: "info",
    label: "Info",
    path: "/info",
    items: [
      { label: "News", path: "/news", icon: "📰" },
      { label: "FAQ", path: "/faq", icon: "❓" },
      { label: "About Us", path: "/community/about", icon: "ℹ️" },
      { label: "Contact", path: "/contact", icon: "✉️" },
      { label: "Support GridGrove", path: "/donate", icon: "💝" },
    ],
  },
];
