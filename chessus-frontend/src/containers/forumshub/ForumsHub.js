import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "./forumshub.module.scss";
import StandardButton from "../../components/standardbutton/StandardButton";
import { forums, firstForumsRender } from "../../actions/forums";
import { formatDateLegacy } from "../../helpers/date-formatter";

const ForumsHub = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allForums = useSelector((state) => state.forums);
  const navigate = useNavigate();
  const firstRender = useSelector((state) => state.forums.first_forums_render);
  const [searchTerm, setSearchTerm] = useState("");
  const [generalOpen, setGeneralOpen] = useState(true);
  const [gameOpen, setGameOpen] = useState(true);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(forums(1, 100));
    if (!firstRender) {
      dispatch(firstForumsRender());
    }
  }, [firstRender, dispatch]);

  function createNewPost() {
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to create a forum post." } });
      return;
    }
    navigate("/forums/new");
  }

  function handleRowClick(forumId, e) {
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      return;
    }
    navigate(`/forums/${forumId}`);
  }

  const allForumsList = allForums.forums || [];

  const generalForums = allForumsList.filter(forum => forum.game_type_id === null);
  const gameForums = allForumsList.filter(forum => forum.game_type_id !== null);

  const filterBySearch = (list) => {
    if (!searchTerm) return list;
    const term = searchTerm.toLowerCase();
    return list.filter(forum =>
      forum.title.toLowerCase().includes(term) ||
      (forum.content && forum.content.toLowerCase().includes(term)) ||
      (forum.author_name && forum.author_name.toLowerCase().includes(term))
    );
  };

  const filteredGeneral = filterBySearch(generalForums);
  const filteredGame = filterBySearch(gameForums);

  const renderForumRow = (forum, showGame) => (
    <tr
      key={forum.id}
      className={styles["forum-row"]}
      onClick={(e) => handleRowClick(forum.id, e)}
    >
      <td>
        <div className={styles["forums-link"]}>
          <strong><div className={styles["forum-title"]}>{forum.title}</div></strong>
        </div>
      </td>
      {showGame && (
        <td>
          {forum.game_type_id && forum.game_name ? (
            <Link to={`/games/${forum.game_type_id}`} onClick={(e) => e.stopPropagation()}>
              <div className={styles["game-name"]}>{forum.game_name}</div>
            </Link>
          ) : (
            <div className={styles["no-game"]}>—</div>
          )}
        </td>
      )}
      <td>
        <div className={styles["forums-link"]}>
          {forum.author_name ?
            <Link to={`/profile/${forum.author_name}`} onClick={(e) => e.stopPropagation()}>
              <div className={styles["forums-username"]}>{forum.author_name}</div>
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
          {formatDateLegacy(forum.created_at)}
        </div>
      </td>
    </tr>
  );

  return (
    <div className={styles["forums-hub-container"]}>
      <div className={styles["forums-hub-header"]}>
        <h1>Forums</h1>
        <p className={styles["subtitle"]}>
          Discuss strategies, share ideas, and connect with the community
        </p>
      </div>

      <div className={styles["search-container"]}>
        <input
          type="text"
          placeholder="Search all forums..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles["search-input"]}
        />
      </div>

      {/* General Forums Section */}
      <div className={styles["forum-section"]}>
        <div className={styles["section-header"]}>
          <button
            className={styles["collapse-toggle"]}
            onClick={() => setGeneralOpen(!generalOpen)}
            aria-label="Toggle general forums"
          >
            <span className={`${styles["chevron"]} ${generalOpen ? styles["open"] : ""}`}>▼</span>
          </button>
          <Link to="/forums/general" className={styles["section-title-link"]}>
            <h2 className={styles["section-title"]}>💬 General Forums</h2>
          </Link>
          <span className={styles["section-count"]}>{filteredGeneral.length}</span>
        </div>

        {generalOpen && (
          <div className={styles["section-content"]}>
            {filteredGeneral.length > 0 ? (
              <table className={styles["forums-table"]}>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Written By</th>
                    <th>Replies</th>
                    <th>Likes</th>
                    <th>Content</th>
                    <th>Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGeneral.map(forum => renderForumRow(forum, false))}
                </tbody>
              </table>
            ) : (
              <div className={styles["empty-section"]}>
                {searchTerm ? "No general forums matching your search" : "No general forum posts yet"}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Game Forums Section */}
      <div className={styles["forum-section"]}>
        <div className={styles["section-header"]}>
          <button
            className={styles["collapse-toggle"]}
            onClick={() => setGameOpen(!gameOpen)}
            aria-label="Toggle game forums"
          >
            <span className={`${styles["chevron"]} ${gameOpen ? styles["open"] : ""}`}>▼</span>
          </button>
          <Link to="/forums/game" className={styles["section-title-link"]}>
            <h2 className={styles["section-title"]}>♛ Game Forums</h2>
          </Link>
          <span className={styles["section-count"]}>{filteredGame.length}</span>
        </div>

        {gameOpen && (
          <div className={styles["section-content"]}>
            {filteredGame.length > 0 ? (
              <table className={styles["forums-table"]}>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Game</th>
                    <th>Written By</th>
                    <th>Replies</th>
                    <th>Likes</th>
                    <th>Content</th>
                    <th>Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGame.map(forum => renderForumRow(forum, true))}
                </tbody>
              </table>
            ) : (
              <div className={styles["empty-section"]}>
                {searchTerm ? "No game forums matching your search" : "No game forum posts yet"}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles["forums-actions"]}>
        <StandardButton buttonText={"Create New Post"} onClick={createNewPost} />
      </div>
    </div>
  );
};

export default ForumsHub;
