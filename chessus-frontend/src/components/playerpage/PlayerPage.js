import React, { useState, useEffect } from "react";
import { Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./player-page.module.scss";
import { deleteUser, getUser } from "../../actions/auth";
import { clearPlayerPage } from "../../actions/users";
import { EDIT_SUCCESS } from "../../actions/types";
import StandardButton from "../standardbutton/StardardButton";
import axios from "axios";
import API_URL from "../../global/global";
import StandardTextBlock from "../StandardTextBlock/StandardTextBlock";
import BioSection from "../biosection/BioSection";
import Divider from "../Divider/Divider";
import DonorBadge from "../DonorBadge/DonorBadge";
import MatchHistory from "../matchhistory/MatchHistory";
// import NotFound from "../notfound/NotFound";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";

const PlayerPage = (props) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);

  
  const [loading, setLoading] = useState(true);
  // const [ messageDisplay, setMessageDisplay ] = useState(false);
  const dispatch = useDispatch();
  const [firstRender, setFirstRender] = useState(false);
  // const [userInfo, setUserInfo] = useState(null);
  const [realUser, setRealUser] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertType, setAlertType] = useState(""); // "delete" or "picture"
  const [showPictureModal, setShowPictureModal] = useState(false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState(null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [displayPictureUrl, setDisplayPictureUrl] = useState(null); // Force re-render on upload
  const [showBanner, setShowBanner] = useState(false);
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerType, setBannerType] = useState("success");
  // const [postDeleteUsername, setPostDeleteUsername] = useState("");
  const playerPageUser = useSelector((state) => state.authReducer.playerPage);
  
  const navigate = useNavigate();
  const location = useLocation();

  const { username: routeUsername } = useParams();
  const username = routeUsername || (currentUser ? currentUser.username : "");

  const handleHome = () => {
    navigate("/");
  }

  useEffect(() => {
    if (!firstRender && currentUser) {
      setLoading(true);
      setDisplayPictureUrl(null); // Clear display picture URL when loading new profile
      dispatch(clearPlayerPage()); // Clear previous player page data
      // Always fetch fresh data from server, even for own profile
      // This ensures admin updates are visible without logout/login
      checkIfRealUser(username);
      getPlayerPage();
    }
  }, [firstRender, username]);

  // Handle banner message from navigation state (e.g., after profile update)
  useEffect(() => {
    if (location.state?.showBanner) {
      setBannerMessage(location.state.bannerMessage || "Action completed successfully");
      setBannerType(location.state.bannerType || "success");
      setShowBanner(true);
      
      // Clear the navigation state immediately to prevent re-triggering
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  // Auto-dismiss banner after 5 seconds
  useEffect(() => {
    if (showBanner) {
      const timer = setTimeout(() => {
        setShowBanner(false);
      }, 5000);
      
      return () => clearTimeout(timer);
    }
  }, [showBanner]);



  useEffect(() => {
    let timer;
    if (showAlert) {
      timer = setTimeout(() => {
        setShowAlert(false);
        setAlertMessage('');
        // Only redirect to players page if this was a delete alert
        if (alertType === "delete") {
          navigate('/community/players');
        }
        setAlertType("");
      }, 2000);
    }

    return () => {
      clearTimeout(timer);
    };
  }, [showAlert, alertType, navigate]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  const getPlayerPage = () => {
    dispatch(getUser(username)).finally(() => setLoading(false));
  }

  const handleDelete = async(e) => {
    e.preventDefault();
    if (!currentUser) return;
    
    // Show confirmation dialog
    const confirmDelete = window.confirm(
      currentUser.role === "Admin" && currentUser.username !== username
        ? `Are you sure you want to delete the account for ${username}? This action cannot be undone.`
        : "Are you sure you want to delete your account? This action cannot be undone."
    );
    
    if (!confirmDelete) {
      return; // User cancelled
    }

    if (currentUser.role !== "Admin") {
      // Regular user deleting their own account
      try {
        await dispatch(deleteUser(currentUser.username));
        setAlertMessage("Your account has been successfully deleted");
        setAlertType("success");
        setShowAlert(true);
        
        // Wait 2 seconds to show message, then redirect to signup
        setTimeout(() => {
          navigate('/register');
        }, 2000);
      } catch (error) {
        setAlertMessage("Failed to delete account");
        setAlertType("error");
        setShowAlert(true);
      }
    } else {
      // Admin deleting another user's account
      try {
        await dispatch(deleteUser(username, currentUser.id));
        setAlertMessage(`Account for ${username} has been successfully deleted`);
        setAlertType("success");
        setShowAlert(true);
        
        // Wait 2 seconds to show message, then redirect to signup
        setTimeout(() => {
          navigate('/register');
        }, 2000);
      } catch (error) {
        setAlertMessage("Failed to delete account");
        setAlertType("error");
        setShowAlert(true);
      }
    }
  };

  const handleEdit = (e) => {
    e.preventDefault();
    if (!currentUser) return;
    if (currentUser.role !== "Admin") {
      navigate("/profile/edit");
    } else {
      navigate(`/profile/${username}/edit`);
    }
  }

  const handlePreferences = (e) => {
    e.preventDefault();
    navigate("/preferences");
  }

  const handleLogInfo = (e) => {
    e.preventDefault();
    console.log(playerPageUser);
  }

  const handleProfilePictureClick = () => {
    if (currentUser && (currentUser.username === username || currentUser.role === "Admin")) {
      setShowPictureModal(true);
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setProfilePicture(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setProfilePicturePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  }

  const handleUploadPicture = async () => {
    if (!profilePicture) {
      return;
    }

    setUploadingPicture(true);
    const formData = new FormData();
    formData.append('profile_picture', profilePicture);
    formData.append('user_id', currentUser.id);

    try {
      const response = await axios.post(API_URL + 'profile/upload-picture', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      console.log('Upload response:', response.data);
      
      if (response.data.success && response.data.user) {
        // Update user in localStorage with full user object from backend
        localStorage.setItem('user', JSON.stringify(response.data.user));
        
        // Update Redux state with new user data
        dispatch({
          type: EDIT_SUCCESS,
          payload: { user: response.data.user }
        });
        
        setAlertMessage('Profile picture updated successfully!');
        setAlertType('picture');
        setShowAlert(true);
        setShowPictureModal(false);
        setProfilePicture(null);
        setProfilePicturePreview(null);
        
        // Set the display picture URL to force immediate visual update
        setDisplayPictureUrl(`${ASSET_URL}${response.data.profile_picture}?t=${Date.now()}`);
      }
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      console.error('Error response:', error.response?.data);
      setAlertMessage('Failed to upload profile picture');
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setUploadingPicture(false);
    }
  }

  const checkIfRealUser = (username) => {
    console.log(username);
    axios.get((API_URL + 'user'), 
     {params: { username: username}})
    .then (res => {
      setRealUser(true);
      console.log("setting real user as true");
    })
    .catch(
      err => {
        setRealUser(false);
        setLoading(false);
        console.log("setting real user as false");
        console.log(err);
    })
  }

  return (
    <div className="container">
      {/* Banner for profile updates */}
      {showBanner && (
        <div className={styles[bannerType === "success" ? "banner-success" : "banner-error"]}>
          <span>{bannerMessage}</span>
          <button 
            onClick={() => setShowBanner(false)} 
            className={styles["banner-close"]}
            aria-label="Close banner"
          >
            ×
          </button>
        </div>
      )}
      {/* Alert for delete/picture actions */}
      {showAlert  &&
      (<div id="alert-container">
        <div className={styles["alert-style"]}>
          { alertMessage }
        </div>
      </div>
      )}
      {loading ? (
        <div className={styles["loading-container"]}>
          <p>Loading profile...</p>
        </div>
      ) : (
          <>
          {realUser ? 
          <div className={styles["player-page-container"]}>
            <div className={styles["profile-header"]}>
              <div 
                className={styles["profile-avatar"]}
                onClick={handleProfilePictureClick}
                style={{ cursor: (currentUser && (currentUser.username === username || currentUser.role === "Admin")) ? 'pointer' : 'default' }}
              >
                {displayPictureUrl || 
                 (currentUser && username === currentUser.username && currentUser.profile_picture) || 
                 (playerPageUser && playerPageUser.username === username && playerPageUser.profile_picture) ? (
                  <img 
                    src={displayPictureUrl || `${ASSET_URL}${currentUser && username === currentUser.username ? currentUser.profile_picture : playerPageUser?.profile_picture}?t=${Date.now()}`}
                    alt={`${username}'s profile`}
                    className={styles["profile-avatar-img"]}
                    onError={(e) => {
                      console.error('Failed to load profile picture:', e.target.src);
                      e.target.style.display = 'none';
                    }}
                  />
                ) : (
                  username.charAt(0).toUpperCase()
                )}
                {currentUser && (currentUser.username === username || currentUser.role === "Admin") && (
                  <div className={styles["edit-icon"]}>
                    <span>📷</span>
                  </div>
                )}
              </div>
              <div className={styles["profile-header-info"]}>
                <h1 className={styles["username"]}>{username}</h1>
                <div className={styles["badges-row"]}>
                  <div className={styles["role-badge"]}>
                    {currentUser && username === currentUser.username ? (currentUser.role || "Player")
                    : playerPageUser && playerPageUser.role ? playerPageUser.role : "Player"}
                  </div>
                  <DonorBadge 
                    totalDonations={
                      currentUser && username === currentUser.username 
                        ? currentUser.total_donations 
                        : playerPageUser?.total_donations
                    } 
                  />
                </div>
              </div>
              <div className={styles["elo-display"]}>
                <div className={styles["elo-label"]}>ELO Rating</div>
                <div className={styles["elo-value"]}>
                  {playerPageUser?.elo ?? currentUser?.elo ?? 1000}
                </div>
              </div>
            </div>

            <div className={styles["profile-content"]}>
              <div className={styles["info-card"]}>
                <h2 className={styles["card-title"]}>Personal Information</h2>
                <div className={styles["info-grid"]}>
                  <div className={styles["info-item"]}>
                    <span className={styles["info-label"]}>First Name</span>
                    <span className={styles["info-value"]}>
                      {currentUser && username === currentUser.username ? (currentUser.first_name || "N/A") 
                      : playerPageUser && playerPageUser.first_name ? playerPageUser.first_name : "N/A"}
                    </span>
                  </div>
                  <div className={styles["info-item"]}>
                    <span className={styles["info-label"]}>Last Name</span>
                    <span className={styles["info-value"]}>
                      {currentUser && username === currentUser.username ? (currentUser.last_name || "N/A") 
                      : playerPageUser && playerPageUser.last_name ? playerPageUser.last_name : "N/A"}
                    </span>
                  </div>
                  <div className={styles["info-item"]}>
                    <span className={styles["info-label"]}>Email</span>
                    <span className={styles["info-value"]}>
                      {currentUser && username === currentUser.username ? (currentUser.email || "N/A") 
                      : playerPageUser && playerPageUser.email ? playerPageUser.email : "N/A"}
                    </span>
                  </div>
                  <div className={styles["info-item"]}>
                    <span className={styles["info-label"]}>Last Active</span>
                    <span className={styles["info-value"]}>
                      {currentUser && username === currentUser.username ? (currentUser.last_active_at || "N/A") 
                      : playerPageUser && playerPageUser.last_active_at ? playerPageUser.last_active_at : "N/A"}
                    </span>
                  </div>
                </div>
              </div>

              <BioSection 
                bio={playerPageUser?.bio}
                isEditable={false}
                emptyMessage={currentUser && username === currentUser.username ? "No bio yet. Tell the community about yourself!" : "This user hasn't written a bio yet."}
              />

              <MatchHistory 
                userId={playerPageUser?.id || (currentUser && username === currentUser.username ? currentUser.id : null)}
                username={username}
              />
            </div>
          </div>
           : 
           <div className={styles["user-not-found"]}>
              <strong>
                <header>
                  Player with username "{username}" not found!
                </header>
                <StandardButton buttonText={"Return Home"} onClick={handleHome}/>
              </strong>
           </div>}
           <Divider />
      {(currentUser && (currentUser.username === username || currentUser.role === "Admin") && realUser) ?
            <div className={styles["profile-buttons"]}>
              <div className={styles["profile-button"]}>
                <StandardButton buttonText={"Delete Account"} onClick={handleDelete} />
              </div>
              <div className={styles["profile-button"]}>
                <StandardButton buttonText={"Edit Account"} onClick={handleEdit} />
              </div>
              {currentUser && currentUser.username === username && (
                <div className={styles["profile-button"]}>
                  <StandardButton buttonText={"Preferences"} onClick={handlePreferences} />
                </div>
              )}
            </div>
            : "" }
            {}
          </>
      )}

      {showPictureModal && (
        <div className={styles["modal-overlay"]} onClick={() => setShowPictureModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <div className={styles["modal-header"]}>
              <h2>Update Profile Picture</h2>
              <button className={styles["close-button"]} onClick={() => setShowPictureModal(false)}>×</button>
            </div>
            <div className={styles["modal-body"]}>
              <div className={styles["current-picture"]}>
                <div className={styles["preview-avatar"]}>
                  {profilePicturePreview ? (
                    <img src={profilePicturePreview} alt="Preview" />
                  ) : (currentUser && currentUser.profile_picture ? (
                    <img src={`${ASSET_URL}${currentUser.profile_picture}`} alt="Current" />
                  ) : (
                    <span>{username.charAt(0).toUpperCase()}</span>
                  ))}
                </div>
              </div>
              <div className={styles["file-upload-section"]}>
                <label htmlFor="picture-upload" className={styles["file-label"]}>
                  Choose New Picture
                </label>
                <input
                  id="picture-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className={styles["file-input-hidden"]}
                />
                {profilePicture && (
                  <div className={styles["file-name"]}>{profilePicture.name}</div>
                )}
              </div>
              <div className={styles["modal-actions"]}>
                <button
                  className={styles["cancel-button"]}
                  onClick={() => {
                    setShowPictureModal(false);
                    setProfilePicture(null);
                    setProfilePicturePreview(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className={styles["upload-button"]}
                  onClick={handleUploadPicture}
                  disabled={!profilePicture || uploadingPicture}
                >
                  {uploadingPicture ? 'Uploading...' : 'Upload'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerPage;