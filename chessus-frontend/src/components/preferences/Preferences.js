import React, { useState, useEffect, useMemo } from "react";
import { Navigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./preferences.module.scss";
import Divider from "../Divider/Divider";
import StandardButton from "../standardbutton/StandardButton";
import axios from "axios";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";

// Helper: Convert HSL to Hex
const hslToHex = (h, s, l) => {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};

// Helper: Convert Hex to HSL
const hexToHsl = (hex) => {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
      default: break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

// Color presets - each has light and dark square HSL values (h, l)
const COLOR_PRESETS = {
  wood: { 
    name: 'Wood', 
    light: { h: 35, l: 82 }, 
    dark: { h: 30, l: 28 } 
  },
  nature: { 
    name: 'Nature', 
    light: { h: 100, l: 82 }, 
    dark: { h: 130, l: 22 } 
  },
  aqua: { 
    name: 'Aqua', 
    light: { h: 185, l: 85 }, 
    dark: { h: 200, l: 22 } 
  },
  charcoal: { 
    name: 'Charcoal', 
    light: { h: 220, l: 88 }, 
    dark: { h: 220, l: 18 } 
  },
  royal: { 
    name: 'Royal', 
    light: { h: 270, l: 82 }, 
    dark: { h: 265, l: 22 } 
  },
  sunset: { 
    name: 'Sunset', 
    light: { h: 25, l: 85 }, 
    dark: { h: 10, l: 30 } 
  },
  mint: { 
    name: 'Mint', 
    light: { h: 155, l: 85 }, 
    dark: { h: 160, l: 25 } 
  },
  rose: { 
    name: 'Rose', 
    light: { h: 340, l: 85 }, 
    dark: { h: 330, l: 25 } 
  }
};

// Default is Wood theme
const DEFAULT_LIGHT = COLOR_PRESETS.wood.light;
const DEFAULT_DARK = COLOR_PRESETS.wood.dark;

const Preferences = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  
  // Initialize HSL values from saved colors
  const [lightHue, setLightHue] = useState(() => {
    const saved = currentUser?.light_square_color || localStorage.getItem('boardLightColor');
    if (saved && saved.startsWith('#')) {
      return hexToHsl(saved).h;
    }
    return DEFAULT_LIGHT.h;
  });
  
  const [lightLightness, setLightLightness] = useState(() => {
    const saved = currentUser?.light_square_color || localStorage.getItem('boardLightColor');
    if (saved && saved.startsWith('#')) {
      return hexToHsl(saved).l;
    }
    return DEFAULT_LIGHT.l;
  });

  const [darkHue, setDarkHue] = useState(() => {
    const saved = currentUser?.dark_square_color || localStorage.getItem('boardDarkColor');
    if (saved && saved.startsWith('#')) {
      return hexToHsl(saved).h;
    }
    return DEFAULT_DARK.h;
  });
  
  const [darkLightness, setDarkLightness] = useState(() => {
    const saved = currentUser?.dark_square_color || localStorage.getItem('boardDarkColor');
    if (saved && saved.startsWith('#')) {
      return hexToHsl(saved).l;
    }
    return DEFAULT_DARK.l;
  });

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [boardAnimations, setBoardAnimations] = useState(() => {
    return localStorage.getItem('boardAnimations') !== 'false';
  });

  // Fixed saturation for good-looking colors
  const SATURATION = 40;

  // Compute hex colors from HSL values
  const lightSquareColor = useMemo(() => 
    hslToHex(lightHue, SATURATION, lightLightness), 
    [lightHue, lightLightness]
  );
  
  const darkSquareColor = useMemo(() => 
    hslToHex(darkHue, SATURATION, darkLightness), 
    [darkHue, darkLightness]
  );

  // Detect which preset (if any) matches current slider values
  const activePreset = useMemo(() => {
    for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
      if (preset.light.h === lightHue && 
          preset.light.l === lightLightness &&
          preset.dark.h === darkHue && 
          preset.dark.l === darkLightness) {
        return key;
      }
    }
    return null;
  }, [lightHue, lightLightness, darkHue, darkLightness]);

  // Sync with localStorage for immediate use
  useEffect(() => {
    localStorage.setItem('boardLightColor', lightSquareColor);
    localStorage.setItem('boardDarkColor', darkSquareColor);
  }, [lightSquareColor, darkSquareColor]);

  useEffect(() => {
    localStorage.setItem('boardAnimations', boardAnimations ? 'true' : 'false');
  }, [boardAnimations]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to manage your account preferences." }} />;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to database
      const response = await axios.post(
        API_URL + "preferences/colors",
        {
          user_id: currentUser.id,
          light_square_color: lightSquareColor,
          dark_square_color: darkSquareColor,
        },
        { headers: authHeader() }
      );
      
      // Update user in localStorage
      const updatedUser = {
        ...currentUser,
        light_square_color: lightSquareColor,
        dark_square_color: darkSquareColor,
      };
      localStorage.setItem("user", JSON.stringify(updatedUser));
      
      // Dispatch to update Redux state
      dispatch({
        type: "UPDATE_USER_PREFERENCES",
        payload: { user: updatedUser },
      });
      
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error saving preferences:", error);
      alert("Failed to save preferences. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLightHue(DEFAULT_LIGHT.h);
    setLightLightness(DEFAULT_LIGHT.l);
    setDarkHue(DEFAULT_DARK.h);
    setDarkLightness(DEFAULT_DARK.l);
    setBoardAnimations(true);
  };

  const applyPreset = (presetKey) => {
    const preset = COLOR_PRESETS[presetKey];
    if (preset) {
      setLightHue(preset.light.h);
      setLightLightness(preset.light.l);
      setDarkHue(preset.dark.h);
      setDarkLightness(preset.dark.l);
    }
  };

  // Generate hue gradient for the slider background
  const hueGradient = `linear-gradient(to right, 
    hsl(0, ${SATURATION}%, 50%), 
    hsl(60, ${SATURATION}%, 50%), 
    hsl(120, ${SATURATION}%, 50%), 
    hsl(180, ${SATURATION}%, 50%), 
    hsl(240, ${SATURATION}%, 50%), 
    hsl(300, ${SATURATION}%, 50%), 
    hsl(360, ${SATURATION}%, 50%)
  )`;

  return (
    <div className={styles["preferences-container"]}>
      <div className={styles["preferences-header"]}>
        <h1>User Preferences</h1>
        <p className={styles["header-description"]}>
          Customize your board appearance and other settings
        </p>
      </div>

      <Divider />

      <div className={styles["preferences-content"]}>
        <section className={styles["preference-section"]}>
          <h2>Board Appearance</h2>
          
          {/* Color Preview */}
          <div className={styles["board-preview"]}>
            <div className={styles["preview-title"]}>Preview</div>
            <div className={styles["preview-board"]}>
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className={styles["preview-row"]}>
                  {[0, 1, 2, 3].map((col) => (
                    <div
                      key={col}
                      className={styles["preview-square"]}
                      style={{
                        backgroundColor: (row + col) % 2 === 0 
                          ? lightSquareColor 
                          : darkSquareColor
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* Theme Presets */}
          <div className={styles["presets-section"]}>
            <div className={styles["presets-label"]}>Quick Themes</div>
            <div className={styles["presets-grid"]}>
              {Object.entries(COLOR_PRESETS).map(([key, preset]) => (
                <button
                  key={key}
                  className={`${styles["preset-button"]} ${activePreset === key ? styles["preset-selected"] : ''}`}
                  onClick={() => applyPreset(key)}
                  title={preset.name}
                >
                  <div className={styles["preset-preview"]}>
                    <div 
                      className={styles["preset-square"]} 
                      style={{ backgroundColor: hslToHex(preset.light.h, SATURATION, preset.light.l) }}
                    />
                    <div 
                      className={styles["preset-square"]} 
                      style={{ backgroundColor: hslToHex(preset.dark.h, SATURATION, preset.dark.l) }}
                    />
                    <div 
                      className={styles["preset-square"]} 
                      style={{ backgroundColor: hslToHex(preset.dark.h, SATURATION, preset.dark.l) }}
                    />
                    <div 
                      className={styles["preset-square"]} 
                      style={{ backgroundColor: hslToHex(preset.light.h, SATURATION, preset.light.l) }}
                    />
                  </div>
                  <span className={styles["preset-name"]}>{preset.name}</span>
                  {activePreset === key && <span className={styles["preset-check"]}>✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Color Selectors */}
          <div className={styles["color-selector-container"]}>
            {/* Light Square Controls */}
            <div className={styles["color-control-group"]}>
              <div className={styles["color-selector-label"]}>Light Square Color</div>
              <div 
                className={styles["color-preview-swatch"]} 
                style={{ backgroundColor: lightSquareColor }}
              />
              
              <div className={styles["slider-group"]}>
                <div className={styles["slider-row"]}>
                  <label className={styles["slider-label"]}>Color</label>
                  <div className={styles["slider-wrapper"]}>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={lightHue}
                      onChange={(e) => setLightHue(Number(e.target.value))}
                      className={styles["hue-slider"]}
                      style={{ background: hueGradient }}
                    />
                  </div>
                  <span className={styles["slider-value"]}>{lightHue}Â°</span>
                </div>
                
                <div className={styles["slider-row"]}>
                  <label className={styles["slider-label"]}>Brightness</label>
                  <div className={styles["slider-wrapper"]}>
                    <input
                      type="range"
                      min="50"
                      max="95"
                      value={lightLightness}
                      onChange={(e) => setLightLightness(Number(e.target.value))}
                      className={styles["lightness-slider"]}
                      style={{ 
                        background: `linear-gradient(to right, 
                          hsl(${lightHue}, ${SATURATION}%, 50%), 
                          hsl(${lightHue}, ${SATURATION}%, 95%)
                        )` 
                      }}
                    />
                  </div>
                  <span className={styles["slider-value"]}>{lightLightness}%</span>
                </div>
              </div>
              
              <div className={styles["selected-color"]}>
                Hex: <span style={{ color: lightSquareColor }}>{lightSquareColor}</span>
              </div>
            </div>

            {/* Dark Square Controls */}
            <div className={styles["color-control-group"]}>
              <div className={styles["color-selector-label"]}>Dark Square Color</div>
              <div 
                className={styles["color-preview-swatch"]} 
                style={{ backgroundColor: darkSquareColor }}
              />
              
              <div className={styles["slider-group"]}>
                <div className={styles["slider-row"]}>
                  <label className={styles["slider-label"]}>Color</label>
                  <div className={styles["slider-wrapper"]}>
                    <input
                      type="range"
                      min="0"
                      max="360"
                      value={darkHue}
                      onChange={(e) => setDarkHue(Number(e.target.value))}
                      className={styles["hue-slider"]}
                      style={{ background: hueGradient }}
                    />
                  </div>
                  <span className={styles["slider-value"]}>{darkHue}Â°</span>
                </div>
                
                <div className={styles["slider-row"]}>
                  <label className={styles["slider-label"]}>Brightness</label>
                  <div className={styles["slider-wrapper"]}>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      value={darkLightness}
                      onChange={(e) => setDarkLightness(Number(e.target.value))}
                      className={styles["lightness-slider"]}
                      style={{ 
                        background: `linear-gradient(to right, 
                          hsl(${darkHue}, ${SATURATION}%, 5%), 
                          hsl(${darkHue}, ${SATURATION}%, 50%)
                        )` 
                      }}
                    />
                  </div>
                  <span className={styles["slider-value"]}>{darkLightness}%</span>
                </div>
              </div>
              
              <div className={styles["selected-color"]}>
                Hex: <span style={{ color: darkSquareColor }}>{darkSquareColor}</span>
              </div>
            </div>
          </div>

          {/* Animations Section */}
          <div className={styles["animations-section"]}>
            <div className={styles["animations-label"]}>Animations</div>
            <label className={styles["toggle-row"]}>
              <span className={styles["toggle-text"]}>Enable board animations</span>
              <span className={styles["toggle-hint"]}>Shows visual effects on special pieces (e.g. smoky aura on multi-tile pieces)</span>
              <div className={styles["toggle-switch"]}>
                <input
                  type="checkbox"
                  checked={boardAnimations}
                  onChange={(e) => setBoardAnimations(e.target.checked)}
                />
                <span className={styles["toggle-slider"]} />
              </div>
            </label>
          </div>

          <div className={styles["action-buttons"]}>
            <StandardButton buttonText="Reset to Default" onClick={handleReset} />
            <StandardButton 
              buttonText={saving ? "Saving..." : "Save Preferences"} 
              onClick={handleSave}
              disabled={saving}
            />
          </div>

          {saved && (
            <div className={styles["save-message"]}>
              Preferences saved successfully!
            </div>
          )}
        </section>

        {/* Future sections can be added here */}
        {/* <section className={styles["preference-section"]}>
          <h2>Notification Settings</h2>
          ...
        </section> */}
      </div>
    </div>
  );
};

export default Preferences;
