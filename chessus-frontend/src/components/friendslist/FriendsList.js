import React, { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link } from "react-router-dom";
import { getFriends, removeFriend, setOnlineUsers } from "../../actions/friends";
import styles from "./friendslist.module.scss";
import DefaultAvatar from "../../assets/pieces/White-pawn.png";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const FriendsList = ({ userId, showOnlineOnly = false, socket, friendsOverride }) => {
  const dispatch = useDispatch();
  const { friends, onlineUsers } = useSelector((state) => state.friends);
  const currentUser = useSelector((state) => state.authReducer.user);

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
  const displayedFriends = showOnlineOnly && !friendsOverride
    ? friendsList.filter((friend) => isOnline(friend.id))
    : friendsList;

  if (displayedFriends.length === 0) {
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
      {displayedFriends.map((friend) => (
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
      ))}
    </div>
  );
};

export default FriendsList;
