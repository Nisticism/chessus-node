import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import Form from "react-validation/build/form";
import Input from "react-validation/build/input";
import CheckButton from "react-validation/build/button";
import { login } from "../../actions/auth";
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
              name="username"
              value={username}
              onChange={onChangeUsername}
              validations={[required]}
            />
          </div>
          <div className={styles["form-group"]}>
            <label htmlFor="password" className={styles["field-label"]}>Password: </label>
            <input
              type="password"
              className="form-control"
              name="password"
              value={password}
              onChange={onChangePassword}
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