import React, { useEffect, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  markNotificationActioned,
  deleteNotification,
} from "../../actions/notifications";
import { acceptFriendRequest, declineFriendRequest } from "../../actions/friends";
import styles from "./notifications.module.scss";
import { parseServerDate } from "../../helpers/date-formatter";

const NOTIFICATION_ICONS = {
  friend_request: "👥",
  challenge: "⚔️",
  comment: "💬",
  game_thread: "🎮",
  game_move: "♟️",
  system: "📢",
};

const formatTimeAgo = (dateStr) => {
  const date = parseServerDate(dateStr);
  if (!date) return '';
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
};

const NotificationsPage = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { notifications, unreadCount } = useSelector(
    (state) => state.notifications
  );
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const loadNotifications = useCallback(
    async (pageNum = 1) => {
      if (!currentUser) return;
      setLoading(true);
      try {
        const result = await dispatch(getNotifications(currentUser.id, pageNum));
        if (result && result.notifications.length < 20) {
          setHasMore(false);
        }
      } catch (err) {
        console.error("Failed to load notifications:", err);
      } finally {
        setLoading(false);
      }
    },
    [currentUser, dispatch]
  );

  useEffect(() => {
    loadNotifications(1);
  }, [loadNotifications]);

  const handleMarkAllRead = () => {
    if (currentUser) {
      dispatch(markAllNotificationsRead(currentUser.id));
    }
  };

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    loadNotifications(nextPage);
  };

  const handleNotificationClick = (notification) => {
    if (!notification.is_read) {
      dispatch(markNotificationRead(currentUser.id, notification.id));
    }
    if (notification.action_url) {
      navigate(notification.action_url);
    }
  };

  const handleAcceptFriend = async (e, notification) => {
    e.stopPropagation();
    if (!notification.related_id && !notification.sender_id) return;
    try {
      // The related_id for friend requests is the friend request record.
      // We need to find the request ID. Use sender_id to accept.
      await dispatch(
        acceptFriendRequest(currentUser.id, notification.related_id || notification.sender_id)
      );
      dispatch(markNotificationActioned(currentUser.id, notification.id));
    } catch (err) {
      console.error("Failed to accept friend request:", err);
    }
  };

  const handleDeclineFriend = async (e, notification) => {
    e.stopPropagation();
    try {
      await dispatch(
        declineFriendRequest(currentUser.id, notification.related_id || notification.sender_id)
      );
      dispatch(markNotificationActioned(currentUser.id, notification.id));
    } catch (err) {
      console.error("Failed to decline friend request:", err);
    }
  };

  const handleViewChallenge = (e, notification) => {
    e.stopPropagation();
    dispatch(markNotificationRead(currentUser.id, notification.id));
    if (notification.action_url) {
      navigate(notification.action_url);
    }
  };

  const handleDismiss = (e, notification) => {
    e.stopPropagation();
    dispatch(deleteNotification(currentUser.id, notification.id));
  };

  if (!currentUser) {
    return (
      <div className={styles["notifications-login-prompt"]}>
        <p>
          Please <Link to="/login">sign in</Link> to view your notifications.
        </p>
      </div>
    );
  }

  return (
    <div className={styles["notifications-container"]}>
      <div className={styles["notifications-header"]}>
        <h1 className={styles["notifications-title"]}>
          Notifications {unreadCount > 0 && `(${unreadCount})`}
        </h1>
        <div className={styles["notifications-actions"]}>
          <button
            className={styles["mark-all-read-btn"]}
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
          >
            Mark all as read
          </button>
        </div>
      </div>

      {loading && notifications.length === 0 ? (
        <div className={styles["notifications-loading"]}>
          Loading notifications...
        </div>
      ) : notifications.length === 0 ? (
        <div className={styles["notifications-empty"]}>
          <div className={styles["empty-icon"]}>🔔</div>
          <p>No notifications yet</p>
        </div>
      ) : (
        <>
          <div className={styles["notifications-list"]}>
            {notifications.map((notification) => (
              <div
                key={notification.id}
                className={`${styles["notification-item"]} ${styles[`type-${notification.type}`] || ""} ${
                  !notification.is_read ? styles.unread : ""
                } ${notification.is_actioned ? styles.actioned : ""}`}
                onClick={() => handleNotificationClick(notification)}
              >
                <div className={styles["notification-icon"]}>
                  {NOTIFICATION_ICONS[notification.type] || "📌"}
                </div>
                <div className={styles["notification-body"]}>
                  <div className={styles["notification-title"]}>
                    {notification.title}
                  </div>
                  {notification.content && (
                    <div className={styles["notification-content"]}>
                      {notification.content}
                    </div>
                  )}
                  <div className={styles["notification-time"]}>
                    {formatTimeAgo(notification.created_at)}
                    {notification.sender_username &&
                      ` · from ${notification.sender_username}`}
                  </div>

                  {/* Action buttons for specific notification types */}
                  {notification.type === "friend_request" &&
                    !notification.is_actioned && (
                      <div className={styles["notification-actions-row"]}>
                        <button
                          className={`${styles["notification-action-btn"]} ${styles.accept}`}
                          onClick={(e) => handleAcceptFriend(e, notification)}
                        >
                          Accept
                        </button>
                        <button
                          className={`${styles["notification-action-btn"]} ${styles.decline}`}
                          onClick={(e) => handleDeclineFriend(e, notification)}
                        >
                          Decline
                        </button>
                      </div>
                    )}

                  {notification.type === "challenge" &&
                    !notification.is_actioned && (
                      <div className={styles["notification-actions-row"]}>
                        <button
                          className={`${styles["notification-action-btn"]} ${styles.view}`}
                          onClick={(e) => handleViewChallenge(e, notification)}
                        >
                          View Challenge
                        </button>
                      </div>
                    )}

                  {notification.type === "comment" && (
                    <div className={styles["notification-actions-row"]}>
                      <button
                        className={`${styles["notification-action-btn"]} ${styles.view}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNotificationClick(notification);
                        }}
                      >
                        View Post
                      </button>
                    </div>
                  )}

                  {notification.type === "game_thread" && (
                    <div className={styles["notification-actions-row"]}>
                      <button
                        className={`${styles["notification-action-btn"]} ${styles.view}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNotificationClick(notification);
                        }}
                      >
                        View Thread
                      </button>
                    </div>
                  )}

                  {notification.type === "game_move" && (
                    <div className={styles["notification-actions-row"]}>
                      <button
                        className={`${styles["notification-action-btn"]} ${styles.view}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleNotificationClick(notification);
                        }}
                      >
                        View Game
                      </button>
                    </div>
                  )}
                </div>

                <button
                  className={styles["notification-dismiss"]}
                  onClick={(e) => handleDismiss(e, notification)}
                  title="Dismiss"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {hasMore && (
            <div className={styles["notifications-load-more"]}>
              <button onClick={handleLoadMore} disabled={loading}>
                {loading ? "Loading..." : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default NotificationsPage;
