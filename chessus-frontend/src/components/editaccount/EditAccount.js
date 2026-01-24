import React, { useState, useRef, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Navigate, useParams } from "react-router-dom";
import { isEmail } from "validator";
import { edit } from "../../actions/auth";
import styles from "./edit-account.module.scss";
import NotFound from "../notfound/NotFound";
import axios from "axios";
import API_URL from "../../global/global";
import StandardButton from "../standardbutton/StardardButton";
import BioSection from "../biosection/BioSection";
// import { response } from "express";

const required = (value) => {
  if (!value) {
    return (
      <div className="alert alert-danger" role="alert">
        This field is required!
      </div>
    );
  }
};

const validEmail = (value) => {
  if (!isEmail(value)) {
    return (
      <div className="alert alert-danger" role="alert">
        This is not a valid email.
      </div>
    );
  }
};

const vusername = (value) => {
  if (value.length < 3 || value.length > 20) {
    return (
      <div className="alert alert-danger" role="alert">
        The username must be between 3 and 20 characters.
      </div>
    );
  }
};

const vFirstName = (value) => {
  if (value.length < 1 || value.length > 20) {
    return (
      <div className="alert alert-danger" role="alert">
        The first name must be between 1 and 20 characters.
      </div>
    )
  }
}

const vLastName = (value) => {
  if (value.length < 1 || value.length > 20) {
    return (
      <div className="alert alert-danger" role="alert">
        The last name must be between 1 and 20 characters.
      </div>
    )
  }
}

const vpassword = (value) => {
  if (value.length < 6 || value.length > 40) {
    return (
      <div className="alert alert-danger" role="alert">
        The password must be between 6 and 40 characters.
      </div>
    );
  }
};

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
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState(currentUser && currentUser.profile_picture ? currentUser.profile_picture : null);
  const [uploadingPicture, setUploadingPicture] = useState(false);
  const [successful, setSuccessful] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [bannerMessage, setBannerMessage] = useState("");
  const [bannerType, setBannerType] = useState("success"); // "success" or "error"
  const { message: message } = useSelector((state) => state.message);
  const { editSuccess: editSuccess } = useSelector((state) => state.authReducer);
  const { username: usernameNav } = useSelector((state) => state.authReducer.user);
  const { username: playerPageNav } = useSelector((state) => state.authReducer.playerPage ? state.authReducer.playerPage : "");
  const dispatch = useDispatch();

  const navigate = useNavigate();

  const [firstRender, setFirstRender] = useState(false);
  const { profileUsername } = useParams();
  
  // Initialize editAuth based on initial permissions to prevent NotFound flash
  const [editAuth, setEditAuth] = useState(
    currentUser.role === "Admin" || 
    (profileUsername && profileUsername === username) || 
    !profileUsername
  );

  useEffect(() => {
    if (!firstRender) {
      if (currentUser.role === "Admin" || (profileUsername && profileUsername === username)
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

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
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
      if (res.data.result.id !== currentUser.id && currentUser.role !== "Admin") {
        console.log("not admin or authorized");
      } else {
        if (currentUser.role === "Admin") {
          console.log("admin logged in, setting up editable user")
          setUserInfo(res.data.result);
          setUsername(res.data.result.username);
          setEmail(res.data.result.email);
          setFirstName(res.data.result.first_name);
          setLastName(res.data.result.last_name);
          setBio((res.data.result.bio ? res.data.result.bio : ""));
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
    if (currentUser.role === "Admin" && (editSuccess && currentUser.username !== playerPageNav)) {
      navigate(`/profile/${playerPageNav}`);
      console.log("1");
    } else if (currentUser.role === "Admin" && !editSuccess) {
      navigate(`/profile/${profileUsername}`);
      console.log("2")
    }
    else {
      navigate(`/profile/${usernameNav}`);
      console.log("3")
    }
  }

  const handleAccountUpdate = async(e) => {
    e.preventDefault();
    console.log("edit submit clicked");
    // form.current.validateAll();
    // if (checkBtn.current.context._errors.length === 0) {
      console.log("old password: " + oldPassword + " new password: " + password);
      console.log("logged in password: " + currentUser.password);
    if (currentUser.role === "Admin") {
    dispatch(edit(userInfo, username, password, email, firstName, lastName, bio, userInfo.id, currentUser.id))
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
      dispatch(edit(currentUser, username, password, email, firstName, lastName, bio, id, oldPassword))
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
          {currentUser.role === "Admin" ?
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
                <h2 className={styles["card-title"]}>Profile Picture Upload</h2>
                <div className={styles["picture-upload-container"]}>
                  <div className={styles["picture-preview"]}>
                    {profilePicturePreview ? (
                      <img src={typeof profilePicturePreview === 'string' && profilePicturePreview.startsWith('/uploads') ? `${process.env.REACT_APP_ASSET_URL || ""}${profilePicturePreview}` : profilePicturePreview} alt="Profile preview" />
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
                  <button
                    type="button"
                    onClick={() => setShowPasswordSection(true)}
                    className={styles["show-password-section-button"]}
                  >
                    🔒 Change Password
                  </button>
                ) : (
                  <>
                    <p className={styles["password-hint"]}>
                      Enter your current password and choose a new password (minimum 6 characters)
                    </p>
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
                  </>
                )}
              </div>

              <div className={styles["form-actions"]}>
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
    </>
  );
};
export default EditAccount;