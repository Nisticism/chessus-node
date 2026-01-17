import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import Form from "react-validation/build/form";
import Input from "react-validation/build/input";
import CheckButton from "react-validation/build/button";
import { useNavigate, Navigate } from "react-router-dom";
import { isEmail } from "validator";
import { newForum } from "../../actions/forums";
import styles from "./create-forum.module.scss";
import StandardButton from "../standardbutton/StardardButton";

import { forums } from "../../actions/forums";

const required = (value) => {
  if (!value) {
    return (
      <div className="alert alert-danger" role="alert">
        This field is required!
      </div>
    );
  }
};

const validSubject = (value) => {
  if (!isEmail(value)) {
    return (
      <div className="alert alert-danger" role="alert">
        This is not a valid email.
      </div>
    );
  }
};

const validContent = (value) => {
  if (value.length < 3 || value.length > 20) {
    return (
      <div className="alert alert-danger" role="alert">
        The username must be between 3 and 20 characters.
      </div>
    );
  }
};

const CreateForum = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const form = useRef();
  const checkBtn = useRef();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [date, setDate] = useState("");
  const [successful, setSuccessful] = useState(false);
  const [messageDisplay, setMessageDisplay] = useState(false);
  const { message } = useSelector(state => state.message);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const onChangeTitle = (e) => {
    const title = e.target.value;
    setTitle(title);
  };

  const onChangeContent = (e) => {
    const content = e.target.value;
    setContent(content);
  };

  function handleCreatePost(e) {
    e.preventDefault();
    const todaysDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    setDate(todaysDate);
    dispatch(newForum(currentUser.id, title, content, todaysDate))
      //  Must run dispatch(forums()) to load the newly created forum into state, which is how /forums displays everything
      .then(() => {
        dispatch(forums());
      })
      .then(() => {
        navigate("/forums/");
      })
  }


  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  return (
    <div className={styles["container"]}>
      <div className={styles["wrapper"]}>
        {/* <img
          src="//ssl.gstatic.com/accounts/ui/avatar_2x.png"
          alt="profile-img"
          className="profile-img-card"
        /> */}
        <form ref={form}>
          {!successful && (
            <div>
              <div className={styles["form-group"]}>
                <label htmlFor="username" className={styles["create-field-label"]}>Post Subject</label>
                <input
                  type="text"
                  className={styles["forum-title-input"]}
                  name="title"
                  value={title}
                  onChange={onChangeTitle}
                  // validations={[required, validSubject]}
                />
              </div>
              <div className={styles["form-group"]}>
                <label htmlFor="email" className={styles["create-field-label"]}>Content</label>
                <textarea
                  type="text"
                  className={styles["create-form-control"]}
                  name="content"
                  value={content}
                  onChange={onChangeContent}
                  // validations={[required, validContent]}
                />
              </div>
              {/* <div className="form-group">
                <label htmlFor="password" className={styles["field-label"]}>Password</label>
                <input
                  type="password"
                  className="form-control"
                  name="password"
                  value={password}
                  onChange={onChangePassword}
                  validations={[required, vpassword]}
                />
              </div> */}
              <div className="form-group">
                <StandardButton buttonText={"Create Post"} onClick={handleCreatePost}></StandardButton>
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
        </form>
      </div>
    </div>
  );
};
export default CreateForum;