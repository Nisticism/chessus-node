import React, { useState, useEffect } from "react";
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "./news.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { news } from "../../actions/news";
const News = () => {
  const { user: currentUser } = useSelector((state) => state.auth);
  const allNews = useSelector((state) => state.news);
  const navigate = useNavigate();
  const [firstRender, setFirstRender] = useState(false);
  // const [forums, setForums] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    console.log("testing")
    if (!firstRender) {
      console.log("in useeffect news page");
      // dispatch(users());
      dispatch(news());
      setFirstRender(true);
    }
  }, [firstRender]);

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  function createNewPost() {
    navigate("/news/new");
  }

  function formatDateFromString(date) {
    let year = date.substring(0,4);
    let day = date.substring(8,10);
    let month = date.substring(5,7);
    let hoursTime = date.substring(11, 13);
    let minutesTime = date.substring(14, 16);
    let dayHalf = "am"
    if (hoursTime > 12) {
      dayHalf = "pm"
      hoursTime = (parseInt(hoursTime) - 12).toString();
    }
    return month + "/" + day + "/" + year + " " + hoursTime + ":" + minutesTime + dayHalf;
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
        </tr>
          {
            allNews.all_news.map(function(news) {
              return (
                <tr key={news.id} className={styles["news-row"]}>
                    <td className={styles["date-td"]}>
                      {
                      formatDateFromString(news.date_published.toString())
                      // forum.created_at
                      }
                    </td>
                    <td>
                      <div>
                        <img src={news.image_url} className={styles["image-button"]} alt="news image" width="200px" onClick={(event) => {handleImageClick(event, news.url)}}/>
                      </div>
                    </td>
                    <td>
                      <div className={styles["news-link"]}>
                        <div className={styles["news-username"]}>{ news.author }</div>
                      </div>
                    </td>
                    <td>
                      <div className={styles["news-link"]}>
                        <div className={styles["news-username"]}>{ news.source_name}</div>
                      </div>
                    </td>
                    <td>
                      <div className={styles["news-link"]}>
                        <br/>
                        <a href={news.url} target="_blank">
                          <strong><div className={styles["news-title"]}>{ news.title }</div></strong>
                        </a>
                      </div>
                    </td>
                    <td className={styles["content-td"]}>
                      <div className={styles["news-content"]}>
                        {news.content}
                      </div>
                    </td>
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