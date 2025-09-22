import React, { useState, useRef, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import Form from "react-validation/build/form";
import Input from "react-validation/build/input";
import CheckButton from "react-validation/build/button";
import { useNavigate, Navigate, useParams } from "react-router-dom";
import { isEmail } from "validator";
import { edit } from "../../actions/auth";
import { clearMessage } from "../../actions/message.js";
import styles from "./edit-account.module.scss";
import NotFound from "../notfound/NotFound";
import axios from "axios";

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

  const { user: currentUser } = useSelector((state) => state.auth);
  const [userInfo, setUserInfo] = useState(null);

  const form = useRef();
  const checkBtn = useRef();

  const [username, setUsername] = useState(currentUser && currentUser.username ? currentUser.username : "");
  const [email, setEmail] = useState(currentUser && currentUser.email ? currentUser.email : "");
  const [password, setPassword] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [firstName, setFirstName] = useState(currentUser && currentUser.first_name ? currentUser.first_name : "");
  const [lastName, setLastName] = useState(currentUser && currentUser.last_name ? currentUser.last_name : "");
  const [successful, setSuccessful] = useState(false);
  const [messageDisplay, setMessageDisplay] = useState(true);
  const { message } = useSelector(state => state.message);
  const dispatch = useDispatch();

  const navigate = useNavigate();

  const [firstRender, setFirstRender] = useState(false);
  const [realUser, setRealUser] = useState(false);
  const [editAuth, setEditAuth] = useState(false);

  const { profileUsername } = useParams();

    useEffect(() => {
    if (!firstRender) {
      if (currentUser.role === "Admin" || (profileUsername && profileUsername === username)
      || !profileUsername) {
        setEditAuth(true);
      }
    if (profileUsername) {
      console.log(profileUsername);
      checkIfRealUser(profileUsername);
    }
      dispatch(clearMessage());
      setFirstRender(true);
    }
  }, [firstRender]);

  if (!currentUser) {
    return <Navigate to="/login" />;
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

  const checkIfRealUser = (username) => {
    console.log(username);
    axios.get('http://localhost:3001/user', 
     {params: { username: username}})
    .then (res => {
        // setUserInfo(currentUser);
      if (res.data.result.id != currentUser.id && currentUser.role !== "Admin") {
        console.log("not admin or authorized");
        // display not found
      } else {
        if (currentUser.role === "Admin") {
          setUserInfo(res.data.result);
          setUsername(res.data.result.username);
          setEmail(res.data.result.email);
          setFirstName(res.data.result.first_name);
          setLastName(res.data.result.last_name);
          setRealUser(true);
        }
      }
    })
    .catch(
      err => {
        setRealUser(false);
        console.log(err);
    })
  }

  const handleAccountUpdate = (e) => {
    e.preventDefault();
    console.log("edit submit clicked");
    setSuccessful(false);
    // form.current.validateAll();
    // if (checkBtn.current.context._errors.length === 0) {
      console.log("old password: " + oldPassword + " new password: " + password);
      console.log("logged in password: " + currentUser.password);
    if (currentUser.role === "Admin") {
      // console.log ("userInfo username: " + userInfo.username);
      // console.log("userInfo first name: " + userInfo.first_name);
      // console.log ("userInfo last_name: " + userInfo.last_name);
      // console.log("userInfo email: " + userInfo.email);
      // console.log("username var: " + username);
      // console.log("email var: " + email);
      // console.log("firstName var: " + firstName);
      // console.log("lastName var: " + lastName);
      // console.log("id of user: " + userInfo.id);
    dispatch(edit(userInfo, username, password, email, firstName, lastName, userInfo.id, currentUser.id))
      .then(() => {
        setSuccessful(true)
        .then(() => {
          console.log("navigating to profile")
          navigate("/profile/" + username);
        })
      })
      .catch(() => {
        setMessageDisplay(true);
        setSuccessful(false);
      });
    }
    else {
      console.log(id);
      dispatch(edit(currentUser, username, password, email, firstName, lastName, id))
      .then(() => {
        setSuccessful(true)
        .then(() => {
          console.log("navigating to profile")
          navigate("/profile/" + username);
        })
      })
      .catch(() => {
        setMessageDisplay(true);
        setSuccessful(false);
      });
    }
    // }
  };

  return (
    <>
      { editAuth ? 
      <div className={styles["container"]}>
        <div className={styles["wrapper"]}>
          <div>
            {currentUser.role === "Admin" ?
            <h1 className={styles["account-info-header"]}>
              Account Information For {userInfo && userInfo.username ? userInfo.username : ""}
              </h1>
              :
            <h1 className={styles["account-info-header"]}>
              Your Account Information
            </h1>
              }
          </div>
          {/* <img
            src="//ssl.gstatic.com/accounts/ui/avatar_2x.png"
            alt="profile-img"
            className="profile-img-card"
          /> */}
          <form onSubmit={handleAccountUpdate} ref={form}>
            {!successful && (
              <div>
                <div className="form-group">
                  <label htmlFor="username" className={styles["field-label"]}>Username</label>
                  <input
                    type="text"
                    className="form-control"
                    name="username"
                    value={username}
                    onChange={onChangeUsername}
                    validations={[required, vusername]}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="email" className={styles["field-label"]}>Email</label>
                  <input
                    type="email"
                    className="form-control"
                    name="email"
                    value={email}
                    onChange={onChangeEmail}
                    validations={[required, validEmail]}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="firstName" className={styles["field-label"]}>First Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="first_name"
                    value={firstName}
                    onChange={onChangeFirstName}
                    validations={[required, vFirstName]}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="lastName" className={styles["field-label"]}>Last Name</label>
                  <input
                    type="text"
                    className="form-control"
                    name="last_name"
                    value={lastName}
                    onChange={onChangeLastName}
                    validations={[required, vLastName]}
                  />
                </div>
                <div className={styles["current-new-password-message-container"]}>

                  <div className={styles["current-new-password-message"]}><i>Only enter your current and new password if you would like to change your password.</i></div>
                </div>
                <div className="form-group">
                  <label htmlFor="password" className={styles["field-label"]}>Current Password</label>
                  <input
                    type="password"
                    className="form-control"
                    name="password"
                    value={oldPassword}
                    onChange={onChangeOldPassword}
                    validations={[required, vpassword]}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="password" className={styles["field-label"]}>New Password</label>
                  <input
                    type="password"
                    className="form-control"
                    name="password"
                    value={password}
                    onChange={onChangePassword}
                    validations={[required, vpassword]}
                  />
                </div>
                <div className="form-group">
                  <button className={styles["update-button"]}>Update Account</button>
                </div>
              </div>
            )}
            {message && messageDisplay && (
              <div className="form-group">
                <div className={ successful ? "alert alert-success" : "alert alert-danger" } role="alert">
                  {message}
                </div>
              </div>
            )}
            <button style={{ display: "none" }} ref={checkBtn} />
          </form>
        </div>
      </div>
      : <NotFound/> }
    </>
  );
};
export default EditAccount;