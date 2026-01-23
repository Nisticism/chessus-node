import React, { useState, useEffect } from "react";
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "./news.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { news } from "../../actions/news";
import { formatDateLegacy } from "../../helpers/date-formatter";
const News = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allNews = useSelector((state) => state.news);
  const navigate = useNavigate();
  const [firstRender, setFirstRender] = useState(false);
  // const [forums, setForums] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firstRender) {
      // dispatch(users());
      dispatch(news());
      setFirstRender(true);
    }
  }, [firstRender]);

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
    <div className="container">
      <header className="jumbotron">
        <h3 className={styles["news-page-title"]}>
          News
        </h3>
        {currentUser && (currentUser.role === 'Admin' || currentUser.role === 'admin') && (
          <div style={{ marginTop: '10px' }}>
            <StandardButton 
              onClick={createNewPost} 
              text="Create News Article"
            />
          </div>
        )}
      </header>
    <div className={styles["news"]}>
      { allNews.all_news ? 
    <table className={styles["news-table"]}>
      <tbody>
        <tr>
          <th>
            Date
          </th>
          <th>
            Image
          </th>
          <th>
            Author
          </th>
          <th>
            Source
          </th>
          <th>
            Title
          </th>
          <th>
            Content
          </th>
          {currentUser && (currentUser.role === 'Admin' || currentUser.role === 'admin') && (
            <th>
              Actions
            </th>
          )}
        </tr>
          {
            allNews.all_news.map(function(news) {
              return (
                <tr key={news.id} className={styles["news-row"]}>
                    <td className={styles["date-td"]}>
                      {
                      formatDateLegacy(news.date_published)
                      // forum.created_at
                      }
                    </td>
                    <td>
                      <div>
                        {news.image_url ? (
                          <img src={news.image_url} className={styles["image-button"]} alt="news" width="200px" onClick={(event) => {handleImageClick(event, news.url)}}/>
                        ) : (
                          <span>No image</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className={styles["news-link"]}>
                        <div className={styles["news-username"]}>{ news.author }</div>
                      </div>
                    </td>
                    <td>
                      <div className={styles["news-link"]}>
                        <div className={styles["news-username"]}>{ news.source_name || 'Internal'}</div>
                      </div>
                    </td>
                    <td>
                      <div className={styles["news-link"]}>
                        <br/>
                        {news.url ? (
                          <a href={news.url} target="_blank" rel="noreferrer">
                            <strong><div className={styles["news-title"]}>{ news.title }</div></strong>
                          </a>
                        ) : (
                          <strong><div className={styles["news-title"]}>{ news.title }</div></strong>
                        )}
                      </div>
                    </td>
                    <td className={styles["content-td"]}>
                      <div className={styles["news-content"]}>
                        {news.content}
                      </div>
                    </td>
                    {currentUser && (currentUser.role === 'Admin' || currentUser.role === 'admin') && (
                      <td>
                        <StandardButton 
                          onClick={() => navigate(`/news/edit/${news.id}`)} 
                          text="Edit"
                        />
                      </td>
                    )}
                </tr>
              )
            })
          }
      </tbody>
    </table>
    : 
    <h1>No News Found</h1>
      }
    </div>
    </div>
  );
};

export default News;