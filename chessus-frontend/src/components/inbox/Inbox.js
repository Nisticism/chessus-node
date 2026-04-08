import React, { useEffect, useState, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import {
  getConversations,
  getMessages,
  sendMessage,
  markMessagesRead,
  getUnreadDMCount,
  receiveDirectMessage,
} from "../../actions/messages";
import { useSocket } from "../../contexts/SocketContext";
import axios from "axios";
import authHeader from "../../services/auth-header";
import styles from "./inbox.module.scss";
import { parseServerDate } from "../../helpers/date-formatter";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";
const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";

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

const Inbox = () => {
  const dispatch = useDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { conversations, activeMessages } = useSelector(
    (state) => state.messages
  );
  const { socket } = useSocket();

  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [error, setError] = useState(null);
  const [newConversationUsername, setNewConversationUsername] = useState("");
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedUserInfo, setSelectedUserInfo] = useState(null);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchTimerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);

  const selectedUserId = searchParams.get("user") ? parseInt(searchParams.get("user")) : null;

  // Load conversations on mount
  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);
    dispatch(getConversations(currentUser.id))
      .then(() => setLoading(false))
      .catch(() => setLoading(false));
    dispatch(getUnreadDMCount(currentUser.id));
  }, [currentUser, dispatch]);

  // Load messages when a conversation is selected
  useEffect(() => {
    if (!currentUser || !selectedUserId || isNaN(selectedUserId)) return;
    dispatch(getMessages(currentUser.id, selectedUserId));
    dispatch(markMessagesRead(currentUser.id, selectedUserId));
  }, [currentUser, selectedUserId, dispatch]);

  // Fetch username if selected user isn't in conversations list
  useEffect(() => {
    if (!selectedUserId || isNaN(selectedUserId)) return;
    const conv = conversations.find((c) => c.user_id === selectedUserId);
    if (conv || (selectedUserInfo && selectedUserInfo.id === selectedUserId)) return;
    axios.get(`${API_URL}users/search-by-id?id=${selectedUserId}`)
      .then((res) => {
        if (res.data?.user) {
          setSelectedUserInfo({ id: res.data.user.id, username: res.data.user.username });
        }
      })
      .catch(() => {});
  }, [selectedUserId, conversations, selectedUserInfo]);

  // Scroll to bottom when messages change (within the chat container only)
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [activeMessages]);

  // Listen for incoming DMs via socket
  useEffect(() => {
    if (!socket || !currentUser) return;

    const handleNewDM = (message) => {
      dispatch(receiveDirectMessage(message));
      // If this message is from the active conversation, mark it read
      if (message.sender_id === selectedUserId) {
        dispatch(markMessagesRead(currentUser.id, message.sender_id));
      }
    };

    socket.on("newDirectMessage", handleNewDM);
    return () => {
      socket.off("newDirectMessage", handleNewDM);
    };
  }, [socket, currentUser, selectedUserId, dispatch]);

  const handleSelectConversation = useCallback(
    (userId) => {
      setSearchParams({ user: userId });
      setError(null);
    },
    [setSearchParams]
  );

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedUserId || sendingMessage) return;

    setSendingMessage(true);
    setError(null);
    try {
      await dispatch(sendMessage(currentUser.id, selectedUserId, newMessage.trim()));
      setNewMessage("");
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || "Failed to send message");
    }
    setSendingMessage(false);
  };

  const searchUsers = useCallback(async (q) => {
    if (!currentUser) return;
    setSearchLoading(true);
    try {
      const res = await axios.get(
        `${API_URL}users/${currentUser.id}/messageable-users?q=${encodeURIComponent(q)}&limit=10`,
        { headers: authHeader() }
      );
      setSearchResults(res.data.users || []);
    } catch {
      setSearchResults([]);
    }
    setSearchLoading(false);
  }, [currentUser]);

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setNewConversationUsername(val);
    setShowDropdown(true);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      searchUsers(val);
    }, 250);
  };

  const handleSearchFocus = () => {
    setShowDropdown(true);
    // Load initial results (friends) if empty
    if (searchResults.length === 0) {
      searchUsers(newConversationUsername);
    }
  };

  const handleSelectUser = (user) => {
    setShowNewConversation(false);
    setNewConversationUsername("");
    setSearchResults([]);
    setShowDropdown(false);
    setSelectedUserInfo({ id: user.id, username: user.username });
    handleSelectConversation(user.id);
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        searchRef.current && !searchRef.current.contains(e.target)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!currentUser) {
    return (
      <div className={styles["inbox-container"]}>
        <div className={styles["inbox-empty"]}>
          <p>Please <Link to="/login">sign in</Link> to view your messages.</p>
        </div>
      </div>
    );
  }

  const selectedConversation = conversations.find((c) => c.user_id === selectedUserId);
  const displayUsername = selectedConversation?.username || selectedUserInfo?.username;

  return (
    <div className={styles["inbox-container"]}>
      <div className={styles["inbox-header"]}>
        <h1 className={styles["inbox-title"]}>💬 Inbox</h1>
        <button
          className={styles["new-conversation-btn"]}
          onClick={() => setShowNewConversation(!showNewConversation)}
        >
          {showNewConversation ? "Cancel" : "+ New Message"}
        </button>
      </div>

      {showNewConversation && (
        <div className={styles["new-conversation-form"]}>
          <div className={styles["search-wrapper"]} ref={searchRef}>
            <input
              type="text"
              placeholder="Search by username..."
              value={newConversationUsername}
              onChange={handleSearchChange}
              onFocus={handleSearchFocus}
              className={styles["new-conversation-input"]}
              autoFocus
              autoComplete="off"
            />
            {showDropdown && (
              <div className={styles["search-dropdown"]} ref={dropdownRef}>
                {searchLoading ? (
                  <div className={styles["search-item-empty"]}>Searching...</div>
                ) : searchResults.length === 0 ? (
                  <div className={styles["search-item-empty"]}>
                    {newConversationUsername.trim() ? "No users found" : "Type to search or click to see friends"}
                  </div>
                ) : (
                  searchResults.map((user) => (
                    <div
                      key={user.id}
                      className={styles["search-item"]}
                      onClick={() => handleSelectUser(user)}
                    >
                      <div className={styles["search-item-avatar"]}>
                        {user.profile_picture ? (
                          <img src={`${ASSET_URL}${user.profile_picture}`} alt={user.username} />
                        ) : (
                          <span>{user.username?.[0]?.toUpperCase() || "?"}</span>
                        )}
                      </div>
                      <span className={styles["search-item-name"]}>{user.username}</span>
                      {user.is_friend === 1 && (
                        <span className={styles["search-item-badge"]}>Friend</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div className={styles["inbox-error"]}>{error}</div>}

      <div className={styles["inbox-layout"]}>
        {/* Conversations List */}
        <div className={styles["conversations-panel"]}>
          {loading ? (
            <div className={styles["inbox-loading"]}>Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className={styles["inbox-empty-conversations"]}>
              No conversations yet. Send a message to get started!
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.user_id}
                className={`${styles["conversation-item"]} ${
                  selectedUserId === conv.user_id ? styles["active"] : ""
                } ${conv.unread_count > 0 ? styles["unread"] : ""}`}
                onClick={() => handleSelectConversation(conv.user_id)}
              >
                <div className={styles["conversation-avatar"]}>
                  {conv.profile_picture ? (
                    <img src={`${ASSET_URL}${conv.profile_picture}`} alt={conv.username} />
                  ) : (
                    <span>{conv.username?.[0]?.toUpperCase() || "?"}</span>
                  )}
                </div>
                <div className={styles["conversation-info"]}>
                  <div className={styles["conversation-name"]}>
                    {conv.username}
                    {conv.unread_count > 0 && (
                      <span className={styles["unread-badge"]}>{conv.unread_count}</span>
                    )}
                  </div>
                  <div className={styles["conversation-preview"]}>
                    {conv.last_message?.substring(0, 50)}
                    {conv.last_message?.length > 50 ? "..." : ""}
                  </div>
                </div>
                <div className={styles["conversation-time"]}>
                  {formatTimeAgo(conv.last_message_time)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Messages Panel */}
        <div className={styles["messages-panel"]}>
          {selectedUserId ? (
            <>
              <div className={styles["messages-header"]}>
                {displayUsername ? (
                  <Link
                    to={`/profile/${displayUsername}`}
                    className={styles["messages-header-name"]}
                  >
                    {displayUsername}
                  </Link>
                ) : (
                  <span className={styles["messages-header-name"]}>Loading...</span>
                )}
              </div>
              <div className={styles["messages-list"]} ref={chatContainerRef}>
                {activeMessages.map((msg, idx) => (
                  <div
                    key={msg.id || idx}
                    className={`${styles["message-bubble"]} ${
                      msg.sender_id === currentUser.id ? styles["sent"] : styles["received"]
                    }`}
                  >
                    <div className={styles["message-content"]}>{msg.content}</div>
                    <div className={styles["message-time"]}>
                      {formatTimeAgo(msg.created_at)}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <form className={styles["message-input-form"]} onSubmit={handleSendMessage}>
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  className={styles["message-input"]}
                  maxLength={2000}
                  disabled={sendingMessage}
                />
                <button
                  type="submit"
                  className={styles["send-btn"]}
                  disabled={!newMessage.trim() || sendingMessage}
                >
                  {sendingMessage ? "..." : "Send"}
                </button>
              </form>
            </>
          ) : (
            <div className={styles["no-conversation-selected"]}>
              <div className={styles["no-conversation-icon"]}>💬</div>
              <p>Select a conversation or start a new one</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Inbox;
