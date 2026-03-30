import React from "react";
import { useNavigate } from 'react-router-dom';
import styles from "./deletedaccount.module.scss";

const DeletedAccount = () => {

  const navigate = useNavigate();

  const handleSignup = () => {
    navigate('/register')
  }

  return (
    <div className="container">
      <header>
        <h3>
          <strong>Account Deleted</strong>
        </h3>
      </header>
      <button className={styles["signin-button"]} onClick={handleSignup}>Sign Up</button>
    </div>
  );
};

export default DeletedAccount;