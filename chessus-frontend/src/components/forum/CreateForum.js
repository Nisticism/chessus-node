import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Navigate, useSearchParams } from "react-router-dom";
import { newForum } from "../../actions/forums";
import styles from "./create-forum.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import { getCurrentMySQLDateTime } from "../../helpers/date-formatter";
import EmojiPickerButton from "../common/EmojiPickerButton";
import LinkInsertButton from "../common/LinkInsertButton";
import BulletInsertButton, { handleBulletKeyDown } from "../common/BulletInsertButton";
import ValidationWarningModal from "../common/ValidationWarningModal";
import { renderContent } from "../../helpers/render-content";
import { FORUM_CATEGORIES } from "../../helpers/forum-categories";

import { forums } from "../../actions/forums";

const TITLE_MAX = 200;
const CONTENT_MAX = 50000;

const CreateForum = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [searchParams] = useSearchParams();
  const gameTypeId = searchParams.get('game_type_id');
  
  const form = useRef();
  const contentRef = useRef(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [successful] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState(null);
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
    const warnings = [];
    if (!title.trim()) warnings.push("Post Subject is required");
    else if (title.length > TITLE_MAX) warnings.push(`Post Subject exceeds ${TITLE_MAX} character limit (currently ${title.length})`);
    if (!content.trim()) warnings.push("Content is required");
    else if (content.length > CONTENT_MAX) warnings.push(`Content exceeds ${CONTENT_MAX.toLocaleString()} character limit (currently ${content.length.toLocaleString()})`);
    if (warnings.length > 0) { setValidationWarnings(warnings); return; }

    const todaysDate = getCurrentMySQLDateTime();
    // Game forums always force category 'game' on the server; for general
    // forums we send the user's chosen category from the dropdown.
    const finalCategory = gameTypeId ? 'game' : category;
    dispatch(newForum(currentUser.id, title, content, todaysDate, gameTypeId, finalCategory))
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

  const handleCancel = () => {
    if ((title && title.trim()) || (content && content.trim())) {
      if (!window.confirm('Discard this post? Your changes will be lost.')) return;
    }
    navigate(-1);
  };

  return (
    <div className={styles["container"]}>
      <div className={styles["wrapper"]}>
        <form ref={form} className={styles["forum-form"]}>
          {!successful && (
            <>
              <h2 className={styles["page-title"]}>Create New Post</h2>
              <p className={styles["page-subtitle"]}>Start a discussion with the community.</p>

              <div className={styles["form-group"]}>
                <label htmlFor="title-field" className={styles["create-field-label"]}>Post Subject</label>
                <input
                  id="title-field"
                  type="text"
                  className={styles["forum-title-input"]}
                  name="title"
                  value={title}
                  onChange={onChangeTitle}
                  maxLength={TITLE_MAX}
                  placeholder="Give your post a clear subject…"
                />
                <div className={`${styles["char-counter"]} ${title.length > TITLE_MAX * 0.9 ? styles["char-counter-warn"] : ""}`}>{title.length}/{TITLE_MAX}</div>
              </div>

              {!gameTypeId && (
                <div className={styles["form-group"]}>
                  <label htmlFor="category-field" className={styles["create-field-label"]}>Category</label>
                  <select
                    id="category-field"
                    className={styles["forum-title-input"]}
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {FORUM_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className={styles["form-group"]}>
                <label htmlFor="content-field" className={styles["create-field-label"]}>Content</label>
                <textarea
                  id="content-field"
                  className={styles["create-form-control"]}
                  name="content"
                  ref={contentRef}
                  value={content}
                  onChange={onChangeContent}
                  onKeyDown={(e) => { handleBulletKeyDown(e, content, setContent); }}
                  maxLength={CONTENT_MAX}
                  placeholder="Share your thoughts…"
                />
                <div className={styles["emoji-row"]}>
                  <EmojiPickerButton textareaRef={contentRef} onChange={setContent} />
                  <LinkInsertButton textareaRef={contentRef} onChange={setContent} />
                  <BulletInsertButton textareaRef={contentRef} value={content} onChange={setContent} />
                  <div className={`${styles["char-counter"]} ${content.length > CONTENT_MAX * 0.9 ? styles["char-counter-warn"] : ""}`}>{content.length.toLocaleString()}/{CONTENT_MAX.toLocaleString()}</div>
                </div>
                {content && /\[|\u2022/.test(content) && (
                  <div className={styles["content-preview"]}>
                    <div className={styles["content-preview-label"]}>Preview</div>
                    {renderContent(content)}
                  </div>
                )}
              </div>

              <div className={styles["button-row"]}>
                <StandardButton buttonText={"Create Post"} onClick={handleCreatePost}></StandardButton>
                <StandardButton buttonText={"Cancel"} onClick={handleCancel}></StandardButton>
              </div>
            </>
          )}
          {message && (
            <div className={styles["form-group"]}>
              <div className={ successful ? "alert alert-success" : "alert alert-danger" } role="alert">
                {message}
              </div>
            </div>
          )}
        </form>
      </div>
      <ValidationWarningModal warnings={validationWarnings} onClose={() => setValidationWarnings(null)} />
    </div>
  );
};
export default CreateForum;