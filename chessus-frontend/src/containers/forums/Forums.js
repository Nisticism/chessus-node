import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "./forums.module.scss";
import StandardButton from "../../components/standardbutton/StandardButton";
import { forums, firstForumsRender } from "../../actions/forums";
import { formatDateLegacy } from "../../helpers/date-formatter";
import { categoryLabel } from "../../helpers/forum-categories";
import Pagination from "../../components/pagination/Pagination";
import ForumsService from "../../services/forums.service";

const Forums = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allForums = useSelector((state) => state.forums);
  const navigate = useNavigate();
  const firstRender = useSelector((state) => state.forums.first_forums_render);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [likedForums, setLikedForums] = useState({});
  const [likeCounts, setLikeCounts] = useState({});
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(forums(currentPage, 20, null, 'general'));
    if (!firstRender) {
      dispatch(firstForumsRender());
    }
  }, [currentPage, firstRender, dispatch]);

  // Sync liked state from server data whenever forums list refreshes
  const forumsData = allForums.forums || [];
  useEffect(() => {
    if (forumsData.length === 0) return;
    const likedState = {};
    const countState = {};
    forumsData.forEach(f => {
      likedState[f.id] = Boolean(f.liked_by_user);
      countState[f.id] = f.like_count || 0;
    });
    setLikedForums(likedState);
    setLikeCounts(countState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forumsData.map(f => f.id).join(','), currentUser?.id]);

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function createNewPost() {
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to create a forum post." } });
      return;
    }
    navigate("/forums/new");
  }

  function handleRowClick(forumId, e) {
    if (e.target.tagName === 'A' || e.target.closest('a')) return;
    if (e.target.closest('[data-like-cell]')) return;
    navigate(`/forums/${forumId}`);
  }

  async function handleLike(e, forumId) {
    e.stopPropagation();
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to like forum posts." } });
      return;
    }
    const wasLiked = likedForums[forumId];
    // Optimistic update
    setLikedForums(prev => ({ ...prev, [forumId]: !wasLiked }));
    setLikeCounts(prev => ({ ...prev, [forumId]: (prev[forumId] || 0) + (wasLiked ? -1 : 1) }));
    try {
      const result = await ForumsService.toggleForumLike(forumId);
      setLikedForums(prev => ({ ...prev, [forumId]: result.liked }));
      setLikeCounts(prev => ({ ...prev, [forumId]: result.like_count }));
    } catch (err) {
      // Revert on error
      setLikedForums(prev => ({ ...prev, [forumId]: wasLiked }));
      setLikeCounts(prev => ({ ...prev, [forumId]: (prev[forumId] || 0) + (wasLiked ? 1 : -1) }));
    }
  }

  const filteredForums = forumsData.filter(forum =>
    forum.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (forum.content && forum.content.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (forum.author_name && forum.author_name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const hasValidAuthor = (name) => name && name !== 'Anonymous' && name !== 'User Deleted';

  return (
    <div className="container">
      <header className="jumbotron">
        <h3 className={styles["forum-page-title"]}>General Forums</h3>
      </header>

      <div className={styles["search-container"]}>
        <input
          type="text"
          placeholder="Search forums..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className={styles["search-input"]}
        />
      </div>

      <div className={styles["forums"]}>
        {filteredForums && filteredForums.length > 0 ? (
          <table className={styles["forums-table"]}>
            <tbody>
              <tr>
                <th>Subject</th>
                <th>Category</th>
                <th>Written By</th>
                <th>Replies</th>
                <th>Likes</th>
                <th>Content</th>
                <th>Last Comment</th>
              </tr>
              {filteredForums.map(forum => (
                <tr
                  key={forum.id}
                  className={styles["forum-row"]}
                  onClick={(e) => handleRowClick(forum.id, e)}
                >
                  <td className={`${styles["subject-cell"]} ${styles["clickable-cell"]}`}>
                    <div className={styles["forums-link"]}>
                      <strong><div className={styles["forum-title"]}>{forum.title}</div></strong>
                    </div>
                  </td>
                  <td className={styles["clickable-cell"]}>
                    <span className={styles["category-pill"]}>{categoryLabel(forum.category)}</span>
                  </td>
                  <td
                    className={`${styles["author-cell"]} ${hasValidAuthor(forum.author_name) ? styles["clickable-cell"] : ''}`}
                    onClick={hasValidAuthor(forum.author_name)
                      ? (e) => { e.stopPropagation(); navigate(`/profile/${forum.author_name}`); }
                      : undefined}
                  >
                    <div className={styles["forums-link"]}>
                      <div className={styles["forums-username"]}>{forum.author_name || 'User Deleted'}</div>
                    </div>
                  </td>
                  <td className={styles["clickable-cell"]}>
                    <div className={styles["forums-comment-likes"]}>{forum.comment_count}</div>
                  </td>
                  <td
                    className={`${styles["like-cell"]} ${likedForums[forum.id] ? styles["like-cell-active"] : ''}`}
                    data-like-cell="true"
                    onClick={(e) => handleLike(e, forum.id)}
                    title={currentUser ? (likedForums[forum.id] ? "Unlike" : "Like this post") : "Log in to like"}
                  >
                    <span className={styles["like-icon"]}>{likedForums[forum.id] ? '♥' : '♡'}</span>
                    <span className={styles["like-count"]}>{likeCounts[forum.id] ?? forum.like_count ?? 0}</span>
                  </td>
                  <td className={`${styles["forums-link-content"]} ${styles["clickable-cell"]}`}>
                    <div className={styles["forum-content"]}>{forum.content}</div>
                  </td>
                  <td className={`${styles["date-td"]} ${styles["clickable-cell"]}`}>
                    <div className={styles["forums-date"]}>
                      {forum.last_comment_at ? (
                        <>
                          <span>{formatDateLegacy(forum.last_comment_at)}</span>
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
              ))}
            </tbody>
          </table>
        ) : (
          <h1>{searchTerm ? "No forums found matching your search" : "No Forums Found"}</h1>
        )}
      </div>

      {allForums.pagination && !searchTerm && (
        <Pagination
          currentPage={allForums.pagination.page}
          totalPages={allForums.pagination.totalPages}
          onPageChange={handlePageChange}
        />
      )}

      <div className="buttons">
        <StandardButton buttonText={"Create New Post"} onClick={createNewPost}/>
      </div>
    </div>
  );
};

export default Forums;