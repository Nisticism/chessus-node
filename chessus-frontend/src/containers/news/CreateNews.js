import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Navigate } from "react-router-dom";
import { newNews, news as fetchNews } from "../../actions/news";
import styles from "./createnews.module.scss";
import { getCurrentMySQLDateTime } from "../../helpers/date-formatter";

const CreateNews = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const form = useRef();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Check if user is admin - after all hooks
  if (!currentUser || (currentUser.role !== 'Admin' && currentUser.role !== 'admin')) {
    return <Navigate to="/news" state={{ message: "You must be an admin to create news" }} />;
  }

  const onChangeTitle = (e) => {
    setTitle(e.target.value);
  };

  const onChangeContent = (e) => {
    setContent(e.target.value);
  };

  const handleCreateNews = (e) => {
    e.preventDefault();
    
    if (!title || !content) {
      setMessage("Please fill in all fields");
      return;
    }

    setLoading(true);
    setMessage("");
    
    const todaysDate = getCurrentMySQLDateTime();
    
    dispatch(newNews(currentUser.id, title, content, todaysDate))
      .then(() => {
        dispatch(fetchNews());
        setMessage("News article created successfully!");
        setTimeout(() => {
          navigate("/news");
        }, 1000);
      })
      .catch((error) => {
        setMessage("Failed to create news article");
        setLoading(false);
      });
  };

  return (
    <div className={styles["create-news-container"]}>
      <div className={styles["create-news-card"]}>
        <div className={styles["card-header"]}>
          <h1 className={styles["page-title"]}>Create News Article</h1>
          <p className={styles["page-subtitle"]}>Share important updates and announcements with the GridGrove community</p>
        </div>

        <form ref={form} className={styles["news-form"]}>
          <div className={styles["form-group"]}>
            <label htmlFor="title" className={styles["form-label"]}>Article Title</label>
            <input
              type="text"
              className={styles["form-input"]}
              name="title"
              value={title}
              onChange={onChangeTitle}
              placeholder="Enter a compelling title (max 50 characters)"
              maxLength="50"
            />
          </div>

          <div className={styles["form-group"]}>
            <label htmlFor="content" className={styles["form-label"]}>Article Content</label>
            <textarea
              className={styles["form-textarea"]}
                name="content"
                value={content}
                onChange={onChangeContent}
                rows="15"
                placeholder="Write your news article content here. Use clear paragraphs and formatting for better readability."
              />
            <div className={styles["textarea-hint"]}>Use double line breaks to separate paragraphs</div>
          </div>

          {message && (
            <div className={message.includes('success') ? styles["alert-success"] : styles["alert-error"]}>
              {message}
            </div>
          )}

          <div className={styles["form-actions"]}>
            <button
              type="button"
              className={styles["cancel-button"]}
              onClick={() => navigate("/news")}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles["submit-button"]}
              onClick={handleCreateNews}
              disabled={loading}
            >
              {loading ? "Creating..." : "Publish Article"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CreateNews;
