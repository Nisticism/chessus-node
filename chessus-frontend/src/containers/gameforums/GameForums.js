import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "../forums/forums.module.scss";
import { forums } from "../../actions/forums";
import { formatDateLegacy } from "../../helpers/date-formatter";
import Pagination from "../../components/pagination/Pagination";

const GameForums = () => {
  const allForums = useSelector((state) => state.forums);
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const dispatch = useDispatch();

  useEffect(() => {
    // Server-side filter to game scope so pagination total / pages reflect
    // ONLY game forums (previously we used the unfiltered total which left
    // empty pages when general forums dominated).
    dispatch(forums(currentPage, 20, null, 'game'));
  }, [currentPage, dispatch]);

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function handleRowClick(forumId, e) {
    if (e.target.tagName === 'A' || e.target.closest('a')) {
      return;
    }
    navigate(`/forums/${forumId}`);
  }



  // Server already filtered to game forums; client search trims further.
  const gameForums = allForums.forums || [];

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
                <th>Game</th>
                <th>Written By</th>
                <th>Replies</th>
                <th>Likes</th>
                <th>Content</th>
                <th>Last Comment</th>
              </tr>
              {filteredForums.map(function(forum) {
                return (
                  <tr 
                    key={forum.id} 
                    className={styles["forum-row"]}
                    onClick={(e) => handleRowClick(forum.id, e)}
                  >
                    <td className={styles["subject-cell"]}>
                      <div className={styles["forums-link"]}>
                        <strong><div className={styles["forum-title"]}>{ forum.title }</div></strong>
                      </div>
                    </td>
                    <td>
                      {forum.game_type_id && forum.game_name ? (
                        <div className={styles["game-link"]}>
                          <Link to={`/games/${forum.game_type_id}`} onClick={(e) => e.stopPropagation()}>
                            <div className={styles["game-name"]}>{ forum.game_name }</div>
                          </Link>
                        </div>
                      ) : (
                        <div className={styles["no-game"]}>General</div>
                      )}
                    </td>
                    <td className={styles["author-cell"]}>
                      <div className={styles["forums-link"]}>
                        { forum.author_name && forum.author_name !== 'Anonymous' ? 
                          <Link to={`/profile/${forum.author_name}`} onClick={(e) => e.stopPropagation()}>
                            <div className={styles["forums-username"]}>{ forum.author_name }</div>
                          </Link>
                        : 
                          <div className={styles["forums-username"]}>{ forum.author_name || 'User Deleted' }</div>
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
                        {forum.last_comment_at ? (
                          <>
                            {formatDateLegacy(forum.last_comment_at)}
                            {forum.last_comment_author_name && (
                              <div style={{ fontSize: '0.8em', opacity: 0.8 }}>
                                by{' '}
                                <Link
                                  to={`/profile/${forum.last_comment_author_name}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {forum.last_comment_author_name}
                                </Link>
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ opacity: 0.6 }}>No comments yet</span>
                        )}
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

      {allForums.pagination && !searchTerm && (
        <Pagination
          currentPage={allForums.pagination.page}
          totalPages={allForums.pagination.totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
};

export default GameForums;
