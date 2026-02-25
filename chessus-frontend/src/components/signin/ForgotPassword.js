import React, { useState } from "react";
import { Link } from 'react-router-dom';
import AuthService from "../../services/auth.service";
import styles from "./login.module.scss";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (!email) {
      setError("Please enter your email address");
      setLoading(false);
      return;
    }

    try {
      const response = await AuthService.forgotPassword(email);
      setMessage(response.message);
      setSubmitted(true);
    } catch (err) {
      setError(err.response?.data?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles["main"]}>
      <div className={styles["wrapper"]}>
        <h2 style={{ textAlign: 'center', marginBottom: '10px' }}>Forgot Password</h2>
        
        {!submitted ? (
          <>
            <p style={{ textAlign: 'center', color: 'var(--text-light-gray)', fontSize: '14px', marginBottom: '20px', padding: '0 20px' }}>
              Enter your email address and we'll send you a link to reset your password.
            </p>
            
            <form onSubmit={handleSubmit}>
              <div className={styles["form-group"]}>
                <label htmlFor="email" className={styles["field-label"]}>Email: </label>
                <input
                  type="email"
                  className={styles["form-control"]}
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  style={{ width: '200px' }}
                />
              </div>

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
                  <span>Send Reset Link</span>
                </button>
              </div>
            </form>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>✅</div>
            <p style={{ color: 'var(--text-light-gray)', marginBottom: '20px' }}>
              {message}
            </p>
            <p style={{ color: 'var(--text-light-gray)', fontSize: '14px' }}>
              Didn't receive the email? Check your spam folder or{' '}
              <button 
                onClick={() => setSubmitted(false)} 
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: 'var(--accent-blue)', 
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                  font: 'inherit'
                }}
              >
                try again
              </button>
            </p>
          </div>
        )}

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

export default ForgotPassword;
