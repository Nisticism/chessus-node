import React, { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "../forums/forums.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { editNews, news as fetchNews } from "../../actions/news";
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

  // Check if user is admin - after all hooks
  if (!currentUser || (currentUser.role !== 'Admin' && currentUser.role !== 'admin')) {
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
      <div className="container">
        <div className="col-md-12">
          <div className={styles["card-container"]}>
            <h2>Loading...</h2>
          </div>
        </div>
      </div>
    );
  }

  if (!newsArticle) {
    return (
      <div className="container">
        <div className="col-md-12">
          <div className={styles["card-container"]}>
            <h2>News article not found</h2>
            <StandardButton onClick={() => navigate("/news")} text="Back to News" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="col-md-12">
        <div className={styles["card-container"]}>
          <h2 className={styles["forum-title"]}>Edit News Article</h2>
          <form ref={form}>
            <div className={styles["form-group"]}>
              <label htmlFor="title" className={styles["form-label"]}>Title</label>
              <input
                type="text"
                className={styles["form-control"]}
                name="title"
                value={title}
                onChange={onChangeTitle}
                placeholder="Enter news title"
              />
            </div>

            <div className={styles["form-group"]}>
              <label htmlFor="content" className={styles["form-label"]}>Content</label>
              <textarea
                className={styles["form-control"]}
                name="content"
                value={content}
                onChange={onChangeContent}
                rows="10"
                placeholder="Enter news content"
              />
            </div>

            {message && (
              <div className={styles["alert"]} style={{
                color: message.includes('success') ? 'green' : 'red',
                marginBottom: '15px'
              }}>
                {message}
              </div>
            )}

            <div className={styles["form-group"]}>
              <StandardButton
                onClick={handleSaveEdit}
                text={saving ? "Saving..." : "Save Changes"}
                disabled={saving}
              />
              <StandardButton
                onClick={() => navigate("/news")}
                text="Cancel"
                style={{ marginLeft: '10px' }}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default EditNews;
