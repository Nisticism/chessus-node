import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { isEmail } from "validator";
import { register, login, googleLogin } from "../../actions/auth";
import { GoogleLogin } from "@react-oauth/google";
import { trackRegistration } from "../../analytics/GoogleAnalytics";
import styles from "./register.module.scss";

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

const vpassword = (value) => {
  if (value.length < 6 || value.length > 40) {
    return (
      <div className="alert alert-danger" role="alert">
        The password must be between 6 and 40 characters.
      </div>
    );
  }
};

const Register = () => {
  const form = useRef();
  const checkBtn = useRef();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [successful, setSuccessful] = useState(false);
  const [messageDisplay, setMessageDisplay] = useState(false);
  const { message } = useSelector(state => state.message);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const onChangeUsername = (e) => {
    const username = e.target.value;
    setUsername(username);
  };

  const onChangeEmail = (e) => {
    const email = e.target.value;
    setEmail(email);
  };

  const onChangePassword = (e) => {
    const password = e.target.value;
    setPassword(password);
  };

  const handleRegister = (e) => {
    e.preventDefault();
    setSuccessful(false);
    //form.current.validateAll();
    // if (checkBtn.current.context._errors.length === 0) {
    dispatch(register(username, password, email))
      .then(() => {
        setSuccessful(true);
        trackRegistration('email');
        dispatch(login(username, password))
        .then(() => {
          navigate("/profile/" + username);
        })
      })
      .catch(() => {
        setMessageDisplay(true);
        setSuccessful(false);
      });
    // }
  };

  const handleGoogleSuccess = (credentialResponse) => {
    dispatch(googleLogin(credentialResponse.credential))
      .then((data) => {
        trackRegistration('google');
        navigate(`/profile/${data.result.username}`);
      })
      .catch(() => {
        setMessageDisplay(true);
      });
  };

  const handleGoogleError = () => {
    setMessageDisplay(true);
  };

  return (
    <div className={styles["container"]}>
      <div className={styles["wrapper"]}>
        {/* <img
          src="//ssl.gstatic.com/accounts/ui/avatar_2x.png"
          alt="profile-img"
          className="profile-img-card"
        /> */}
        <form onSubmit={handleRegister} ref={form}>
          {!successful && (
            <div>
              <div className="form-group">
                <label htmlFor="username" className={styles["field-label"]}>Username</label>
                <input
                  type="text"
                  className="form-control"
                  id="username"
                  name="username"
                  value={username}
                  onChange={onChangeUsername}
                  autoComplete="username"
                  validations={[required, vusername]}
                />
              </div>
              <div className="form-group">
                <label htmlFor="email" className={styles["field-label"]}>Email</label>
                <input
                  type="email"
                  className="form-control"
                  id="email"
                  name="email"
                  value={email}
                  onChange={onChangeEmail}
                  autoComplete="email"
                  validations={[required, validEmail]}
                />
              </div>
              <div className="form-group">
                <label htmlFor="password" className={styles["field-label"]}>Password</label>
                <input
                  type="password"
                  className="form-control"
                  id="password"
                  name="password"
                  value={password}
                  onChange={onChangePassword}
                  autoComplete="new-password"
                  validations={[required, vpassword]}
                />
              </div>
              <div className="form-group">
                <button className={styles["signup-button"]}>Sign Up</button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', margin: '10px 0' }}>
                <hr style={{ flex: 1 }} />
                <span style={{ padding: '0 10px', color: 'var(--text-muted)', fontSize: '14px' }}>or</span>
                <hr style={{ flex: 1 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
                <div style={{ border: '1px solid #ccc', borderRadius: '4px', overflow: 'hidden', display: 'inline-block' }}>
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    theme="filled_black"
                    size="large"
                    text="signup_with"
                    width="320"
                  />
                </div>
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
  );
};
export default Register;