import React, { useState, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, Navigate } from "react-router-dom";
import { newNews, news as fetchNews } from "../../actions/news";
import styles from "../forums/forums.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
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
    <div className="container">
      <div className="col-md-12">
        <div className={styles["card-container"]}>
          <h2 className={styles["forum-title"]}>Create News Article</h2>
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
                onClick={handleCreateNews}
                text={loading ? "Creating..." : "Create News"}
                disabled={loading}
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

export default CreateNews;
