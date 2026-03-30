import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { newForum } from "../../actions/forums";
import styles from "./create-forum.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import { getCurrentMySQLDateTime } from "../../helpers/date-formatter";

import { forums } from "../../actions/forums";

const CreateForum = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [searchParams] = useSearchParams();
  const gameTypeId = searchParams.get('game_type_id');
  
  const form = useRef();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [successful] = useState(false);
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
    const todaysDate = getCurrentMySQLDateTime();
    dispatch(newForum(currentUser.id, title, content, todaysDate, gameTypeId))
      //  Must run dispatch(forums()) to load the newly created forum into state, which is how /forums displays everything
      .then(() => {
        dispatch(forums());
      })
      .then(() => {
        navigate("/forums/");
      })
      .catch((error) => {
        // If forum already exists for this game, redirect to it
        if (error.response?.data?.existing_forum_id) {
          navigate(`/forums/${error.response.data.existing_forum_id}`);
        }
      });
  }


  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to create a forum post." }} />;
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
          {message && (
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