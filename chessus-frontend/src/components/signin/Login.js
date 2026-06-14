import React, { useState, useRef, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { login, googleLogin } from "../../actions/auth";
import { GoogleLogin } from "@react-oauth/google";
import { trackLogin } from "../../analytics/GoogleAnalytics";
import { startLichessOAuth } from "../../utils/lichessAuth";
import { startTwitchOAuth } from "../../utils/twitchAuth";
import styles from "./login.module.scss";

const required = (value) => {
  if (!value) {
    return (
      <div className="alert alert-danger" role="alert">
        This field is required!
      </div>
    );
  }
};
const Login = (props) => {

  const form = useRef();
  const checkBtn = useRef();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { isLoggedIn } = useSelector(state => state.authReducer);
  const { message } = useSelector(state => state.message);
  const [ messageDisplay, setMessageDisplay ] = useState(false);
  const location = useLocation();
  const authMessage = location.state?.message;

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

  const dispatch = useDispatch();

  const onChangeUsername = (e) => {
    const username = e.target.value;
    setUsername(username);
  };

  const onChangePassword = (e) => {
    const password = e.target.value;
    setPassword(password);
  };

  const handleLogin = (e) => {
    e.preventDefault();
    setLoading(true);
    // form.current.validateAll();
    dispatch(login(username, password))
      .then(() => {
        trackLogin('email');
        // Hard redirect (not client-side navigate) so the destination page is
        // loaded fresh with the correct COOP/COEP headers. /login is served
        // with unsafe-none COOP/COEP for the Google Sign-In popup flow; game
        // pages need COOP same-origin so SharedArrayBuffer (and Fairy
        // Stockfish) is available. A client-side navigate() would keep the
        // no-isolation policy for the rest of the session and break the engine.
        window.location.href = `/profile/${username}`;
      })
      .catch(() => {
        setLoading(false);
        setMessageDisplay(true);
      });
  };

  const navigate = useNavigate();

  const handleSignup = () => {
    navigate('/register')
  }

  const handleGoogleSuccess = (credentialResponse) => {
    setLoading(true);
    dispatch(googleLogin(credentialResponse.credential))
      .then((data) => {
        trackLogin('google');
        // Hard redirect so the new page is loaded fresh with the correct
        // COOP policy.  Login is served without COOP (to allow the Google
        // Sign-In popup flow); game pages need COOP same-origin for
        // SharedArrayBuffer.  A client-side navigate() would keep the
        // no-COOP policy for the rest of the session.
        window.location.href = `/profile/${data.result.username}`;
      })
      .catch(() => {
        setLoading(false);
        setMessageDisplay(true);
      });
  };

  const handleGoogleError = () => {
    setMessageDisplay(true);
  };

  const handleLichessLogin = () => {
    try {
      startLichessOAuth();
    } catch (err) {
      setMessageDisplay(true);
    }
  };

  const handleTwitchLogin = () => {
    try {
      startTwitchOAuth();
    } catch (err) {
      setMessageDisplay(true);
    }
  };

  if (isLoggedIn) {
    var path=`/profile/${username}`;
    return <Navigate to={path} />;
  }

  return (
    <div className={styles["container"]}>
      <div className={styles["wrapper"]}>
        <div className={styles["card-header"]}>
          <h1 className={styles["page-title"]}>Sign In</h1>
          <p className={styles["page-subtitle"]}>Welcome back to GridGrove</p>
        </div>

        {authMessage && (
          <div className={styles["auth-message"]}>
            <div className="alert alert-info" role="alert">
              {authMessage}
            </div>
          </div>
        )}

        <form onSubmit={handleLogin} ref={form} className={styles["form"]}>
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
              validations={[required]}
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
              autoComplete="current-password"
              validations={[required]}
            />
          </div>

          <div className={styles["forgot-row"]}>
            <Link to="/forgot-password" className={styles["forgot-link"]}>
              Forgot password?
            </Link>
          </div>

          <button className={styles["login-button"]} disabled={loading}>
            {loading && <span className="spinner-border spinner-border-sm"></span>}
            <span>Sign In</span>
          </button>

          <div className={styles["divider"]}>
            <span>or</span>
          </div>

          <div className={styles["social-row"]}>
            <div className={styles["google-wrapper"]}>
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                theme="filled_black"
                size="large"
                text="signin_with"
                width="320"
              />
            </div>
          </div>

          {process.env.REACT_APP_LICHESS_CLIENT_ID && (
            <div className={styles["social-row"]}>
              <button
                type="button"
                onClick={handleLichessLogin}
                className={styles["lichess-button"]}
              >
                <img src="https://lichess.org/assets/logo/lichess-favicon-32.png" alt="Lichess" className={styles["lichess-icon"]} />
                Sign in with Lichess
              </button>
            </div>
          )}

          {process.env.REACT_APP_TWITCH_CLIENT_ID && (
            <div className={styles["social-row"]}>
              <button
                type="button"
                onClick={handleTwitchLogin}
                className={styles["twitch-button"]}
              >
                <svg className={styles["twitch-icon"]} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
                </svg>
                Sign in with Twitch
              </button>
            </div>
          )}

          {message && messageDisplay && (
            <div className={styles["message-row"]}>
              <div className="alert alert-danger" role="alert">
                {message}
              </div>
            </div>
          )}

          <button style={{ display: "none" }} ref={checkBtn} />
        </form>

        <div className={styles["signup-link"]}>
          Don't have an account?{" "}
          <Link to="/register" className={styles["signup-anchor"]}>Create one</Link>
        </div>
      </div>
    </div>
  );
};
export default Login;