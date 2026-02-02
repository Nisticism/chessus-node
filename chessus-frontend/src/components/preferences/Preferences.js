import React, { useState, useEffect } from "react";
import { Navigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./preferences.module.scss";
import ColorBlock from "../colorblock/ColorBlock";
import Divider from "../Divider/Divider";
import StandardButton from "../standardbutton/StandardButton";
import axios from "axios";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";

const Preferences = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  
  // Load preferences from user object or localStorage as fallback
  const [lightSquareColor, setLightSquareColor] = useState(() => {
    return currentUser?.light_square_color || localStorage.getItem('boardLightColor') || "#cad5e8";
  });
  
  const [darkSquareColor, setDarkSquareColor] = useState(() => {
    return currentUser?.dark_square_color || localStorage.getItem('boardDarkColor') || "#08234d";
  });

  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync with localStorage for immediate use
  useEffect(() => {
    localStorage.setItem('boardLightColor', lightSquareColor);
    localStorage.setItem('boardDarkColor', darkSquareColor);
  }, [lightSquareColor, darkSquareColor]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  const lightColorArray = [
    "white",
    "#cad5e8",
    "lightgray",
    "#f0c285",
    "#eef085",
    "#9ef085",
    "#85f0d0",
    "aqua",
    "#85d7f0",
    "#85aaf0",
    "#9585f0",
    "#ce85f0",
    "#f085ba",
    "#f08585"
  ];

  const darkColorArray = [
    "#505050",
    "#08234d",
    "#000000",
    "#725c3f",
    "#606136",
    "#3f6135",
    "#335c50",
    "#005050",
    "#2e4d57",
    "#344361",
    "#312b52",
    "#482e55",
    "#522b3f",
    "#532d2d"
  ];

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
    setLightSquareColor("#cad5e8");
    setDarkSquareColor("#08234d");
  };

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

          {/* Color Selectors */}
          <div className={styles["color-selector-container"]}>
            <div className={styles["light-selector-container"]}>
              <div className={styles["color-selector-label"]}>Light Square Color</div>
              <div className={styles["color-grid"]}>
                {lightColorArray.map((color, index) => (
                  <ColorBlock
                    mainColor={color}
                    textColor="black"
                    text=""
                    key={index}
                    setHandle={() => setLightSquareColor(color)}
                  />
                ))}
              </div>
              <div className={styles["selected-color"]}>
                Selected: <span style={{ color: lightSquareColor }}>{lightSquareColor}</span>
              </div>
            </div>

            <div className={styles["dark-selector-container"]}>
              <div className={styles["color-selector-label"]}>Dark Square Color</div>
              <div className={styles["color-grid"]}>
                {darkColorArray.map((color, index) => (
                  <ColorBlock
                    mainColor={color}
                    textColor="white"
                    text=""
                    key={index}
                    setHandle={() => setDarkSquareColor(color)}
                  />
                ))}
              </div>
              <div className={styles["selected-color"]}>
                Selected: <span style={{ color: darkSquareColor }}>{darkSquareColor}</span>
              </div>
            </div>
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
              ✓ Preferences saved successfully!
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
