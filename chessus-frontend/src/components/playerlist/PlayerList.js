import React, { useState, useEffect } from "react";
import { Navigate, Link } from 'react-router-dom';
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

const PlayerList = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allUsers = useSelector((state) => state.users);
  const [currentPage, setCurrentPage] = useState(1);
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(users(currentPage, 20));
  }, [currentPage, dispatch]);

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  const pagination = allUsers.pagination;
  const totalCount = pagination?.total || 0;

  return (
    <div className={styles["list-container"]}>
      <div className={styles["list-header"]}>
        <h1>Players</h1>
        <div className={styles["item-count"]}>
          {totalCount} registered players
        </div>
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