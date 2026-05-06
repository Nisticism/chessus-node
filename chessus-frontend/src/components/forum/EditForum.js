import React, { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate, useParams, Link } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./edit-forum.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import { getForum, editForum } from "../../actions/forums";
import { formatDateLegacy, getCurrentMySQLDateTime } from "../../helpers/date-formatter";
import EmojiPickerButton from "../common/EmojiPickerButton";
import LinkInsertButton from "../common/LinkInsertButton";
import BulletInsertButton, { handleBulletKeyDown } from "../common/BulletInsertButton";
import ValidationWarningModal from "../common/ValidationWarningModal";
import { renderContent } from "../../helpers/render-content";

const TITLE_MAX = 200;
const CONTENT_MAX = 50000;

const EditForum = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const form = useRef();
  const contentRef = useRef(null);
  const [title, setTitle] = useState(null);
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [successful] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState(null);
  const { message } = useSelector(state => state.message);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const currentForum = useSelector((state) => state.forums.forum);
  const [firstRender, setFirstRender] = useState(false);

  const { forumId } = useParams();

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!firstRender) {
      console.log(forumId)
      setLoading(true);
      dispatch(getForum(forumId)).finally(() => setLoading(false));
      setFirstRender(true);
    }
  }, [firstRender]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const onChangeTitle = (e) => {
    const title = e.target.value;
    setTitle(title);
    // document.getElementById("title-field").value = e.target.value;
  };

  const onChangeContent = (e) => {
    const content = e.target.value;
    setContent(content);
  };

  const handleEditPost = (e) => {
    e.preventDefault();
    console.log("in handle edit post");
    const todaysDate = getCurrentMySQLDateTime();
    let inputTitle = title;
    let inputContent = content;
    let last_updated_at = todaysDate;
    if (title === null) {
      inputTitle = currentForum.title;
    }
    if (content === null) {
      inputContent = currentForum.content;
      console.log(content);
    }
    const warnings = [];
    if (!inputTitle || !inputTitle.trim()) warnings.push("Post Subject is required");
    else if (inputTitle.length > TITLE_MAX) warnings.push(`Post Subject exceeds ${TITLE_MAX} character limit (currently ${inputTitle.length})`);
    if (!inputContent || !inputContent.trim()) warnings.push("Content is required");
    else if (inputContent.length > CONTENT_MAX) warnings.push(`Content exceeds ${CONTENT_MAX.toLocaleString()} character limit (currently ${inputContent.length.toLocaleString()})`);
    if (warnings.length > 0) { setValidationWarnings(warnings); return; }

    console.log("title: " + title, "content: " + content);
    dispatch(editForum(inputTitle, inputContent, last_updated_at, forumId))
      .then(() => {
        navigate(`/forums/${forumId}`);
      })
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to edit forum posts." }} />;
  }

  if (currentUser && currentForum && (currentForum.author_id !== currentUser.id && !['admin', 'owner'].includes(currentUser.role?.toLowerCase()))) {
    return <Navigate to="/" />;
  }

  const handleCancel = () => {
    const titleChanged = title !== null && currentForum && title !== currentForum.title;
    const contentChanged = content !== null && currentForum && content !== currentForum.content;
    if (titleChanged || contentChanged) {
      if (!window.confirm('Discard your changes to this post?')) return;
    }
    if (forumId) {
      navigate(`/forums/${forumId}`);
    } else {
      navigate(-1);
    }
  };

  const liveTitle = title !== null ? title : (currentForum?.title || '');
  const liveContent = content !== null ? content : (currentForum?.content || '');

  return (
    <div className={styles["container"]}>
      {loading ? (
        <div className={styles["loading-container"]}>
          <p>Loading forum...</p>
        </div>
      ) : (
      <div className={styles["wrapper"]}>
        <form ref={form} className={styles["forum-form"]}>
          {!successful && (
            <>
              <h2 className={styles["edit-forum-title"]}>Edit Post</h2>
              <p className={styles["page-subtitle"]}>Update your post and save changes.</p>

              <div className={styles["form-group"]}>
                <label htmlFor="title-field" className={styles["edit-field-label"]}>Post Subject</label>
                <input
                  id="title-field"
                  type="text"
                  className={styles["edit-forum-title-input"]}
                  name="title"
                  defaultValue={currentForum ? currentForum.title : title}
                  onChange={onChangeTitle}
                  maxLength={TITLE_MAX}
                />
                <div className={`${styles["char-counter"]} ${liveTitle.length > TITLE_MAX * 0.9 ? styles["char-counter-warn"] : ""}`}>{liveTitle.length}/{TITLE_MAX}</div>
              </div>

              <div className={styles["form-group"]}>
                <label htmlFor="content-field" className={styles["edit-field-label"]}>Content</label>
                <textarea
                  id="content-field"
                  className={styles["edit-form-control"]}
                  name="content"
                  ref={contentRef}
                  defaultValue={currentForum ? currentForum.content : content}
                  onChange={onChangeContent}
                  onKeyDown={(e) => {
                    handleBulletKeyDown(e, e.target.value, (newVal) => {
                      e.target.value = newVal;
                      onChangeContent({ target: { value: newVal } });
                    });
                  }}
                  maxLength={CONTENT_MAX}
                />
                <div className={styles["emoji-row"]}>
                  <EmojiPickerButton textareaRef={contentRef} onChange={(newVal) => {
                    if (contentRef.current) contentRef.current.value = newVal;
                    setContent(newVal);
                  }} />
                  <LinkInsertButton textareaRef={contentRef} onChange={(newVal) => {
                    if (contentRef.current) contentRef.current.value = newVal;
                    setContent(newVal);
                  }} />
                  <BulletInsertButton textareaRef={contentRef} value={liveContent} onChange={(newVal) => {
                    if (contentRef.current) contentRef.current.value = newVal;
                    onChangeContent({ target: { value: newVal } });
                  }} />
                  <div className={`${styles["char-counter"]} ${liveContent.length > CONTENT_MAX * 0.9 ? styles["char-counter-warn"] : ""}`}>{liveContent.length.toLocaleString()}/{CONTENT_MAX.toLocaleString()}</div>
                </div>
                {liveContent && /\[|\u2022/.test(liveContent) && (
                  <div className={styles["content-preview"]}>
                    <div className={styles["content-preview-label"]}>Preview</div>
                    {renderContent(liveContent)}
                  </div>
                )}
              </div>

              <div className={styles["button-row"]}>
                <StandardButton buttonText={"Update Post"} onClick={handleEditPost}></StandardButton>
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
        <div className={styles["comments-container"]}>
        <h2>Comments</h2>
            {
            currentForum && currentForum.comments ? currentForum.comments.map(function(comment) {
              return (
                <div className={styles["comment-container"]} key={comment.id}>
                  <div className={styles["comment"]}>
                    <div className={styles["comment-data"]}>
                      <div className={styles["comment-date"]}>
                        {comment.last_updated_at === comment.created_at ? "" : "Last updated "}{ comment.last_updated_at ? formatDateLegacy(comment.last_updated_at) : "" }
                      </div>
                      <div className={styles["comment-author"]}>
                        <div className={styles["comment-link"]}>
                            <Link to={`/profile/${comment.author_name}`}>
                              { comment.author_name }
                            </Link>
                        </div>
                      </div>
                      <div className={styles["comment-content"]}>
                        { comment.content }
                      </div>
                    </div>
                  </div>
                </div>
              )
            }) : "No comments so far"
          }
        </div>
      </div>
      )}
      <ValidationWarningModal warnings={validationWarnings} onClose={() => setValidationWarnings(null)} />
    </div>
  );
};
export default EditForum;