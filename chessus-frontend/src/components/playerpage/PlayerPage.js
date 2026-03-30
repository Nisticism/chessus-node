import React, { useState, useEffect } from "react";
import { Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./player-page.module.scss";
import { deleteUser, getUser } from "../../actions/auth";
import { clearPlayerPage } from "../../actions/users";
import { EDIT_SUCCESS } from "../../actions/types";
import StandardButton from "../standardbutton/StandardButton";
import axios from "axios";
import API_URL from "../../global/global";
import BioSection from "../biosection/BioSection";
import Divider from "../Divider/Divider";
import DonorBadge from "../DonorBadge/DonorBadge";
import MatchHistory from "../matchhistory/MatchHistory";
import OngoingGames from "../ongoinggames/OngoingGames";
import FriendsList from "../friendslist/FriendsList";
import { addFriend, removeFriend, checkFriendshipStatus, acceptFriendRequest, cancelFriendRequest, getIncomingRequests } from "../../actions/friends";
import { useSocket } from "../../contexts/SocketContext";
import DefaultAvatar from "../../assets/pieces/White-pawn.png";
// import NotFound from "../notfound/NotFound";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";

const PlayerPage = (props) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { onlineUsers } = useSelector((state) => state.friends);
  const { connected } = useSocket();
  
  const [loading, setLoading] = useState(true);
  // const [ messageDisplay, setMessageDisplay ] = useState(false);
  const dispatch = useDispatch();
  const [firstRender] = useState(false);
  // const [userInfo, setUserInfo] = useState(null);
  const [realUser, setRealUser] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  const [alertType, setAlertType] = useState(""); // "delete" or "picture"
  const [showPictureModal, setShowPictureModal] = useState(false);
  const [pictureZoomLevel, setPictureZoomLevel] = useState(1);
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState(null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [displayPictureUrl, setDisplayPictureUrl] = useState(null); // Force re-render on upload
  const [showBanner, setShowBanner] = useState(false);
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerType, setBannerType] = useState("success");
  const [friendshipStatus, setFriendshipStatus] = useState({ status: 'none', areFriends: false });
  const [checkingFriendship, setCheckingFriendship] = useState(false);
  const [incomingRequests, setIncomingRequests] = useState([]);
  // const [postDeleteUsername, setPostDeleteUsername] = useState("");
  const playerPageUser = useSelector((state) => state.authReducer.playerPage);
  
  const navigate = useNavigate();
  const location = useLocation();

  const { username: routeUsername } = useParams();
  const username = routeUsername || (currentUser ? currentUser.username : "");

  // Check if user is online
  const isUserOnline = playerPageUser && onlineUsers?.includes(playerPageUser.id);

  // Navigate to play page with challenge modal open
  const handleChallenge = () => {
    if (playerPageUser) {
      navigate('/play', { 
        state: { 
          openChallengeFor: { 
            id: playerPageUser.id, 
            username: playerPageUser.username 
          } 
        } 
      });
    }
  };

  const handleHome = () => {
    navigate("/");
  }

  /* eslint-disable react-hooks/rules-of-hooks */
  useEffect(() => {
    if (!firstRender && username) {
      setLoading(true);
      setDisplayPictureUrl(null); // Clear display picture URL when loading new profile
      dispatch(clearPlayerPage()); // Clear previous player page data
      // Always fetch fresh data from server, even for own profile
      // This ensures admin updates are visible without logout/login
      checkIfRealUser(username);
      getPlayerPage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRender, username]);

  // Handle banner message from navigation state (e.g., after profile update)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Check friendship status when viewing another user's profile
  useEffect(() => {
    const checkFriendship = async () => {
      if (currentUser && playerPageUser && playerPageUser.id !== currentUser.id) {
        setCheckingFriendship(true);
        try {
          const statusResult = await dispatch(checkFriendshipStatus(currentUser.id, playerPageUser.id));
          setFriendshipStatus(statusResult);
        } catch (error) {
          console.error("Error checking friendship:", error);
        } finally {
          setCheckingFriendship(false);
        }
      }
    };
    
    if (!loading && playerPageUser) {
      checkFriendship();
    }
  }, [currentUser, playerPageUser, loading, dispatch]);

  // Fetch incoming friend requests when viewing own profile
  useEffect(() => {
    const fetchIncomingRequests = async () => {
      if (currentUser && playerPageUser && playerPageUser.id === currentUser.id) {
        try {
          const requests = await dispatch(getIncomingRequests(currentUser.id));
          setIncomingRequests(requests || []);
        } catch (error) {
          console.error("Error fetching friend requests:", error);
        }
      }
    };
    
    if (!loading && playerPageUser) {
      fetchIncomingRequests();
    }
  }, [currentUser, playerPageUser, loading, dispatch]);


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
  /* eslint-enable react-hooks/rules-of-hooks */

  if (!routeUsername && !currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view your own profile." }} />;
  }

  const getPlayerPage = () => {
    dispatch(getUser(username)).finally(() => setLoading(false));
  }

  const handleDelete = async(e) => {
    e.preventDefault();
    if (!currentUser) return;
    
    const isAdminOrOwner = ['admin', 'owner'].includes(currentUser.role?.toLowerCase());
    
    // Show confirmation dialog
    const confirmDelete = window.confirm(
      isAdminOrOwner && currentUser.username !== username
        ? `Are you sure you want to delete the account for ${username}? This action cannot be undone.`
        : "Are you sure you want to delete your account? This action cannot be undone."
    );
    
    if (!confirmDelete) {
      return; // User cancelled
    }

    if (!isAdminOrOwner || currentUser.username === username) {
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
        
        // Wait 2 seconds to show message, then redirect to admin dashboard
        setTimeout(() => {
          navigate('/admin/dashboard');
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
    const isAdminOrOwner = ['admin', 'owner'].includes(currentUser.role?.toLowerCase());
    if (!isAdminOrOwner || currentUser.username === username) {
      navigate("/profile/edit");
    } else {
      navigate(`/profile/${username}/edit`);
    }
  }

  const handlePreferences = (e) => {
    e.preventDefault();
    navigate("/preferences");
  }

  const handleAddFriend = async () => {
    if (!currentUser || !playerPageUser) return;
    
    try {
      await dispatch(addFriend(currentUser.id, playerPageUser.id));
      setFriendshipStatus({ status: 'pending_outgoing', areFriends: false });
      setBannerMessage(`Friend request sent to ${playerPageUser.username}!`);
      setBannerType("success");
      setShowBanner(true);
    } catch (error) {
      console.error("Error sending friend request:", error);
      setBannerMessage(error.response?.data?.error || "Failed to send friend request");
      setBannerType("error");
      setShowBanner(true);
    }
  };

  const handleRemoveFriend = async () => {
    if (!currentUser || !playerPageUser) return;
    
    if (window.confirm(`Remove ${playerPageUser.username} from your friends list?`)) {
      try {
        await dispatch(removeFriend(currentUser.id, playerPageUser.id));
        setFriendshipStatus({ status: 'none', areFriends: false });
        setBannerMessage(`Removed ${playerPageUser.username} from friends`);
        setBannerType("success");
        setShowBanner(true);
      } catch (error) {
        console.error("Error removing friend:", error);
        setBannerMessage("Failed to remove friend");
        setBannerType("error");
        setShowBanner(true);
      }
    }
  };

  const handleCancelRequest = async () => {
    if (!currentUser || !playerPageUser || !friendshipStatus.requestId) return;
    
    try {
      await dispatch(cancelFriendRequest(currentUser.id, friendshipStatus.requestId));
      setFriendshipStatus({ status: 'none', areFriends: false });
      setBannerMessage(`Friend request to ${playerPageUser.username} cancelled`);
      setBannerType("success");
      setShowBanner(true);
    } catch (error) {
      console.error("Error cancelling friend request:", error);
      setBannerMessage("Failed to cancel friend request");
      setBannerType("error");
      setShowBanner(true);
    }
  };

  const handleAcceptRequest = async () => {
    if (!currentUser || !playerPageUser || !friendshipStatus.requestId) return;
    
    try {
      await dispatch(acceptFriendRequest(currentUser.id, friendshipStatus.requestId));
      setFriendshipStatus({ status: 'friends', areFriends: true });
      setBannerMessage(`You are now friends with ${playerPageUser.username}!`);
      setBannerType("success");
      setShowBanner(true);
    } catch (error) {
      console.error("Error accepting friend request:", error);
      setBannerMessage("Failed to accept friend request");
      setBannerType("error");
      setShowBanner(true);
    }
  };

  const handleAcceptIncomingRequest = async (request) => {
    if (!currentUser) return;
    
    try {
      await dispatch(acceptFriendRequest(currentUser.id, request.request_id));
      setIncomingRequests(prev => prev.filter(r => r.request_id !== request.request_id));
      setBannerMessage(`You are now friends with ${request.username}!`);
      setBannerType("success");
      setShowBanner(true);
    } catch (error) {
      console.error("Error accepting friend request:", error);
      setBannerMessage("Failed to accept friend request");
      setBannerType("error");
      setShowBanner(true);
    }
  };

  const handleDeclineIncomingRequest = async (request) => {
    if (!currentUser) return;
    
    try {
      const { declineFriendRequest } = await import("../../actions/friends");
      await dispatch(declineFriendRequest(currentUser.id, request.request_id));
      setIncomingRequests(prev => prev.filter(r => r.request_id !== request.request_id));
      setBannerMessage(`Declined friend request from ${request.username}`);
      setBannerType("success");
      setShowBanner(true);
    } catch (error) {
      console.error("Error declining friend request:", error);
      setBannerMessage("Failed to decline friend request");
      setBannerType("error");
      setShowBanner(true);
    }
  };

  const handleProfilePictureClick = () => {
    // Allow any user to view enlarged profile picture
    setShowPictureModal(true);
  }

  // Check if current user can edit the profile picture
  const canEditPicture = () => {
    if (!currentUser) return false;
    const userRole = currentUser.role?.toLowerCase();
    return currentUser.username === username || userRole === "admin" || userRole === "owner";
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
                style={{ cursor: 'pointer' }}
                title="Click to view profile picture"
              >
                <img 
                  src={displayPictureUrl || 
                       ((currentUser && username === currentUser.username && currentUser.profile_picture) || 
                        (playerPageUser && playerPageUser.username === username && playerPageUser.profile_picture))
                       ? (displayPictureUrl || `${ASSET_URL}${currentUser && username === currentUser.username ? currentUser.profile_picture : playerPageUser?.profile_picture}?t=${Date.now()}`)
                       : DefaultAvatar}
                  alt={`${username}'s profile`}
                  className={styles["profile-avatar-img"]}
                  onError={(e) => {
                    console.error('Failed to load profile picture:', e.target.src);
                    e.target.src = DefaultAvatar;
                  }}
                />
                <div className={styles["view-icon"]}>
                  <span>🔍</span>
                </div>
              </div>
              <div className={styles["profile-header-info"]}>
                <h1 className={styles["username"]}>{username}</h1>
                <div className={styles["badges-row"]}>
                  {(() => {
                    const role = (currentUser && username === currentUser.username 
                      ? currentUser.role 
                      : playerPageUser?.role)?.toLowerCase();
                    
                    // Only show the highest role
                    if (role === 'owner') {
                      return <div className={styles["role-badge-owner"]}>OWNER</div>;
                    } else if (role === 'admin') {
                      return <div className={styles["role-badge-admin"]}>ADMIN</div>;
                    }
                    // Don't show badge for regular users
                    return null;
                  })()}
                  <DonorBadge 
                    totalDonations={
                      currentUser && username === currentUser.username 
                        ? currentUser.total_donations 
                        : playerPageUser?.total_donations
                    }
                    hidden={
                      currentUser && username === currentUser.username
                        ? currentUser.hide_donation_badge
                        : playerPageUser?.hide_donation_badge
                    }
                  />
                </div>
                {/* Add Friend / Remove Friend button for other users */}
                {currentUser && playerPageUser && currentUser.id !== playerPageUser.id && (
                  <div className={styles["friend-action"]}>
                    {checkingFriendship ? (
                      <button className={styles["friend-button"]} disabled>
                        Checking...
                      </button>
                    ) : friendshipStatus.areFriends || friendshipStatus.status === 'friends' ? (
                      <>
                        <button 
                          className={`${styles["friend-button"]} ${styles["remove-friend"]}`}
                          onClick={handleRemoveFriend}
                        >
                          ✓ Friends
                        </button>
                        {isUserOnline && connected && (
                          <button 
                            className={`${styles["friend-button"]} ${styles["challenge-friend"]}`}
                            onClick={handleChallenge}
                            title="Challenge to a game"
                          >
                            ⚔️ Challenge
                          </button>
                        )}
                      </>
                    ) : friendshipStatus.status === 'pending_outgoing' ? (
                      <button 
                        className={`${styles["friend-button"]} ${styles["pending"]}`}
                        onClick={handleCancelRequest}
                        title="Click to cancel request"
                      >
                        ⏳ Request Sent
                      </button>
                    ) : friendshipStatus.status === 'pending_incoming' ? (
                      <button 
                        className={`${styles["friend-button"]} ${styles["accept"]}`}
                        onClick={handleAcceptRequest}
                      >
                        ✓ Accept Request
                      </button>
                    ) : (
                      <button 
                        className={styles["friend-button"]}
                        onClick={handleAddFriend}
                      >
                        + Add Friend
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className={styles["elo-display"]}>
                <div className={styles["elo-label"]}>ELO Rating</div>
                <div className={styles["elo-value"]}>
                  {playerPageUser?.elo ?? currentUser?.elo ?? 1000}
                </div>
              </div>
              {playerPageUser?.last_active_at && (
                <div className={styles["last-active-display"]}>
                  <span className={styles["last-active-label"]}>Last Active:</span>
                  <span className={styles["last-active-value"]}>
                    {new Date(playerPageUser.last_active_at).toLocaleDateString(undefined, {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </div>
              )}
            </div>

            <div className={styles["profile-content"]}>
              {/* Personal Information - show on own profile or when display name is enabled */}
              {currentUser && username === currentUser.username ? (
                <div className={styles["info-card"]}>
                  <h2 className={styles["card-title"]}>Personal Information</h2>
                  <div className={styles["info-grid"]}>
                    <div className={styles["info-item"]}>
                      <span className={styles["info-label"]}>First Name</span>
                      <span className={styles["info-value"]}>
                        {currentUser.first_name || "N/A"}
                      </span>
                    </div>
                    <div className={styles["info-item"]}>
                      <span className={styles["info-label"]}>Last Name</span>
                      <span className={styles["info-value"]}>
                        {currentUser.last_name || "N/A"}
                      </span>
                    </div>
                    <div className={styles["info-item"]}>
                      <span className={styles["info-label"]}>Email</span>
                      <span className={styles["info-value"]}>
                        {currentUser.email || "N/A"}
                      </span>
                    </div>
                    <div className={styles["info-item"]}>
                      <span className={styles["info-label"]}>Last Active</span>
                      <span className={styles["info-value"]}>
                        {currentUser.last_active_at 
                          ? new Date(currentUser.last_active_at).toLocaleDateString(undefined, {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>
              ) : playerPageUser?.first_name || playerPageUser?.last_name ? (
                <div className={styles["info-card"]}>
                  <h2 className={styles["card-title"]}>Display Name</h2>
                  <div className={styles["info-grid"]}>
                    {playerPageUser.first_name && (
                      <div className={styles["info-item"]}>
                        <span className={styles["info-label"]}>First Name</span>
                        <span className={styles["info-value"]}>
                          {playerPageUser.first_name}
                        </span>
                      </div>
                    )}
                    {playerPageUser.last_name && (
                      <div className={styles["info-item"]}>
                        <span className={styles["info-label"]}>Last Name</span>
                        <span className={styles["info-value"]}>
                          {playerPageUser.last_name}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              <BioSection 
                bio={playerPageUser?.bio}
                isEditable={false}
                emptyMessage={currentUser && username === currentUser.username ? "No bio yet. Tell the community about yourself!" : "This user hasn't written a bio yet."}
              />

              {/* Friend Requests - only show on own profile */}
              {currentUser && playerPageUser && currentUser.id === playerPageUser.id && incomingRequests.length > 0 && (
                <div className={styles["info-card"]}>
                  <h2 className={styles["card-title"]}>
                    Friend Requests
                    <span className={styles["request-count"]}>{incomingRequests.length}</span>
                  </h2>
                  <div className={styles["friend-requests-list"]}>
                    {incomingRequests.map((request) => (
                      <div key={request.request_id} className={styles["friend-request-item"]}>
                        <div className={styles["request-user-info"]}>
                          <img 
                            src={request.profile_picture 
                              ? `${ASSET_URL}${request.profile_picture}` 
                              : DefaultAvatar}
                            alt={request.username}
                            className={styles["request-avatar"]}
                          />
                          <div className={styles["request-details"]}>
                            <span 
                              className={styles["request-username"]}
                              onClick={() => navigate(`/profile/${request.username}`)}
                            >
                              {request.username}
                            </span>
                            <span className={styles["request-elo"]}>ELO: {request.elo || 1000}</span>
                          </div>
                        </div>
                        <div className={styles["request-actions"]}>
                          <button 
                            className={styles["accept-button"]}
                            onClick={() => handleAcceptIncomingRequest(request)}
                          >
                            Accept
                          </button>
                          <button 
                            className={styles["decline-button"]}
                            onClick={() => handleDeclineIncomingRequest(request)}
                          >
                            Decline
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles["info-card"]}>
                <h2 className={styles["card-title"]}>Friends</h2>
                <FriendsList 
                  userId={playerPageUser?.id || (currentUser && username === currentUser.username ? currentUser.id : null)}
                  showOnlineOnly={false}
                />
              </div>

              <div className={styles["info-card"]}>
                <h2 className={styles["card-title"]}>Ongoing Games</h2>
                <OngoingGames
                  userId={playerPageUser?.id || (currentUser && username === currentUser.username ? currentUser.id : null)}
                  currentUserId={currentUser?.id}
                />
              </div>

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
      {(currentUser && (currentUser.username === username || currentUser.role?.toLowerCase() === "admin" || currentUser.role?.toLowerCase() === "owner") && realUser) ?
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
        <div className={styles["modal-overlay"]} onClick={() => { setShowPictureModal(false); setPictureZoomLevel(1); }}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
            <div className={styles["modal-header"]}>
              <h2>{username}'s Profile Picture</h2>
              <button className={styles["close-button"]} onClick={() => { setShowPictureModal(false); setPictureZoomLevel(1); }}>×</button>
            </div>
            <div className={styles["modal-body"]}>
              <div className={styles["enlarged-picture"]} style={{ overflow: pictureZoomLevel > 1 ? 'auto' : 'visible' }}>
                <div className={styles["picture-container"]}>
                  <img 
                    src={profilePicturePreview || displayPictureUrl || 
                         ((currentUser && username === currentUser.username && currentUser.profile_picture) || 
                          (playerPageUser && playerPageUser.username === username && playerPageUser.profile_picture))
                         ? (profilePicturePreview || displayPictureUrl || `${ASSET_URL}${currentUser && username === currentUser.username ? currentUser.profile_picture : playerPageUser?.profile_picture}?t=${Date.now()}`)
                         : DefaultAvatar}
                    alt={`${username}'s profile`}
                    className={styles["enlarged-picture-img"]}
                    style={{ 
                      transform: `scale(${pictureZoomLevel})`,
                      transformOrigin: 'center center',
                      minWidth: pictureZoomLevel > 1 ? '400px' : 'auto',
                      minHeight: pictureZoomLevel > 1 ? '400px' : 'auto'
                    }}
                    onError={(e) => {
                      e.target.src = DefaultAvatar;
                    }}
                  />
                  <div className={styles["zoom-controls"]}>
                    <button 
                      className={styles["zoom-button"]}
                      onClick={() => setPictureZoomLevel(prev => Math.min(prev + 0.5, 4))}
                      title="Zoom In"
                    >
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                        <path d="M12 10h-2v2H9v-2H7V9h2V7h1v2h2v1z"/>
                      </svg>
                    </button>
                    {pictureZoomLevel > 1 && (
                      <button 
                        className={styles["zoom-button"]}
                        onClick={() => setPictureZoomLevel(prev => Math.max(prev - 0.5, 1))}
                        title="Zoom Out"
                      >
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                          <path d="M7 9h5v1H7z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              
              {canEditPicture() && (
                <>
                  <div className={styles["upload-divider"]}>
                    <span>Change Picture</span>
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
                        setPictureZoomLevel(1);
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
                </>
              )}
              
              {!canEditPicture() && (
                <div className={styles["modal-actions"]}>
                  <button
                    className={styles["cancel-button"]}
                    onClick={() => { setShowPictureModal(false); setPictureZoomLevel(1); }}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PlayerPage;