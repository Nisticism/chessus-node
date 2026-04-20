import React, { useState, useRef, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Navigate, useParams } from "react-router-dom";
import { edit, deleteUser } from "../../actions/auth";
import styles from "./edit-account.module.scss";
import NotFound from "../notfound/NotFound";
import axios from "axios";
import API_URL from "../../global/global";
import StandardButton from "../standardbutton/StandardButton";
import BioSection from "../biosection/BioSection";
import AuthService from "../../services/auth.service";
import ValidationWarningModal from "../common/ValidationWarningModal";

const USERNAME_MAX = 20;
const EMAIL_MAX = 50;
const NAME_MAX = 50;
const BIO_MAX = 500;

const EditAccount = (props) => {

  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [userInfo, setUserInfo] = useState(null);

  const form = useRef();
  const checkBtn = useRef();

  const [username, setUsername] = useState(currentUser && currentUser.username ? currentUser.username : "");
  const [email, setEmail] = useState(currentUser && currentUser.email ? currentUser.email : "");
  const [password, setPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [firstName, setFirstName] = useState(currentUser && currentUser.first_name ? currentUser.first_name : "");
  const [lastName, setLastName] = useState(currentUser && currentUser.last_name ? currentUser.last_name : "");
  const [bio, setBio] = useState(currentUser && currentUser.bio ? currentUser.bio : "");
  const [chessComUsername, setChessComUsername] = useState(currentUser && currentUser.chess_com_username ? currentUser.chess_com_username : "");
  const [lichessUsername, setLichessUsername] = useState(currentUser && currentUser.lichess_username ? currentUser.lichess_username : "");
  const [showDisplayName, setShowDisplayName] = useState(currentUser && currentUser.show_display_name ? true : false);
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState(currentUser && currentUser.profile_picture ? currentUser.profile_picture : null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [successful] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [sendingResetEmail, setSendingResetEmail] = useState(false);
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerType, setBannerType] = useState("success"); // "success" or "error"
  const { message } = useSelector((state) => state.message);
  const { editSuccess } = useSelector((state) => state.authReducer);
  const { username: usernameNav } = useSelector((state) => state.authReducer.user);
  const { username: playerPageNav } = useSelector((state) => state.authReducer.playerPage ? state.authReducer.playerPage : "");
  const dispatch = useDispatch();

  const navigate = useNavigate();

  const [firstRender, setFirstRender] = useState(false);
  const { profileUsername } = useParams();
  
  // Initialize editAuth based on initial permissions to prevent NotFound flash
  const isAdminOrOwner = ['admin', 'owner'].includes(currentUser.role?.toLowerCase());

  const [editAuth, setEditAuth] = useState(
    isAdminOrOwner || 
    (profileUsername && profileUsername === username) || 
    !profileUsername
  );

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!firstRender) {
      if (isAdminOrOwner || (profileUsername && profileUsername === username)
      || !profileUsername) {
        setEditAuth(true);
      } else {
        setEditAuth(false);
      }
    if (profileUsername) {
      console.log(profileUsername);
      checkIfRealUser(profileUsername);
    }
      setFirstRender(true);
    }
  }, [firstRender]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to edit your profile." }} />;
  }

  const id = currentUser.id;

  const onChangeUsername = (e) => {
    const username = e.target.value;
    setUsername(username);
  };

  const onChangeEmail = (e) => {
    const email = e.target.value;
    setEmail(email);
  };

  const onChangeFirstName = (e) => {
    const first_name = e.target.value;
    setFirstName(first_name);
  }

  const onChangeLastName = (e) => {
    const last_name = e.target.value;
    setLastName(last_name);
  }

  const onChangePassword = (e) => {
    const password = e.target.value;
    setPassword(password);
  };

  const onChangeOldPassword = (e) => {
    const oldPassword = e.target.value;
    setOldPassword(oldPassword);
  }

  const handleSendResetEmail = async () => {
    if (!email) return;
    setSendingResetEmail(true);
    try {
      await AuthService.forgotPassword(email);
      setBannerMessage("Password reset link sent to your email");
      setBannerType("success");
      setShowBanner(true);
    } catch (err) {
      setBannerMessage(err.response?.data?.message || "Failed to send reset email");
      setBannerType("error");
      setShowBanner(true);
    }
    setSendingResetEmail(false);
  };

  const onChangeProfilePicture = (e) => {
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

  const handleProfilePictureUpload = async () => {
    if (!profilePicture) {
      return;
    }

    setUploadingPicture(true);
    const formData = new FormData();
    formData.append('profile_picture', profilePicture);
    formData.append('user_id', userInfo ? userInfo.id : currentUser.id);

    try {
      const response = await axios.post(API_URL + 'profile/upload-picture', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.data.success && response.data.user) {
        // Update user in localStorage if it's the current user
        if (!userInfo || userInfo.id === currentUser.id) {
          const user = JSON.parse(localStorage.getItem('user'));
          const updatedUser = { ...user, profile_picture: response.data.profile_picture };
          localStorage.setItem('user', JSON.stringify(updatedUser));
        }
        
        setProfilePicturePreview(response.data.profile_picture);
        alert('Profile picture uploaded successfully!');
        setProfilePicture(null);
      }
    } catch (error) {
      console.error('Error uploading profile picture:', error);
      alert('Failed to upload profile picture');
    } finally {
      setUploadingPicture(false);
    }
  }

  const checkIfRealUser = (username) => {
    console.log(username);
    axios.get(API_URL + 'user', 
     {params: { username: username}})
    .then (res => {
      if (res.data.result.id !== currentUser.id && !isAdminOrOwner) {
        console.log("not admin or authorized");
      } else {
        if (isAdminOrOwner) {
          console.log("admin logged in, setting up editable user")
          setUserInfo(res.data.result);
          setUsername(res.data.result.username);
          setEmail(res.data.result.email);
          setFirstName(res.data.result.first_name);
          setLastName(res.data.result.last_name);
          setBio((res.data.result.bio ? res.data.result.bio : ""));
          setChessComUsername(res.data.result.chess_com_username || "");
          setLichessUsername(res.data.result.lichess_username || "");
          setShowDisplayName(res.data.result.show_display_name ? true : false);
        }
      }
    })
    .catch(
      err => {
        console.log(err);
        navigate(`/profile/${username}`);
    })
  }

  const handleViewProfile = () => {
    if (isAdminOrOwner && (editSuccess && currentUser.username !== playerPageNav)) {
      navigate(`/profile/${playerPageNav}`);
      console.log("1");
    } else if (isAdminOrOwner && !editSuccess) {
      navigate(`/profile/${profileUsername}`);
      console.log("2")
    }
    else {
      navigate(`/profile/${usernameNav}`);
      console.log("3")
    }
  }

  const handleDeleteAccount = async () => {
    const targetUsername = profileUsername || currentUser.username;
    const isAdminDeletingOther = ['admin', 'owner'].includes(currentUser.role?.toLowerCase()) && targetUsername !== currentUser.username;

    const confirmed = window.confirm(
      isAdminDeletingOther
        ? `Are you sure you want to delete the account for ${targetUsername}? This action cannot be undone.`
        : "Are you sure you want to delete your account? This action cannot be undone."
    );
    if (!confirmed) return;

    try {
      if (isAdminDeletingOther) {
        await dispatch(deleteUser(targetUsername, currentUser.id));
        setBannerMessage(`Account for ${targetUsername} has been deleted.`);
        setBannerType("success");
        setTimeout(() => navigate('/admin/dashboard'), 2000);
      } else {
        await dispatch(deleteUser(currentUser.username));
        navigate('/register');
      }
    } catch {
      setBannerMessage("Failed to delete account.");
      setBannerType("error");
    }
  };

  const handlePasswordOnly = async () => {
    const warnings = [];
    if (!oldPassword) warnings.push("Current password is required.");
    if (!password) warnings.push("New password is required.");
    else if (password.length < 8) warnings.push("New password must be at least 8 characters.");
    else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) warnings.push("New password must contain at least one uppercase letter, one lowercase letter, and one number.");
    if (warnings.length > 0) {
      setValidationWarnings(warnings);
      return;
    }

    setUpdatingPassword(true);
    try {
      await AuthService.changePassword(oldPassword, password);
      setPassword("");
      setOldPassword("");
      setShowPasswordSection(false);
      setBannerMessage("Password updated successfully");
      setBannerType("success");
      setShowBanner(true);
    } catch (error) {
      const msg = error.response?.data?.message || "Failed to update password.";
      setBannerMessage(msg);
      setBannerType("error");
      setShowBanner(true);
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleAccountUpdate = async(e) => {
    e.preventDefault();
    console.log("edit submit clicked");

    const warnings = [];
    if (!username || username.trim().length === 0) warnings.push("Username is required.");
    else if (username.length < 3) warnings.push("Username must be at least 3 characters.");
    else if (username.length > USERNAME_MAX) warnings.push(`Username must be ${USERNAME_MAX} characters or fewer.`);
    else if (!/^[a-zA-Z0-9_-]+$/.test(username)) warnings.push("Username can only contain letters, numbers, underscores, and hyphens.");
    // Waive email requirement for Lichess OAuth users (Lichess API does not expose emails)
    const editTarget = userInfo || currentUser;
    const isLichessUser = !!(editTarget && editTarget.lichess_id);
    if (!isLichessUser) {
      if (!email || email.trim().length === 0) warnings.push("Email is required.");
      else if (email.length > EMAIL_MAX) warnings.push(`Email must be ${EMAIL_MAX} characters or fewer.`);
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warnings.push("Please provide a valid email address.");
    } else if (email && email.trim().length > 0) {
      if (email.length > EMAIL_MAX) warnings.push(`Email must be ${EMAIL_MAX} characters or fewer.`);
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) warnings.push("Please provide a valid email address.");
    }
    if (firstName && firstName.length > NAME_MAX) warnings.push(`First name must be ${NAME_MAX} characters or fewer.`);
    if (lastName && lastName.length > NAME_MAX) warnings.push(`Last name must be ${NAME_MAX} characters or fewer.`);
    if (bio && bio.length > BIO_MAX) warnings.push(`Bio must be ${BIO_MAX} characters or fewer.`);
    const PROFILE_USERNAME_PATTERN = /^[A-Za-z0-9_.-]{1,50}$/;
    if (chessComUsername && chessComUsername.trim().length > 0 && !PROFILE_USERNAME_PATTERN.test(chessComUsername.trim())) {
      warnings.push("Chess.com username can only contain letters, numbers, underscores, hyphens, and periods (max 50 chars).");
    }
    if (lichessUsername && lichessUsername.trim().length > 0 && !PROFILE_USERNAME_PATTERN.test(lichessUsername.trim())) {
      warnings.push("Lichess username can only contain letters, numbers, underscores, hyphens, and periods (max 50 chars).");
    }
    if (password && password.length > 0) {
      if (!oldPassword) warnings.push("Current password is required to change password.");
      if (password.length < 8) warnings.push("New password must be at least 8 characters.");
      else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) warnings.push("New password must contain at least one uppercase letter, one lowercase letter, and one number.");
    }
    if (warnings.length > 0) {
      setValidationWarnings(warnings);
      return;
    }

    // form.current.validateAll();
    // if (checkBtn.current.context._errors.length === 0) {
      console.log("old password: " + oldPassword + " new password: " + password);
      console.log("logged in password: " + currentUser.password);
    if (isAdminOrOwner) {
    dispatch(edit(userInfo, username, password, email, firstName, lastName, bio, userInfo.id, currentUser.id, null, showDisplayName, chessComUsername, lichessUsername))
      .then(() => {
        console.log("user updated by adimn from the editaccount.js page")
        // Navigate to the edited user's profile with success state
        navigate(`/profile/${username}`, { 
          state: { 
            showBanner: true, 
            bannerMessage: "Profile updated successfully", 
            bannerType: "success" 
          } 
        });      })
      .catch((error) => {
        console.log(error);
        // Show error banner
        setBannerMessage(message || "Failed to update profile. Please try again.");
        setBannerType("error");
        setShowBanner(true);
      });
    }
    else {
      console.log(id);
      dispatch(edit(currentUser, username, password, email, firstName, lastName, bio, id, null, oldPassword, showDisplayName, chessComUsername, lichessUsername))
        .then(() => {
          console.log("user updated from the editaccount.js page")
          // Clear password fields after successful update
          setPassword("");
          setOldPassword("");
          setShowPasswordSection(false);
          // Navigate to profile with success state
          navigate(`/profile/${username}`, { 
            state: { 
              showBanner: true, 
              bannerMessage: "Profile updated successfully", 
              bannerType: "success" 
            } 
          });
        })
      .catch((error) => {
        console.log(error);
        // Show error banner
        setBannerMessage(message || "Failed to update profile. Please try again.");
        setBannerType("error");
        setShowBanner(true);
      });
    }
    // }
  };

  return (
    <>
      { editAuth ? 
      <div className={styles["edit-account-container"]}>
        {/* Banner Message */}
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
        <div className={styles["edit-account-header"]}>
          {isAdminOrOwner ?
            <h1>Edit Account: {userInfo && userInfo.username ? userInfo.username : ""}</h1>
            :
            <h1>Edit Your Account</h1>
          }
          <p className={styles["subtitle"]}>Update your personal information and preferences</p>
        </div>

        <form onSubmit={handleAccountUpdate} ref={form} className={styles["modern-form"]}>
          {!successful && (
            <>
              <div className={styles["form-card"]}>
                <h2 className={styles["card-title"]}>Personal Information</h2>
                <div className={styles["form-grid"]}>
                  <div className={styles["form-group-modern"]}>
                    <label htmlFor="username">Username</label>
                    <input
                      type="text"
                      name="username"
                      value={username}
                      onChange={onChangeUsername}
                      placeholder="Enter username"
                      maxLength={USERNAME_MAX}
                    />
                  </div>
                  <div className={styles["form-group-modern"]}>
                    <label htmlFor="email">Email Address</label>
                    <input
                      type="email"
                      name="email"
                      value={email}
                      onChange={onChangeEmail}
                      placeholder="Enter email"
                      maxLength={EMAIL_MAX}
                    />
                  </div>
                  <div className={styles["form-group-modern"]}>
                    <label htmlFor="firstName">First Name</label>
                    <input
                      type="text"
                      name="first_name"
                      value={firstName}
                      onChange={onChangeFirstName}
                      placeholder="Enter first name"
                      maxLength={NAME_MAX}
                    />
                  </div>
                  <div className={styles["form-group-modern"]}>
                    <label htmlFor="lastName">Last Name</label>
                    <input
                      type="text"
                      name="last_name"
                      value={lastName}
                      onChange={onChangeLastName}
                      placeholder="Enter last name"
                      maxLength={NAME_MAX}
                    />
                  </div>
                </div>
              </div>

              <BioSection 
                bio={bio}
                isEditable={true}
                onBioChange={setBio}
                wrapperClassName={styles["form-card"]}
              />

              <div className={styles["form-card"]}>
                <h2 className={styles["card-title"]}>Connected Accounts</h2>
                <p style={{ color: 'var(--text-dim, #888)', fontSize: '0.875em', marginTop: 0, marginBottom: 16 }}>
                  Link your chess.com and lichess.org profiles. These will appear on your public profile.
                </p>
                <div className={styles["form-grid"]}>
                  <div className={styles["form-group-modern"]}>
                    <label htmlFor="chessComUsername">Chess.com Username</label>
                    <input
                      type="text"
                      name="chess_com_username"
                      value={chessComUsername}
                      onChange={(e) => setChessComUsername(e.target.value)}
                      placeholder="e.g. magnuscarlsen"
                      maxLength={50}
                      autoComplete="off"
                    />
                  </div>
                  <div className={styles["form-group-modern"]}>
                    <label htmlFor="lichessUsername">Lichess.org Username</label>
                    <input
                      type="text"
                      name="lichess_username"
                      value={lichessUsername}
                      onChange={(e) => setLichessUsername(e.target.value)}
                      placeholder="e.g. DrNykterstein"
                      maxLength={50}
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>

              <div className={styles["form-card"]}>
                <h2 className={styles["card-title"]}>Privacy Settings</h2>
                <div className={styles["toggle-setting"]}>
                  <label className={styles["toggle-label"]}>
                    <span>Display name on profile</span>
                    <p className={styles["toggle-description"]}>
                      When enabled, your first and last name will be visible to other players on your profile page.
                    </p>
                  </label>
                  <button
                    type="button"
                    className={`${styles["toggle-switch"]} ${showDisplayName ? styles["toggle-active"] : ""}`}
                    onClick={() => setShowDisplayName(!showDisplayName)}
                    aria-label="Toggle display name visibility"
                  >
                    <span className={styles["toggle-knob"]} />
                  </button>
                </div>
              </div>

              <div className={styles["form-card"]}>
                <h2 className={styles["card-title"]}>Profile Picture Upload</h2>
                <div className={styles["picture-upload-container"]}>
                  <div className={styles["picture-preview"]}>
                    {profilePicturePreview ? (
                      <img src={typeof profilePicturePreview === 'string' && profilePicturePreview.startsWith('/uploads') ? `${process.env.REACT_APP_ASSET_URL || ""}${profilePicturePreview}` : profilePicturePreview} alt="Profile preview" loading="lazy" />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '3rem',
                        color: '#ffffff'
                      }}>
                        {currentUser.username[0].toUpperCase()}
                      </div>
                    )}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={onChangeProfilePicture}
                    className={styles["file-input"]}
                  />
                  {profilePicture && (
                    <button
                      type="button"
                      onClick={handleProfilePictureUpload}
                      disabled={uploadingPicture}
                      className={styles["upload-picture-button"]}
                    >
                      {uploadingPicture ? 'Uploading...' : 'Upload Picture'}
                    </button>
                  )}
                </div>
              </div>

              <div className={styles["form-card"]}>
                <h2 className={styles["card-title"]}>Security</h2>
                {!showPasswordSection ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '300px' }}>
                    <button
                      type="button"
                      onClick={() => setShowPasswordSection(true)}
                      className={styles["show-password-section-button"]}
                    >
                      🔒 Change Password
                    </button>
                    <button
                      type="button"
                      onClick={handleSendResetEmail}
                      disabled={sendingResetEmail}
                      className={styles["reset-email-button"]}
                    >
                      {sendingResetEmail ? '📧 Sending...' : '📧 Send Password Reset Email'}
                    </button>
                  </div>
                ) : (
                  <>
                    <p className={styles["password-hint"]}>
                      Enter your current password and choose a new password.
                    </p>
                    <div className={styles["password-requirements"]}>
                      <span className={styles["requirements-label"]}>Password requirements:</span>
                      <ul>
                        <li className={password.length >= 8 ? styles["req-met"] : ""}>At least 8 characters</li>
                        <li className={/[A-Z]/.test(password) ? styles["req-met"] : ""}>At least one uppercase letter (A-Z)</li>
                        <li className={/[a-z]/.test(password) ? styles["req-met"] : ""}>At least one lowercase letter (a-z)</li>
                        <li className={/\d/.test(password) ? styles["req-met"] : ""}>At least one number (0-9)</li>
                      </ul>
                    </div>
                    <div className={styles["form-grid"]}>
                      <div className={styles["form-group-modern"]}>
                        <label htmlFor="oldPassword">Current Password</label>
                        <div className={styles["password-input-wrapper"]}>
                          <input
                            type={showOldPassword ? "text" : "password"}
                            name="oldPassword"
                            value={oldPassword}
                            onChange={onChangeOldPassword}
                            placeholder="Enter current password"
                            autoComplete="off"
                          />
                          <button
                            type="button"
                            className={styles["password-toggle"]}
                            onClick={() => setShowOldPassword(!showOldPassword)}
                            tabIndex="-1"
                          >
                            {showOldPassword ? "👁️" : "👁️‍🗨️"}
                          </button>
                        </div>
                      </div>
                      <div className={styles["form-group-modern"]}>
                        <label htmlFor="password">New Password</label>
                        <div className={styles["password-input-wrapper"]}>
                          <input
                            type={showNewPassword ? "text" : "password"}
                            name="password"
                            value={password}
                            onChange={onChangePassword}
                            placeholder="Enter new password"
                            autoComplete="new-password"
                          />
                          <button
                            type="button"
                            className={styles["password-toggle"]}
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            tabIndex="-1"
                          >
                            {showNewPassword ? "👁️" : "👁️‍🗨️"}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className={styles["password-action-buttons"]}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPasswordSection(false);
                          setPassword("");
                          setOldPassword("");
                        }}
                        className={styles["cancel-password-button"]}
                      >
                        Cancel Password Change
                      </button>
                      <button
                        type="button"
                        onClick={handlePasswordOnly}
                        disabled={updatingPassword || !oldPassword || !password}
                        className={styles["update-password-button"]}
                      >
                        {updatingPassword ? 'Updating...' : 'Update Password'}
                      </button>
                    </div>
                  </>
                )}
              </div>

              <div className={styles["form-actions"]}>
                <button
                  type="button"
                  className={styles["delete-account-btn"]}
                  onClick={handleDeleteAccount}
                >
                  Delete Account
                </button>
                <StandardButton buttonType="submit" buttonText="Update Account" />
                <StandardButton buttonType="button" buttonText="View Profile" onClick={handleViewProfile} />
              </div>
            </>
          )}

          {message && (
            <div className={styles["message-alert"]}>
              <div className={editSuccess ? styles["alert-success"] : styles["alert-error"]}>
                {message}
              </div>
            </div>
          )}
          <button style={{ display: "none" }} ref={checkBtn} />
        </form>
      </div>
      : <NotFound/> }
      <ValidationWarningModal warnings={validationWarnings} onClose={() => setValidationWarnings(null)} />
    </>
  );
};
export default EditAccount;