import React, { useState, useEffect } from "react";
import { Navigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import { users } from "../../actions/users";
import styles from "../../styles/list-view.module.scss";

const PlayerList = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allUsers = useSelector((state) => state.users);
  const [firstRender, setFirstRender] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firstRender) {
      dispatch(users());
      setFirstRender(true);
    }
  }, [firstRender, dispatch]);

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in to view this page" }} />;
  }

  return (
    <div className={styles["list-container"]}>
      <div className={styles["list-header"]}>
        <h1>Players</h1>
        <div className={styles["item-count"]}>
          {allUsers.usersList ? allUsers.usersList.length : 0} registered players
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
                      src={`http://localhost:3001${user.profile_picture}`}
                      alt={user.username}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <h2 className={styles["item-title"]} style={{ margin: 0 }}>
                    <Link to={"/profile/" + user.username} style={{color: '#ffffff', textDecoration: 'none'}}>
                      {user.username}
                    </Link>
                  </h2>
                </div>
              </div>
              
              <div className={styles["item-meta"]}>
                {user.first_name && (
                  <div className={styles["meta-row"]}>
                    <span className={styles["label"]}>Name:</span>
                    <span>{user.first_name} {user.last_name || ''}</span>
                  </div>
                )}

                {user.email && (
                  <div className={styles["meta-row"]}>
                    <span className={styles["label"]}>Email:</span>
                    <span>{user.email}</span>
                  </div>
                )}

                <div className={styles["meta-row"]}>
                  <span className={styles["label"]}>User ID:</span>
                  <span>{user.id}</span>
                </div>

                {user.role && (
                  <div className={styles["meta-row"]}>
                    <span className={styles["label"]}>Role:</span>
                    <span>{user.role}</span>
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
    </div>
  );
};

export default PlayerList;