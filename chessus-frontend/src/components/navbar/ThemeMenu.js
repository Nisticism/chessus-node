import React, { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { IoSettingsOutline } from "react-icons/io5";

const THEMES = [
  { id: "grove", name: "Grove", desc: "Green" },
  { id: "classic", name: "Classic", desc: "Blue" },
];

// Quick settings / theme switcher available to everyone (including guests) from
// the navbar. Persists to localStorage so the choice survives refreshes and,
// for guests, carries into registration.
const ThemeMenu = () => {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("siteTheme") || "grove");
  const [showZoomWidget, setShowZoomWidget] = useState(
    () => localStorage.getItem("hideBoardZoomWidget") !== "true"
  );
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [open]);

  // Keep the zoom toggle in sync when the preference changes elsewhere (Preferences page).
  useEffect(() => {
    const sync = () => setShowZoomWidget(localStorage.getItem("hideBoardZoomWidget") !== "true");
    window.addEventListener("boardZoomWidgetPrefChanged", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("boardZoomWidgetPrefChanged", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const pickTheme = (id) => {
    setTheme(id);
    localStorage.setItem("siteTheme", id);
    document.documentElement.setAttribute("data-theme", id);
    setOpen(false);
  };

  const toggleZoomWidget = () => {
    setShowZoomWidget((prev) => {
      const next = !prev;
      localStorage.setItem("hideBoardZoomWidget", next ? "false" : "true");
      // Notify any mounted board zoom widgets in this same tab.
      window.dispatchEvent(new Event("boardZoomWidgetPrefChanged"));
      return next;
    });
  };

  return (
    <div className="theme-menu" ref={ref}>
      <button
        type="button"
        className="theme-menu-btn"
        onClick={() => setOpen((o) => !o)}
        title="Settings & theme"
        aria-label="Settings and theme"
        aria-expanded={open}
      >
        <IoSettingsOutline size={20} />
      </button>
      {open && (
        <div className="theme-menu-dropdown">
          <div className="theme-menu-heading">Theme</div>
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme-menu-item ${theme === t.id ? "active" : ""}`}
              onClick={() => pickTheme(t.id)}
            >
              <span className={`theme-swatch theme-swatch-${t.id}`} />
              <span className="theme-menu-name">{t.name}</span>
              <span className="theme-menu-desc">{t.desc}</span>
              {theme === t.id && <span className="theme-menu-check">✓</span>}
            </button>
          ))}
          <div className="theme-menu-heading">Board</div>
          <button
            type="button"
            className={`theme-menu-item ${showZoomWidget ? "active" : ""}`}
            onClick={toggleZoomWidget}
            role="switch"
            aria-checked={showZoomWidget}
          >
            <span className="theme-menu-name">Zoom controls</span>
            <span className="theme-menu-desc">{showZoomWidget ? "Shown on boards" : "Hidden"}</span>
            {showZoomWidget && <span className="theme-menu-check">✓</span>}
          </button>
          <Link className="theme-menu-more" to="/preferences" onClick={() => setOpen(false)}>
            More settings →
          </Link>
        </div>
      )}
    </div>
  );
};

export default ThemeMenu;
