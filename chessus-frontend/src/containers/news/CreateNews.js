import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Navigate } from "react-router-dom";
import { newNews, news as fetchNews } from "../../actions/news";
import styles from "./createnews.module.scss";
import { getCurrentMySQLDateTime } from "../../helpers/date-formatter";
import LinkInsertButton from "../../components/common/LinkInsertButton";

const CreateNews = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const form = useRef();
  const contentRef = useRef(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [externalBlogUrl, setExternalBlogUrl] = useState("");
  const [externalBlogLabel, setExternalBlogLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Check if user is admin or owner - after all hooks
  if (!currentUser || (currentUser.role !== 'Admin' && currentUser.role !== 'admin' && currentUser.role !== 'owner')) {
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
    
    dispatch(newNews(currentUser.id, title, content, todaysDate, externalBlogUrl.trim() || null, externalBlogLabel.trim() || null))
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
              placeholder="Enter a compelling title"
              maxLength={200}
            />
            <div className={`${styles["char-counter"]} ${title.length > 180 ? styles["char-counter-warn"] : ""}`}>{title.length} / 200</div>
          </div>

          <div className={styles["form-group"]}>
            <label htmlFor="content" className={styles["form-label"]}>Article Content</label>
            <textarea
              className={styles["form-textarea"]}
                name="content"
                value={content}
                ref={contentRef}
                onChange={onChangeContent}
                rows="15"
                placeholder="Write your news article content here. Use clear paragraphs and formatting for better readability."
              />
            <div className={styles["textarea-hint"]}>Use double line breaks to separate paragraphs</div>
            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <LinkInsertButton textareaRef={contentRef} onChange={setContent} />
              <div className={styles["char-counter"]}>{content.length.toLocaleString()} chars</div>
            </div>
          </div>

          <div className={styles["form-group"]}>
            <label htmlFor="external_blog_url" className={styles["form-label"]}>External Link URL <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></label>
            <input
              type="url"
              className={styles["form-input"]}
              name="external_blog_url"
              value={externalBlogUrl}
              onChange={(e) => setExternalBlogUrl(e.target.value)}
              placeholder="https://lichess.org/@/username/blog/..."
            />
            <div className={styles["textarea-hint"]}>When set, a preview card linking to this URL is shown below the article content</div>
          </div>

          <div className={styles["form-group"]}>
            <label htmlFor="external_blog_label" className={styles["form-label"]}>Link Label <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}>(optional)</span></label>
            <input
              type="text"
              className={styles["form-input"]}
              name="external_blog_label"
              value={externalBlogLabel}
              onChange={(e) => setExternalBlogLabel(e.target.value)}
              placeholder="e.g. Lichess Blog Post, Official Announcement, Source Article"
              maxLength="80"
            />
            <div className={styles["textarea-hint"]}>Replaces the default “External Link” label on the preview card</div>
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
