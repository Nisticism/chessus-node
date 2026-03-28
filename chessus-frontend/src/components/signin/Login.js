import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { login, googleLogin } from "../../actions/auth";
import { GoogleLogin } from "@react-oauth/google";
import { trackLogin } from "../../analytics/GoogleAnalytics";
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
        navigate(`/profile/${username}`);
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
        navigate(`/profile/${data.result.username}`);
      })
      .catch(() => {
        setLoading(false);
        setMessageDisplay(true);
      });
  };

  const handleGoogleError = () => {
    setMessageDisplay(true);
  };

  if (isLoggedIn) {
    var path=`/profile/${username}`;
    return <Navigate to={path} />;
  }

  return (
    <div className={styles["main"]}>
      <div className={styles["wrapper"]}>
        {/* <img
          src="//ssl.gstatic.com/accounts/ui/avatar_2x.png"
          alt="profile-img"
          className="profile-img-card"
        /> */}
        {authMessage && (
          <div className={styles["form-group"]}>
            <div className="alert alert-info" role="alert">
              {authMessage}
            </div>
          </div>
        )}
        <form onSubmit={handleLogin} ref={form}>
          <div className={styles["form-group"]}>
            <label htmlFor="username" className={styles["field-label"]}>Username: </label>
            <input
              type="text"
              className={styles["form-control"]}
              id="username"
              name="username"
              value={username}
              onChange={onChangeUsername}
              autoComplete="username"
              validations={[required]}
            />
          </div>
          <div className={styles["form-group"]}>
            <label htmlFor="password" className={styles["field-label"]}>Password: </label>
            <input
              type="password"
              className="form-control"
              id="password"
              name="password"
              value={password}
              onChange={onChangePassword}
              autoComplete="current-password"
              validations={[required]}
            />
          </div>
          <div className={styles["form-group"]}>
            <button className={styles["login-button"]} disabled={loading}>
              {loading && (
                <span className="spinner-border spinner-border-sm"></span>
              )}
              <span>Login</span>
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: '10px', marginBottom: '10px' }}>
            <Link to="/forgot-password" style={{ color: 'var(--accent-blue)', textDecoration: 'none', fontSize: '14px' }}>
              Forgot Password?
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', margin: '10px 0' }}>
            <hr style={{ flex: 1 }} />
            <span style={{ padding: '0 10px', color: 'var(--text-muted)', fontSize: '14px' }}>or</span>
            <hr style={{ flex: 1 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', margin: '10px 0' }}>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              theme="filled_black"
              size="large"
              text="signin_with"
              width="320"
            />
          </div>
          {message && messageDisplay && (
            <div className={styles["form-group"]}>
              <div className="alert alert-danger" role="alert">
                {message}
              </div>
            </div>
          )}
          <button style={{ display: "none" }} ref={checkBtn} />
        </form>
        <hr />
        <h2>Don't have an account?</h2>
        <div style={{paddingBottom: "10px"}}>
        <button className={styles["login-button"]} onClick={handleSignup}>Sign Up</button>
        </div>
      </div>
    </div>
  );
};
export default Login;