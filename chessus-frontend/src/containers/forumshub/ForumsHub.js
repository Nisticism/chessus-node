import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { useSelector } from "react-redux";
import styles from "./forumshub.module.scss";
import StandardButton from "../../components/standardbutton/StandardButton";
import { formatDateLegacy } from "../../helpers/date-formatter";
import { categoryLabel, FORUM_CATEGORIES } from "../../helpers/forum-categories";
import Pagination from "../../components/pagination/Pagination";
import ForumsService from "../../services/forums.service";

const SECTION_PAGE_SIZE = 10;

const SORT_OPTIONS = [
  { value: 'activity', label: 'Activity' },
  { value: 'created', label: 'Date Created' },
  { value: 'author', label: 'Author' },
  { value: 'replies', label: 'Replies' },
  { value: 'likes', label: 'Likes' },
];

const ForumsHub = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState("activity");
  const [sortOrder, setSortOrder] = useState("desc");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [generalOpen, setGeneralOpen] = useState(true);
  const [gameOpen, setGameOpen] = useState(true);
  const [generalPage, setGeneralPage] = useState(1);
  const [gamePage, setGamePage] = useState(1);
  const [likedForums, setLikedForums] = useState({});
  const [likeCounts, setLikeCounts] = useState({});

  // Server-fetched data for each section
  const [generalForums, setGeneralForums] = useState([]);
  const [generalTotal, setGeneralTotal] = useState(0);
  const [generalTotalPages, setGeneralTotalPages] = useState(0);
  const [gameForums, setGameForums] = useState([]);
  const [gameTotal, setGameTotal] = useState(0);
  const [gameTotalPages, setGameTotalPages] = useState(0);

  // Debounce search — reset both sections to page 1 when it fires
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setGeneralPage(1);
      setGamePage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch general forums from server whenever filters/sort/page change
  useEffect(() => {
    ForumsService.getForums(generalPage, SECTION_PAGE_SIZE, null, 'general', categoryFilter || null, debouncedSearch || null, sortBy, sortOrder)
      .then(res => {
        const data = res.data;
        const list = data.forums || [];
        setGeneralForums(list);
        setGeneralTotal(data.pagination?.total || 0);
        setGeneralTotalPages(data.pagination?.totalPages || 0);
        const likedState = {};
        const countState = {};
        list.forEach(f => { likedState[f.id] = Boolean(f.liked_by_user); countState[f.id] = f.like_count || 0; });
        setLikedForums(prev => ({ ...prev, ...likedState }));
        setLikeCounts(prev => ({ ...prev, ...countState }));
      })
      .catch(err => console.error("Error fetching general forums:", err));
  }, [generalPage, debouncedSearch, sortBy, sortOrder, categoryFilter]);

  // Fetch game forums from server whenever filters/sort/page change
  useEffect(() => {
    ForumsService.getForums(gamePage, SECTION_PAGE_SIZE, null, 'game', null, debouncedSearch || null, sortBy, sortOrder)
      .then(res => {
        const data = res.data;
        const list = data.forums || [];
        setGameForums(list);
        setGameTotal(data.pagination?.total || 0);
        setGameTotalPages(data.pagination?.totalPages || 0);
        const likedState = {};
        const countState = {};
        list.forEach(f => { likedState[f.id] = Boolean(f.liked_by_user); countState[f.id] = f.like_count || 0; });
        setLikedForums(prev => ({ ...prev, ...likedState }));
        setLikeCounts(prev => ({ ...prev, ...countState }));
      })
      .catch(err => console.error("Error fetching game forums:", err));
  }, [gamePage, debouncedSearch, sortBy, sortOrder]);

  async function handleLike(e, forumId) {
    e.stopPropagation();
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to like forum posts." } });
      return;
    }
    const wasLiked = likedForums[forumId];
    setLikedForums(prev => ({ ...prev, [forumId]: !wasLiked }));
    setLikeCounts(prev => ({ ...prev, [forumId]: (prev[forumId] || 0) + (wasLiked ? -1 : 1) }));
    try {
      const result = await ForumsService.toggleForumLike(forumId);
      setLikedForums(prev => ({ ...prev, [forumId]: result.liked }));
      setLikeCounts(prev => ({ ...prev, [forumId]: result.like_count }));
    } catch (err) {
      setLikedForums(prev => ({ ...prev, [forumId]: wasLiked }));
      setLikeCounts(prev => ({ ...prev, [forumId]: (prev[forumId] || 0) + (wasLiked ? 1 : -1) }));
    }
  }

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

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  const handleSortChange = (value) => {
    setSortBy(value);
    setGeneralPage(1);
    setGamePage(1);
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    setGeneralPage(1);
    setGamePage(1);
  };

  const handleCategoryChange = (e) => {
    setCategoryFilter(e.target.value);
    setGeneralPage(1);
  };

  const hasValidAuthor = (name) => name && name !== 'Anonymous' && name !== 'User Deleted';
  const isFiltered = debouncedSearch || categoryFilter;

  const renderForumRow = (forum, showGame, showCategory) => (
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
      {showCategory && (
        <td className={styles["clickable-cell"]}>
          <span className={styles["category-pill"]}>{categoryLabel(forum.category)}</span>
        </td>
      )}
      {showGame && (
        <td className={`${styles["clickable-cell"]} ${styles["game-name-td"]}`}>
          {forum.game_type_id && forum.game_name ? (
            <div className={styles["game-name"]}>
              <Link to={`/games/${forum.game_type_id}`} onClick={(e) => e.stopPropagation()}>
                {forum.game_name}
              </Link>
            </div>
          ) : (
            <div className={styles["no-game"]}>—</div>
          )}
        </td>
      )}
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
  );

  return (
    <div className={styles["forums-hub-container"]}>
      <div className={styles["forums-hub-header"]}>
        <h1>Forums</h1>
        <p className={styles["subtitle"]}>
          Discuss strategies, share ideas, and connect with the community
        </p>
      </div>

      <div className={styles["filter-bar"]}>
        <div className={styles["search-wrapper"]}>
          <span className={styles["search-icon"]}>&#128269;</span>
          <input
            type="text"
            placeholder="Search by subject, author, or game..."
            value={searchTerm}
            onChange={handleSearchChange}
            className={styles["search-input"]}
          />
          {searchTerm && (
            <button className={styles["search-clear"]} onClick={() => { setSearchTerm(""); setGeneralPage(1); setGamePage(1); }} aria-label="Clear search">&#215;</button>
          )}
        </div>
        <div className={styles["filter-controls"]}>
          <div className={styles["filter-group"]}>
            <span className={styles["filter-label"]}>Category</span>
            <select
              className={styles["filter-select"]}
              value={categoryFilter}
              onChange={handleCategoryChange}
            >
              <option value="">All Categories</option>
              {FORUM_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className={styles["filter-group"]}>
            <span className={styles["filter-label"]}>Sort by</span>
            <div className={styles["sort-pills"]}>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`${styles["sort-pill"]} ${sortBy === opt.value ? styles["sort-pill-active"] : ''}`}
                  onClick={() => handleSortChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className={styles["order-btn"]}
            onClick={toggleSortOrder}
            title={sortOrder === 'desc' ? 'Descending — click to switch' : 'Ascending — click to switch'}
          >
            {sortOrder === 'desc' ? '↓ Newest' : '↑ Oldest'}
          </button>
        </div>
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
          <span className={styles["section-count"]}>{generalTotal}</span>
        </div>

        {generalOpen && (
          <div className={styles["section-content"]}>
            {generalForums.length > 0 ? (
              <>
                <table className={styles["forums-table"]}>
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Category</th>
                      <th>Written By</th>
                      <th>Replies</th>
                      <th>Likes</th>
                      <th>Content</th>
                      <th>Last Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {generalForums.map(forum => renderForumRow(forum, false, true))}
                  </tbody>
                </table>
                <div className={styles["section-pagination"]}>
                  <Pagination
                    currentPage={generalPage}
                    totalPages={generalTotalPages}
                    onPageChange={(p) => { setGeneralPage(p); }}
                  />
                </div>
              </>
            ) : (
              <div className={styles["empty-section"]}>
                {isFiltered ? "No general forums matching your filters" : "No general forum posts yet"}
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
          <span className={styles["section-count"]}>{gameTotal}</span>
        </div>

        {gameOpen && (
          <div className={styles["section-content"]}>
            {gameForums.length > 0 ? (
              <>
                <table className={styles["forums-table"]}>
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Game</th>
                      <th>Written By</th>
                      <th>Replies</th>
                      <th>Likes</th>
                      <th>Content</th>
                      <th>Last Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gameForums.map(forum => renderForumRow(forum, true, false))}
                  </tbody>
                </table>
                <div className={styles["section-pagination"]}>
                  <Pagination
                    currentPage={gamePage}
                    totalPages={gameTotalPages}
                    onPageChange={(p) => { setGamePage(p); }}
                  />
                </div>
              </>
            ) : (
              <div className={styles["empty-section"]}>
                {isFiltered ? "No game forums matching your filters" : "No game forum posts yet"}
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

const SECTION_PAGE_SIZE = 10;

const SORT_OPTIONS = [
  { value: 'activity', label: 'Activity' },
  { value: 'created', label: 'Date Created' },
  { value: 'author', label: 'Author' },
  { value: 'replies', label: 'Replies' },
  { value: 'likes', label: 'Likes' },
];

// Client-side sort comparator
// searchTerm is optional: when provided and sortBy is a text field ('author'/'game'),
// results where that field directly matches the search term are bubbled to the top.
function sortForums(list, sortBy, sortOrder, searchTerm) {
  const dir = sortOrder === 'asc' ? 1 : -1;
  const term = searchTerm ? searchTerm.toLowerCase() : null;
  return [...list].sort((a, b) => {
    // Relevance prefix: if the active sort field can directly match the search
    // term, results where it does match rank above those where only a different
    // field matched.
    if (term && sortBy === 'author') {
      const aMatch = (a.author_name || '').toLowerCase().includes(term) ? 1 : 0;
      const bMatch = (b.author_name || '').toLowerCase().includes(term) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
    }
    if (term && sortBy === 'game') {
      const aMatch = (a.game_name || '').toLowerCase().includes(term) ? 1 : 0;
      const bMatch = (b.game_name || '').toLowerCase().includes(term) ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
    }

    let aVal, bVal;
    switch (sortBy) {
      case 'created':
        aVal = new Date(a.created_at).getTime();
        bVal = new Date(b.created_at).getTime();
        break;
      case 'author':
        aVal = (a.author_name || '').toLowerCase();
        bVal = (b.author_name || '').toLowerCase();
        return dir * aVal.localeCompare(bVal);
      case 'replies':
        aVal = a.comment_count || 0;
        bVal = b.comment_count || 0;
        break;
      case 'likes':
        aVal = a.like_count || 0;
        bVal = b.like_count || 0;
        break;
      default: // activity
        aVal = new Date(a.last_comment_at || a.created_at).getTime();
        bVal = new Date(b.last_comment_at || b.created_at).getTime();
    }
    return dir * (aVal < bVal ? -1 : aVal > bVal ? 1 : 0);
  });
}

const ForumsHub = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allForums = useSelector((state) => state.forums);
  const navigate = useNavigate();
  const firstRender = useSelector((state) => state.forums.first_forums_render);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("activity");
  const [sortOrder, setSortOrder] = useState("desc");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [generalOpen, setGeneralOpen] = useState(true);
  const [gameOpen, setGameOpen] = useState(true);
  const [generalPage, setGeneralPage] = useState(1);
  const [gamePage, setGamePage] = useState(1);
  const [likedForums, setLikedForums] = useState({});
  const [likeCounts, setLikeCounts] = useState({});
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(forums(1, 100));
    if (!firstRender) {
      dispatch(firstForumsRender());
    }
  }, [firstRender, dispatch]);

  const allForumsList = allForums.forums || [];

  // Sync liked state from server data whenever forums list refreshes
  useEffect(() => {
    if (allForumsList.length === 0) return;
    const likedState = {};
    const countState = {};
    allForumsList.forEach(f => {
      likedState[f.id] = Boolean(f.liked_by_user);
      countState[f.id] = f.like_count || 0;
    });
    setLikedForums(likedState);
    setLikeCounts(countState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allForumsList.map(f => f.id).join(','), currentUser?.id]);

  async function handleLike(e, forumId) {
    e.stopPropagation();
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to like forum posts." } });
      return;
    }
    const wasLiked = likedForums[forumId];
    setLikedForums(prev => ({ ...prev, [forumId]: !wasLiked }));
    setLikeCounts(prev => ({ ...prev, [forumId]: (prev[forumId] || 0) + (wasLiked ? -1 : 1) }));
    try {
      const result = await ForumsService.toggleForumLike(forumId);
      setLikedForums(prev => ({ ...prev, [forumId]: result.liked }));
      setLikeCounts(prev => ({ ...prev, [forumId]: result.like_count }));
    } catch (err) {
      setLikedForums(prev => ({ ...prev, [forumId]: wasLiked }));
      setLikeCounts(prev => ({ ...prev, [forumId]: (prev[forumId] || 0) + (wasLiked ? 1 : -1) }));
    }
  }

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

  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
    setGeneralPage(1);
    setGamePage(1);
  };

  const handleSortChange = (value) => {
    setSortBy(value);
    setGeneralPage(1);
    setGamePage(1);
  };

  const toggleSortOrder = () => {
    setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc');
    setGeneralPage(1);
    setGamePage(1);
  };

  const handleCategoryChange = (e) => {
    setCategoryFilter(e.target.value);
    setGeneralPage(1);
  };

  // Search: title and author only — not content
  const filterBySearch = (list) => {
    const term = searchTerm.toLowerCase();
    return list.filter(forum =>
      forum.title.toLowerCase().includes(term) ||
      (forum.author_name && forum.author_name.toLowerCase().includes(term)) ||
      (forum.game_name && forum.game_name.toLowerCase().includes(term))
    );
  };

  const rawGeneral = allForumsList.filter(f => f.game_type_id === null);
  const rawGame = allForumsList.filter(f => f.game_type_id !== null);

  const applyFilters = (list, isGame) => {
    let result = searchTerm ? filterBySearch(list) : list;
    if (!isGame && categoryFilter) {
      result = result.filter(f => f.category === categoryFilter);
    }
    return sortForums(result, sortBy, sortOrder, searchTerm || null);
  };

  const filteredGeneral = applyFilters(rawGeneral, false);
  const filteredGame = applyFilters(rawGame, true);

  const generalTotalPages = Math.ceil(filteredGeneral.length / SECTION_PAGE_SIZE);
  const gameTotalPages = Math.ceil(filteredGame.length / SECTION_PAGE_SIZE);

  const pagedGeneral = filteredGeneral.slice(
    (generalPage - 1) * SECTION_PAGE_SIZE,
    generalPage * SECTION_PAGE_SIZE
  );
  const pagedGame = filteredGame.slice(
    (gamePage - 1) * SECTION_PAGE_SIZE,
    gamePage * SECTION_PAGE_SIZE
  );

  const hasValidAuthor = (name) => name && name !== 'Anonymous' && name !== 'User Deleted';
  const isFiltered = searchTerm || categoryFilter;

  const renderForumRow = (forum, showGame, showCategory) => (
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
      {showCategory && (
        <td className={styles["clickable-cell"]}>
          <span className={styles["category-pill"]}>{categoryLabel(forum.category)}</span>
        </td>
      )}
      {showGame && (
        <td className={`${styles["clickable-cell"]} ${styles["game-name-td"]}`}>
          {forum.game_type_id && forum.game_name ? (
            <div className={styles["game-name"]}>
              <Link to={`/games/${forum.game_type_id}`} onClick={(e) => e.stopPropagation()}>
                {forum.game_name}
              </Link>
            </div>
          ) : (
            <div className={styles["no-game"]}>—</div>
          )}
        </td>
      )}
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
  );

  return (
    <div className={styles["forums-hub-container"]}>
      <div className={styles["forums-hub-header"]}>
        <h1>Forums</h1>
        <p className={styles["subtitle"]}>
          Discuss strategies, share ideas, and connect with the community
        </p>
      </div>

      <div className={styles["filter-bar"]}>
        <div className={styles["search-wrapper"]}>
          <span className={styles["search-icon"]}>&#128269;</span>
          <input
            type="text"
            placeholder="Search by subject, author, or game..."
            value={searchTerm}
            onChange={handleSearchChange}
            className={styles["search-input"]}
          />
          {searchTerm && (
            <button className={styles["search-clear"]} onClick={() => { setSearchTerm(""); setGeneralPage(1); setGamePage(1); }} aria-label="Clear search">&#215;</button>
          )}
        </div>
        <div className={styles["filter-controls"]}>
          <div className={styles["filter-group"]}>
            <span className={styles["filter-label"]}>Category</span>
            <select
              className={styles["filter-select"]}
              value={categoryFilter}
              onChange={handleCategoryChange}
            >
              <option value="">All Categories</option>
              {FORUM_CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className={styles["filter-group"]}>
            <span className={styles["filter-label"]}>Sort by</span>
            <div className={styles["sort-pills"]}>
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`${styles["sort-pill"]} ${sortBy === opt.value ? styles["sort-pill-active"] : ''}`}
                  onClick={() => handleSortChange(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <button
            className={styles["order-btn"]}
            onClick={toggleSortOrder}
            title={sortOrder === 'desc' ? 'Descending — click to switch' : 'Ascending — click to switch'}
          >
            {sortOrder === 'desc' ? '↓ Newest' : '↑ Oldest'}
          </button>
        </div>
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
              <>
                <table className={styles["forums-table"]}>
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Category</th>
                      <th>Written By</th>
                      <th>Replies</th>
                      <th>Likes</th>
                      <th>Content</th>
                      <th>Last Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGeneral.map(forum => renderForumRow(forum, false, true))}
                  </tbody>
                </table>
                <div className={styles["section-pagination"]}>
                  <Pagination
                    currentPage={generalPage}
                    totalPages={generalTotalPages}
                    onPageChange={(p) => { setGeneralPage(p); }}
                  />
                </div>
              </>
            ) : (
              <div className={styles["empty-section"]}>
                {isFiltered ? "No general forums matching your filters" : "No general forum posts yet"}
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
              <>
                <table className={styles["forums-table"]}>
                  <thead>
                    <tr>
                      <th>Subject</th>
                      <th>Game</th>
                      <th>Written By</th>
                      <th>Replies</th>
                      <th>Likes</th>
                      <th>Content</th>
                      <th>Last Comment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGame.map(forum => renderForumRow(forum, true, false))}
                  </tbody>
                </table>
                <div className={styles["section-pagination"]}>
                  <Pagination
                    currentPage={gamePage}
                    totalPages={gameTotalPages}
                    onPageChange={(p) => { setGamePage(p); }}
                  />
                </div>
              </>
            ) : (
              <div className={styles["empty-section"]}>
                {isFiltered ? "No game forums matching your filters" : "No game forum posts yet"}
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