import React, { useState, useEffect } from "react";
import { Navigate, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "./news.module.scss";
import { news } from "../../actions/news";
import { formatDateLegacy } from "../../helpers/date-formatter";
const News = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allNews = useSelector((state) => state.news);
  const navigate = useNavigate();
  const [firstRender, setFirstRender] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firstRender) {
      dispatch(news());
      setFirstRender(true);
    }
  }, [firstRender, dispatch]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  function createNewPost() {
    navigate("/news/new");
  }



  function handleImageClick(e, url) {
    e.preventDefault();
    window.open(url, "_blank").focus();
  }

  return (
    <div className={styles["news-container"]}>
      <div className={styles["news-header"]}>
        <h1 className={styles["news-page-title"]}>
          News
        </h1>
        {currentUser && (currentUser.role === 'Admin' || currentUser.role === 'admin') && (
          <button className={styles["create-news-button"]} onClick={createNewPost}>
            <span className={styles["button-icon"]}>+</span>
            Create News Article
          </button>
        )}
      </div>
    <div className={styles["news"]}>
      { allNews.all_news && allNews.all_news.length > 0 ? 
        <div className={styles["news-articles"]}>
          {
            allNews.all_news.map(function(newsItem) {
              return (
                <article key={newsItem.id} className={styles["news-article"]}>
                  <div className={styles["article-header"]}>
                    <h2 className={styles["article-title"]}>
                      {newsItem.url ? (
                        <a href={newsItem.url} target="_blank" rel="noreferrer">
                          {newsItem.title}
                        </a>
                      ) : (
                        newsItem.title
                      )}
                    </h2>
                    <div className={styles["article-meta"]}>
                      <span className={styles["article-date"]}>
                        {formatDateLegacy(newsItem.date_published)}
                      </span>
                      <span className={styles["article-author"]}>
                        By {newsItem.author}
                      </span>
                      {newsItem.source_name && (
                        <span className={styles["article-source"]}>
                          Source: {newsItem.source_name}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {newsItem.image_url && (
                    <div className={styles["article-image"]}>
                      <img 
                        src={newsItem.image_url} 
                        alt={newsItem.title}
                        onClick={(event) => {handleImageClick(event, newsItem.url)}}
                      />
                    </div>
                  )}
                  
                  <div className={styles["article-content"]}>
                    {newsItem.content}
                  </div>
                  
                  {currentUser && (currentUser.role === 'Admin' || currentUser.role === 'admin') && (
                    <div className={styles["article-actions"]}>
                      <button 
                        className={styles["edit-button"]}
                        onClick={() => navigate(`/news/edit/${newsItem.id}`)}
                      >
                        <span className={styles["button-icon"]}>✎</span>
                        Edit Article
                      </button>
                    </div>
                  )}
                </article>
              )
            })
          }
        </div>
      : 
        <div className={styles["no-news"]}>
          <h2>No News Articles Yet</h2>
          <p>Check back soon for updates about SquareStrat!</p>
        </div>
      }
    </div>
    </div>
  );
};

export default News;