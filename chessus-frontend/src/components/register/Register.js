import React, { useState, useRef, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { isEmail } from "validator";
import { register, login, googleLogin } from "../../actions/auth";
import { GoogleLogin } from "@react-oauth/google";
import { trackRegistration } from "../../analytics/GoogleAnalytics";
import { checkUsername } from "../../utils/contentModeration";
import { startLichessOAuth } from "../../utils/lichessAuth";
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
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const { message } = useSelector(state => state.message);
  const dispatch = useDispatch();

  // If this page was reached via client-side (React Router) navigation from a
  // cross-origin-isolated page (e.g. a game page that uses Fairy Stockfish),
  // force a hard reload so the server can respond with the correct unsafe-none
  // COOP/COEP headers.  Under COOP same-origin, Google Sign-In's iframe cannot
  // communicate with the parent page and shows a blank white window.
  useEffect(() => {
    if (window.crossOriginIsolated) {
      window.location.replace(window.location.href);
    }
  }, []);

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

    // Client-side username content check
    const usernameContentCheck = checkUsername(username);
    if (!usernameContentCheck.isClean) {
      setMessageDisplay(true);
      dispatch({ type: "SET_MESSAGE", payload: "This username contains inappropriate language. Please choose a different username." });
      return;
    }

    if (!agreedToTerms) {
      setMessageDisplay(true);
      dispatch({ type: "SET_MESSAGE", payload: "You must agree to the Terms and Conditions to create an account." });
      return;
    }

    //form.current.validateAll();
    // if (checkBtn.current.context._errors.length === 0) {
    dispatch(register(username, password, email))
      .then(() => {
        setSuccessful(true);
        trackRegistration('email');
        dispatch(login(username, password))
        .then(() => {
          // Hard redirect (not client-side navigate) so the destination page
          // is loaded fresh with the correct COOP/COEP headers. /register is
          // served with unsafe-none COOP/COEP for the Google Sign-In popup
          // flow; game pages need COOP same-origin so SharedArrayBuffer (and
          // Fairy Stockfish) is available. A client-side navigate() would keep
          // the no-isolation policy for the rest of the session.
          window.location.href = `/profile/${username}`;
        })
      })
      .catch(() => {
        setMessageDisplay(true);
        setSuccessful(false);
      });
    // }
  };

  const handleGoogleSuccess = (credentialResponse) => {
    if (!agreedToTerms) {
      setMessageDisplay(true);
      dispatch({ type: "SET_MESSAGE", payload: "You must agree to the Terms and Conditions to create an account." });
      return;
    }
    dispatch(googleLogin(credentialResponse.credential))
      .then((data) => {
        trackRegistration('google');
        // Hard redirect — same reason as Login.js: ensures the next page
        // is loaded with the correct COOP policy for its route.
        window.location.href = `/profile/${data.result.username}`;
      })
      .catch(() => {
        setMessageDisplay(true);
      });
  };

  const handleGoogleError = () => {
    setMessageDisplay(true);
  };

  const handleLichessSignup = () => {
    if (!agreedToTerms) {
      setMessageDisplay(true);
      dispatch({ type: "SET_MESSAGE", payload: "You must agree to the Terms and Conditions to create an account." });
      return;
    }
    try {
      startLichessOAuth();
    } catch (err) {
      setMessageDisplay(true);
    }
  };

  return (
    <div className={styles["container"]}>
      <div className={styles["wrapper"]}>
        <div className={styles["card-header"]}>
          <h1 className={styles["page-title"]}>Create Account</h1>
          <p className={styles["page-subtitle"]}>Join the GridGrove community</p>
        </div>

        <form onSubmit={handleRegister} ref={form} className={styles["form"]}>
          {!successful && (
            <div>
              <div className={styles["field-group"]}>
                <label htmlFor="username" className={styles["field-label"]}>Username</label>
                <input
                  type="text"
                  className={styles["field-input"]}
                  id="username"
                  name="username"
                  value={username}
                  onChange={onChangeUsername}
                  autoComplete="username"
                  placeholder="3–20 characters"
                  validations={[required, vusername]}
                />
              </div>
              <div className={styles["field-group"]}>
                <label htmlFor="email" className={styles["field-label"]}>Email</label>
                <input
                  type="email"
                  className={styles["field-input"]}
                  id="email"
                  name="email"
                  value={email}
                  onChange={onChangeEmail}
                  autoComplete="email"
                  placeholder="you@example.com"
                  validations={[required, validEmail]}
                />
              </div>
              <div className={styles["field-group"]}>
                <label htmlFor="password" className={styles["field-label"]}>Password</label>
                <input
                  type="password"
                  className={styles["field-input"]}
                  id="password"
                  name="password"
                  value={password}
                  onChange={onChangePassword}
                  autoComplete="new-password"
                  placeholder="6–40 characters"
                  validations={[required, vpassword]}
                />
              </div>

              <div className={styles["terms-group"]}>
                <input
                  type="checkbox"
                  id="agreeTerms"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className={styles["terms-checkbox"]}
                />
                <label htmlFor="agreeTerms" className={styles["terms-label"]}>
                  I have read and agree to the{" "}
                  <Link to="/terms" target="_blank" rel="noopener noreferrer" className={styles["terms-link"]}>
                    Terms and Conditions
                  </Link>
                </label>
              </div>

              <button className={styles["signup-button"]} disabled={!agreedToTerms}>
                Create Account
              </button>

              <div className={styles["divider"]}>
                <span>or</span>
              </div>

              <div className={styles["social-row"]}>
                <div style={!agreedToTerms ? { opacity: 0.45, pointerEvents: 'none' } : {}}>
                  <div className={styles["google-wrapper"]}>
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

              {process.env.REACT_APP_LICHESS_CLIENT_ID && (
                <div className={styles["social-row"]}>
                  <button
                    type="button"
                    onClick={handleLichessSignup}
                    className={styles["lichess-button"]}
                    disabled={!agreedToTerms}
                  >
                    <img src="https://lichess.org/assets/logo/lichess-favicon-32.png" alt="Lichess" className={styles["lichess-icon"]} />
                    Sign up with Lichess
                  </button>
                </div>
              )}
            </div>
          )}

          {message && messageDisplay && (
            <div className={styles["message-row"]}>
              <div className={ successful ? "alert alert-success" : "alert alert-danger" } role="alert">
                {message}
              </div>
            </div>
          )}

          <button style={{ display: "none" }} ref={checkBtn} />
        </form>

        <div className={styles["signin-link"]}>
          Already have an account?{" "}
          <Link to="/login" className={styles["signin-anchor"]}>Sign in</Link>
        </div>
      </div>
    </div>
  );
};
export default Register;