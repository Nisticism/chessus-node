import React, { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from 'react-router-dom';
import AuthService from "../../services/auth.service";
import styles from "./login.module.scss";

const ResetPassword = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Verify token on mount
  useEffect(() => {
    const verifyToken = async () => {
      try {
        const response = await AuthService.verifyResetToken(token);
        if (response.valid) {
          setTokenValid(true);
          setUsername(response.username);
        } else {
          setError(response.message || "Invalid or expired reset link");
        }
      } catch (err) {
        setError(err.response?.data?.message || "Invalid or expired reset link");
      } finally {
        setVerifying(false);
      }
    };

    verifyToken();
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    // Validation
    if (!password || !confirmPassword) {
      setError("Please fill in all fields");
      setLoading(false);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      setLoading(false);
      return;
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      setError("Password must contain at least one uppercase letter, one lowercase letter, and one number");
      setLoading(false);
      return;
    }

    try {
      const response = await AuthService.resetPassword(token, password);
      setMessage(response.message);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (verifying) {
    return (
      <div className={styles["main"]}>
        <div className={styles["wrapper"]}>
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div className="spinner-border spinner-border-lg" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p style={{ marginTop: '20px', color: 'var(--text-light-gray)' }}>
              Verifying reset link...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Invalid/expired token
  if (!tokenValid && !verifying) {
    return (
      <div className={styles["main"]}>
        <div className={styles["wrapper"]}>
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>❌</div>
            <h2>Invalid Reset Link</h2>
            <p style={{ color: 'var(--text-light-gray)', marginBottom: '20px' }}>
              {error || "This password reset link is invalid or has expired."}
            </p>
            <Link to="/forgot-password">
              <button className={styles["login-button"]} style={{ width: 'auto', padding: '10px 30px' }}>
                Request New Reset Link
              </button>
            </Link>
          </div>
          <hr />
          <div style={{ textAlign: 'center', paddingBottom: '15px' }}>
            <Link to="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
    return (
      <div className={styles["main"]}>
        <div className={styles["wrapper"]}>
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>✅</div>
            <h2>Password Reset!</h2>
            <p style={{ color: 'var(--text-light-gray)', marginBottom: '20px' }}>
              {message}
            </p>
            <button 
              className={styles["login-button"]} 
              style={{ width: 'auto', padding: '10px 30px' }}
              onClick={() => navigate('/login')}
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Reset password form
  return (
    <div className={styles["main"]}>
      <div className={styles["wrapper"]}>
        <h2 style={{ textAlign: 'center', marginBottom: '10px' }}>Reset Password</h2>
        <p style={{ textAlign: 'center', color: 'var(--text-light-gray)', fontSize: '14px', marginBottom: '20px' }}>
          Welcome back, <strong>{username}</strong>! Enter your new password below.
        </p>

        <form onSubmit={handleSubmit}>
          <div className={styles["form-group"]}>
            <label htmlFor="password" className={styles["field-label"]}>New Password: </label>
            <input
              type="password"
              className={styles["form-control"]}
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              style={{ width: '180px' }}
            />
          </div>

          <div className={styles["form-group"]}>
            <label htmlFor="confirmPassword" className={styles["field-label"]}>Confirm: </label>
            <input
              type="password"
              className={styles["form-control"]}
              name="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              style={{ width: '180px' }}
            />
          </div>

          <p style={{ fontSize: '12px', color: 'var(--text-light-gray)', padding: '0 10px', marginBottom: '10px' }}>
            Password must be at least 8 characters with uppercase, lowercase, and a number.
          </p>

          {error && (
            <div className={styles["form-group"]}>
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            </div>
          )}

          <div className={styles["form-group"]}>
            <button className={styles["login-button"]} disabled={loading}>
              {loading && (
                <span className="spinner-border spinner-border-sm" style={{ marginRight: '8px' }}></span>
              )}
              <span>Reset Password</span>
            </button>
          </div>
        </form>

        <hr />
        <div style={{ textAlign: 'center', paddingBottom: '15px' }}>
          <Link to="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
