import React, { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./createnews.module.scss";
import { news as fetchNews } from "../../actions/news";
import { getCurrentMySQLDateTime } from "../../helpers/date-formatter";

const EditNews = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const form = useRef();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [newsArticle, setNewsArticle] = useState(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { newsId } = useParams();

  useEffect(() => {
    const fetchNewsArticle = async () => {
      try {
        const response = await axios.get(
          `${API_URL}admin/news/${newsId}`,
          { headers: authHeader() }
        );
        const article = response.data.data;
        setNewsArticle(article);
        setTitle(article.title || "");
        setContent(article.content || "");
        setLoading(false);
      } catch (error) {
        console.error("Error fetching news article:", error);
        setMessage("Failed to load news article");
        setLoading(false);
      }
    };

    if (newsId) {
      fetchNewsArticle();
    }
  }, [newsId]);

  // Check if user is admin or owner - after all hooks
  if (!currentUser || (currentUser.role !== 'Admin' && currentUser.role !== 'admin' && currentUser.role !== 'owner')) {
    return <Navigate to="/news" state={{ message: "You must be an admin to edit news" }} />;
  }

  const onChangeTitle = (e) => {
    setTitle(e.target.value);
  };

  const onChangeContent = (e) => {
    setContent(e.target.value);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    
    if (!title || !content) {
      setMessage("Please fill in all fields");
      return;
    }

    setSaving(true);
    setMessage("");
    
    try {
      const last_updated_at = getCurrentMySQLDateTime();
      
      await axios.put(
        `${API_URL}admin/news/${newsId}`,
        { title, content, last_updated_at },
        { headers: authHeader() }
      );
      
      setMessage("News article updated successfully!");
      dispatch(fetchNews());
      
      setTimeout(() => {
        navigate("/news");
      }, 1000);
    } catch (error) {
      console.error("Error updating news:", error);
      setMessage("Failed to update news article");
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={styles["create-news-container"]}>
        <div className={styles["create-news-card"]}>
          <div className={styles["card-header"]}>
            <h1 className={styles["page-title"]}>Loading...</h1>
            <p className={styles["page-subtitle"]}>Fetching article details</p>
          </div>
        </div>
      </div>
    );
  }

  if (!newsArticle) {
    return (
      <div className={styles["create-news-container"]}>
        <div className={styles["create-news-card"]}>
          <div className={styles["card-header"]}>
            <h1 className={styles["page-title"]}>Article Not Found</h1>
            <p className={styles["page-subtitle"]}>The news article you're looking for doesn't exist</p>
          </div>
          <div className={styles["form-actions"]}>
            <button 
              className={styles["submit-button"]} 
              onClick={() => navigate("/news")}
            >
              Back to News
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["create-news-container"]}>
      <div className={styles["create-news-card"]}>
        <div className={styles["card-header"]}>
          <h1 className={styles["page-title"]}>Edit News Article</h1>
          <p className={styles["page-subtitle"]}>Update your news article content and publish changes</p>
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
              onClick={handleSaveEdit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Update Article"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditNews;
