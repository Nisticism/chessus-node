import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { getFriends, removeFriend, setOnlineUsers } from "../../actions/friends";
import ListFilterBar from "../common/ListFilterBar";
import ListPager, { usePagedList } from "../common/ListPager";
import styles from "./friendslist.module.scss";
import DefaultAvatar from "../../assets/pieces/legacy/White-pawn.png";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const FriendsList = ({ userId, showOnlineOnly = false, socket, friendsOverride, onChallenge }) => {
  const dispatch = useDispatch();
  const { friends, onlineUsers } = useSelector((state) => state.friends);
  const currentUser = useSelector((state) => state.authReducer.user);
  const [query, setQuery] = useState('');
  const [onlineFilter, setOnlineFilter] = useState('all');

  // Use friendsOverride if provided, otherwise use friends from Redux
  const friendsList = friendsOverride || friends;

  useEffect(() => {
    // Only fetch friends if no override is provided
    if (userId && !friendsOverride) {
      dispatch(getFriends(userId));
    }
  }, [userId, dispatch, friendsOverride]);

  // Listen for online users updates from socket
  useEffect(() => {
    if (socket) {
      socket.on("onlineUsers", (users) => {
        dispatch(setOnlineUsers(users));
      });

      return () => {
        socket.off("onlineUsers");
      };
    }
  }, [socket, dispatch]);

  const handleRemoveFriend = async (friendId) => {
    if (window.confirm("Are you sure you want to remove this friend?")) {
      try {
        await dispatch(removeFriend(userId, friendId));
      } catch (error) {
        console.error("Error removing friend:", error);
      }
    }
  };

  const isOnline = (friendId) => {
    return onlineUsers.includes(friendId);
  };

  // If friendsOverride is provided, it's already filtered (e.g., server-side online filter)
  // Don't apply additional showOnlineOnly filter to avoid desync issues
  const baseFriends = showOnlineOnly && !friendsOverride
    ? friendsList.filter((friend) => isOnline(friend.id))
    : friendsList;

  // The search bar's own online filter, on top of whatever the caller asked
  // for. Only surfaced once the list is long enough to warrant it.
  const displayedFriends = baseFriends.filter((friend) => {
    const q = query.trim().toLowerCase();
    if (q && !(friend.username || '').toLowerCase().includes(q)) return false;
    if (onlineFilter === 'online') return isOnline(friend.id);
    if (onlineFilter === 'offline') return !isOnline(friend.id);
    return true;
  });

  const paged = usePagedList(displayedFriends);

  // Only a genuinely empty list gets the empty state. A search that matches
  // nothing must keep the search bar on screen, or there is no way back.
  if (baseFriends.length === 0) {
    return (
      <div className={styles["empty-state"]}>
        <p>{showOnlineOnly ? "No friends online" : "No friends yet"}</p>
        {!showOnlineOnly && (
          <p className={styles["hint"]}>
            Visit other users' profiles to add them as friends
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={styles["friends-list"]}>
      <ListFilterBar
        total={baseFriends.length}
        shown={displayedFriends.length}
        query={query}
        onQueryChange={setQuery}
        placeholder="Search friends"
        filters={[
          { value: 'all', label: 'All' },
          { value: 'online', label: 'Online' },
          { value: 'offline', label: 'Offline' },
        ]}
        filter={onlineFilter}
        onFilterChange={setOnlineFilter}
        label="friends"
      />
      {displayedFriends.length === 0 && (
        <p className={styles["hint"]}>No friends match that search.</p>
      )}
      {paged.pageItems.map((friend) => (
        <div key={friend.id} className={styles["friend-card"]}>
          <Link to={`/profile/${friend.username}`} className={styles["friend-info"]}>
            <div className={styles["friend-avatar-wrapper"]}>
              <img
                src={
                  friend.profile_picture
                    ? `${ASSET_URL}${friend.profile_picture}`
                    : DefaultAvatar
                }
                alt={friend.username}
                loading="lazy"
                className={styles["friend-avatar"]}
              />
              {isOnline(friend.id) && (
                <span className={styles["online-indicator"]} title="Online"></span>
              )}
            </div>
            <div className={styles["friend-details"]}>
              <span className={styles["friend-username"]}>{friend.username}</span>
              <span className={styles["friend-elo"]}>ELO: {friend.elo || 1000}</span>
            </div>
          </Link>
          <div className={styles["friend-actions"]}>
            {onChallenge && isOnline(friend.id) && (
              <button
                className={styles["challenge-button"]}
                onClick={() => onChallenge(friend.id, friend.username)}
                title="Challenge to a game"
              >
                ⚔️
              </button>
            )}
            {currentUser && currentUser.id === parseInt(userId) && (
              <button
                className={styles["remove-button"]}
                onClick={() => handleRemoveFriend(friend.id)}
                title="Remove friend"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
      <ListPager {...paged} label="friends" />
    </div>
  );
};

export default FriendsList;
