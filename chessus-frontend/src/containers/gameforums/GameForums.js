import React, { useState, useEffect } from "react";
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "../forums/forums.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { forums } from "../../actions/forums";

const GameForums = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allForums = useSelector((state) => state.forums);
  const navigate = useNavigate();
  const [firstRender, setFirstRender] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firstRender) {
      dispatch(forums());
      setFirstRender(true);
    }
  }, [firstRender, dispatch]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  function handleRowClick(forumId, e) {
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      return;
    }
    navigate(`/forums/${forumId}`);
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

  // Filter forums to only show game-specific forums (those with game_type_id)
  const gameForums = allForums.forums ? 
    allForums.forums.filter(forum => forum.game_type_id !== null) : [];

  // Filter by search term
  const filteredForums = gameForums.filter(forum => 
    forum.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (forum.content && forum.content.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (forum.author_name && forum.author_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="container">
      <header className="jumbotron">
        <h3 className={styles["forum-page-title"]}>
          Game Forums
        </h3>
      </header>
      
      <div className={styles["search-container"]}>
        <input
          type="text"
          placeholder="Search game forums..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles["search-input"]}
        />
      </div>

      <div className={styles["forums"]}>
        {filteredForums && filteredForums.length > 0 ? 
          <table className={styles["forums-table"]}>
            <tbody>
              <tr>
                <th>Subject</th>
                <th>Written By</th>
                <th>Replies</th>
                <th>Likes</th>
                <th>Content</th>
                <th>Created At</th>
              </tr>
              {filteredForums.map(function(forum) {
                return (
                  <tr 
                    key={forum.id} 
                    className={styles["forum-row"]}
                    onClick={(e) => handleRowClick(forum.id, e)}
                  >
                    <td>
                      <div className={styles["forums-link"]}>
                        <strong><div className={styles["forum-title"]}>{ forum.title }</div></strong>
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        { forum.author_name ? 
                          <Link to={`/profile/${forum.author_name}`} onClick={(e) => e.stopPropagation()}>
                            <div className={styles["forums-username"]}>{ forum.author_name }</div>
                          </Link>
                        : 
                          <Link to={"/community/players"} onClick={(e) => e.stopPropagation()}>
                            <div className={styles["forums-username"]}>User Deleted</div>
                          </Link>
                        }
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        <div className={styles["forums-comment-likes"]}>{forum.comment_count}</div>
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        <div className={styles["forums-comment-likes"]}>{forum.likes ? forum.likes.length : 0}</div>
                      </div>
                    </td>
                    <td className={styles["forums-link-content"]}>
                      <div className={styles["forum-content"]}>
                        {forum.content}
                      </div>
                    </td>
                    <td className={styles["date-td"]}>
                      <div className={styles["forums-date"]}>
                        {formatDateFromString(forum.created_at.toString())}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        : 
          <h1>{searchTerm ? "No game forums found matching your search" : "No Game Forums Found"}</h1>
        }
      </div>
    </div>
  );
};

export default GameForums;
