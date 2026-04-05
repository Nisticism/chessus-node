import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import { users } from "../../actions/users";
import Pagination from "../pagination/Pagination";
import styles from "../../styles/list-view.module.scss";

const getRoleBadge = (role) => {
  const roleLower = role?.toLowerCase();
  if (roleLower === 'owner') {
    return (
      <span style={{
        background: 'linear-gradient(135deg, #ffd700 0%, #ff8c00 100%)',
        color: '#1a1a2e',
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: '700',
        marginLeft: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        OWNER
      </span>
    );
  } else if (roleLower === 'admin') {
    return (
      <span style={{
        background: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)',
        color: '#ffffff',
        padding: '3px 8px',
        borderRadius: '4px',
        fontSize: '0.7rem',
        fontWeight: '700',
        marginLeft: '8px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        ADMIN
      </span>
    );
  }
  return null;
};

const sortOptions = [
  { value: 'id', label: 'Newest Joined' },
  { value: 'username', label: 'Alphabetical' },
  { value: 'elo', label: 'Rating' },
  { value: 'last_active_at', label: 'Last Active' },
];

const PlayerList = () => {
  const allUsers = useSelector((state) => state.users);
  const currentUser = useSelector((state) => state.auth?.user);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState('last_active_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [friendsOnly, setFriendsOnly] = useState(false);
  const dispatch = useDispatch();
  const searchTimeout = useRef(null);

  const fetchUsers = useCallback(() => {
    const filters = { sortBy, sortOrder };
    if (search) filters.search = search;
    if (friendsOnly && currentUser?.id) filters.friendsOf = currentUser.id;
    dispatch(users(currentPage, 20, filters));
  }, [currentPage, sortBy, sortOrder, search, friendsOnly, currentUser, dispatch]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearchChange = (e) => {
    const value = e.target.value;
    setSearchInput(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setSearch(value);
      setCurrentPage(1);
    }, 400);
  };

  const handleSortByChange = (e) => {
    setSortBy(e.target.value);
    setCurrentPage(1);
  };

  const handleSortOrderToggle = () => {
    setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    setCurrentPage(1);
  };

  const handleFriendsToggle = () => {
    setFriendsOnly(prev => !prev);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pagination = allUsers.pagination;
  const totalCount = pagination?.total || 0;

  return (
    <div className={styles["list-container"]}>
      <div className={styles["list-header"]}>
        <h1>Players</h1>
        <div className={styles["item-count"]}>
          {totalCount} {friendsOnly ? 'friends' : 'registered players'}
        </div>
        <Link to="/community/leaderboard" style={{ color: 'var(--accent-primary)', fontSize: '1rem', textDecoration: 'none', marginTop: '5px' }}>
          View Leaderboard →
        </Link>
      </div>

      <div className={styles["filter-bar"]}>
        <div className={styles["filter-group"]}>
          <label className={styles["filter-label"]}>Search</label>
          <input
            type="text"
            className={styles["filter-input"]}
            placeholder="Search by username..."
            value={searchInput}
            onChange={handleSearchChange}
          />
        </div>

        <div className={styles["filter-group"]}>
          <label className={styles["filter-label"]}>Sort By</label>
          <select
            className={styles["filter-select"]}
            value={sortBy}
            onChange={handleSortByChange}
          >
            {sortOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className={styles["filter-group"]}>
          <label className={styles["filter-label"]}>Order</label>
          <button
            className={styles["filter-order-btn"]}
            onClick={handleSortOrderToggle}
            title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortOrder === 'asc' ? '↑ Ascending' : '↓ Descending'}
          </button>
        </div>

        {currentUser && (
          <div className={styles["filter-group"]}>
            <label className={styles["filter-label"]}>Filter</label>
            <button
              className={`${styles["filter-toggle-btn"]} ${friendsOnly ? styles["active"] : ''}`}
              onClick={handleFriendsToggle}
            >
              {friendsOnly ? '★ Friends Only' : '☆ All Players'}
            </button>
          </div>
        )}
      </div>

      <div className={styles["items-grid"]}>
        {allUsers.usersList && allUsers.usersList.length > 0 ? (
          allUsers.usersList.map((user) => (
            <div key={user.id} className={styles["item-card"]}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '15px' }}>
                <div style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  flexShrink: 0,
                  background: 'linear-gradient(135deg, #4a90e2 0%, #357abd 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.5rem',
                  fontWeight: '700',
                  color: '#ffffff',
                  border: '2px solid #2a4d6c'
                }}>
                  {user.profile_picture ? (
                    <img 
                      src={`${process.env.REACT_APP_ASSET_URL || ""}${user.profile_picture}`}
                      alt={user.username}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <h2 className={styles["item-title"]} style={{ margin: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
                    <Link to={"/profile/" + user.username} style={{color: '#ffffff', textDecoration: 'none'}}>
                      {user.username}
                    </Link>
                    {getRoleBadge(user.role)}
                  </h2>
                </div>
              </div>
              
              <div className={styles["item-meta"]}>
                {user.elo !== undefined && user.elo !== null && (
                  <div className={styles["meta-row"]}>
                    <span className={styles["label"]}>Rating:</span>
                    <span style={{ fontWeight: '600', color: '#4a90e2' }}>{user.elo}</span>
                  </div>
                )}
                {user.last_active_at && (
                  <div className={styles["meta-row"]}>
                    <span className={styles["label"]}>Last Active:</span>
                    <span style={{ color: '#888' }}>
                      {new Date(user.last_active_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className={styles["empty-message"]}>
            {allUsers.loading ? "Loading players..." : "No players found"}
          </div>
        )}
      </div>

      {pagination && (
        <Pagination
          currentPage={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  );
};

export default PlayerList;