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
import EmojiPickerButton from "../common/EmojiPickerButton";
import LinkInsertButton from "../common/LinkInsertButton";
import { renderContent } from "../../helpers/render-content";
import { MdImage } from "react-icons/md";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";
const ASSET_URL = process.env.REACT_APP_ASSET_URL || "";
const DM_IMAGE_LIMIT = 5;

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

  // Image attachment state
  const [dmImages, setDmImages] = useState([]); // images for the active conversation
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null); // { id, filename, sender_id }

  const searchRef = useRef(null);
  const dropdownRef = useRef(null);
  const searchTimerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const messageInputRef = useRef(null);

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

  // Load messages + images when a conversation is selected
  useEffect(() => {
    if (!currentUser || !selectedUserId || isNaN(selectedUserId)) {
      setDmImages([]);
      return;
    }
    dispatch(getMessages(currentUser.id, selectedUserId));
    dispatch(markMessagesRead(currentUser.id, selectedUserId));

    // Fetch existing images for this conversation
    axios
      .get(`${API_URL}users/${currentUser.id}/messages/${selectedUserId}/images`, {
        headers: authHeader(),
      })
      .then((res) => setDmImages(res.data.images || []))
      .catch(() => setDmImages([]));
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

  // Scroll to bottom when messages/images change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [activeMessages, dmImages]);

  // Listen for incoming DMs and DM image events via socket
  useEffect(() => {
    if (!socket || !currentUser) return;

    const handleNewDM = (message) => {
      dispatch(receiveDirectMessage(message));
      if (message.sender_id === selectedUserId) {
        dispatch(markMessagesRead(currentUser.id, message.sender_id));
      }
    };

    const handleNewImage = (imageData) => {
      // Only add if it's for the currently open conversation
      const other = imageData.fromUserId;
      if (other === selectedUserId || imageData.sender_id === selectedUserId) {
        setDmImages((prev) => {
          if (prev.some((img) => img.id === imageData.id)) return prev;
          return [...prev, imageData];
        });
      }
    };

    const handleImageDeleted = ({ imageId }) => {
      setDmImages((prev) => prev.filter((img) => img.id !== imageId));
      setLightboxImage((lb) => (lb?.id === imageId ? null : lb));
    };

    socket.on("newDirectMessage", handleNewDM);
    socket.on("newDirectMessageImage", handleNewImage);
    socket.on("directMessageImageDeleted", handleImageDeleted);
    return () => {
      socket.off("newDirectMessage", handleNewDM);
      socket.off("newDirectMessageImage", handleNewImage);
      socket.off("directMessageImageDeleted", handleImageDeleted);
    };
  }, [socket, currentUser, selectedUserId, dispatch]);

  const handleSelectConversation = useCallback(
    (userId) => {
      setSearchParams({ user: userId });
      setError(null);
      setImageError(null);
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

  const handleImageAttach = () => {
    if (uploadingImage) return;
    setImageError(null);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be re-selected

    if (file.size > 1 * 1024 * 1024) {
      setImageError("Image must be 1 MB or smaller.");
      return;
    }
    if (dmImages.length >= DM_IMAGE_LIMIT) {
      setImageError(`Maximum ${DM_IMAGE_LIMIT} images per conversation. Older ones expire after 24 hours.`);
      return;
    }

    const formData = new FormData();
    formData.append("image", file);

    setUploadingImage(true);
    setImageError(null);
    try {
      const res = await axios.post(
        `${API_URL}users/${currentUser.id}/messages/${selectedUserId}/images`,
        formData,
        { headers: { ...authHeader(), "Content-Type": "multipart/form-data" } }
      );
      const newImg = res.data.image;
      setDmImages((prev) => (prev.some((i) => i.id === newImg.id) ? prev : [...prev, newImg]));
    } catch (err) {
      setImageError(
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        "Failed to upload image"
      );
    }
    setUploadingImage(false);
  };

  const handleDeleteImage = async (imageId) => {
    try {
      await axios.delete(
        `${API_URL}users/${currentUser.id}/messages/images/${imageId}`,
        { headers: authHeader() }
      );
      setDmImages((prev) => prev.filter((img) => img.id !== imageId));
      setLightboxImage((lb) => (lb?.id === imageId ? null : lb));
    } catch (err) {
      setImageError(err?.response?.data?.error || "Failed to delete image");
    }
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

  // Merge messages and images into a single sorted thread
  const threadItems = [
    ...activeMessages.map((m) => ({ ...m, _type: "message", _ts: new Date(m.created_at).getTime() })),
    ...dmImages.map((img) => ({ ...img, _type: "image", _ts: new Date(img.created_at).getTime() })),
  ].sort((a, b) => a._ts - b._ts);

  return (
    <div className={styles["inbox-container"]}>
      <div className={styles["inbox-header"]}>
        <h1 className={styles["inbox-title"]}>Inbox</h1>
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
                {dmImages.length > 0 && (
                  <span className={styles["image-count-badge"]} title="Images in this conversation (expire after 24 h)">
                    {dmImages.length}/{DM_IMAGE_LIMIT} images
                  </span>
                )}
              </div>

              <div className={styles["messages-list"]} ref={chatContainerRef}>
                {threadItems.map((item, idx) => {
                  const isSent = item.sender_id === currentUser.id;
                  if (item._type === "image") {
                    return (
                      <div
                        key={`img-${item.id}`}
                        className={`${styles["message-bubble"]} ${styles["image-bubble"]} ${isSent ? styles["sent"] : styles["received"]}`}
                      >
                        <div className={styles["dm-image-wrapper"]}>
                          <button
                            className={styles["dm-image-delete-btn"]}
                            onClick={() => handleDeleteImage(item.id)}
                            title="Delete image"
                            aria-label="Delete image"
                          >
                            ✕
                          </button>
                          <img
                            src={`${ASSET_URL}/uploads/dm-images/${item.filename}`}
                            alt="Shared image"
                            className={styles["dm-image-thumb"]}
                            onClick={() => setLightboxImage(item)}
                            draggable={false}
                          />
                        </div>
                        <div className={styles["message-time"]}>
                          {formatTimeAgo(item.created_at)}
                          <span className={styles["image-expires-hint"]} title="Images auto-delete after 24 hours"> · expires in {Math.max(0, Math.round((new Date(item.expires_at) - Date.now()) / 3600000))}h</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={item.id || idx}
                      className={`${styles["message-bubble"]} ${isSent ? styles["sent"] : styles["received"]}`}
                    >
                      <div className={styles["message-content"]}>{renderContent(item.content)}</div>
                      <div className={styles["message-time"]}>
                        {formatTimeAgo(item.created_at)}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {imageError && (
                <div className={styles["image-error"]}>{imageError}</div>
              )}

              <form className={styles["message-input-form"]} onSubmit={handleSendMessage}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
                <button
                  type="button"
                  className={styles["attach-btn"]}
                  onClick={handleImageAttach}
                  disabled={uploadingImage || dmImages.length >= DM_IMAGE_LIMIT}
                  title={
                    dmImages.length >= DM_IMAGE_LIMIT
                      ? `Max ${DM_IMAGE_LIMIT} images per conversation`
                      : "Attach image (max 1 MB)"
                  }
                  aria-label="Attach image"
                >
                  {uploadingImage ? "..." : <MdImage />}
                </button>
                <EmojiPickerButton
                  textareaRef={messageInputRef}
                  onChange={setNewMessage}
                />
                <LinkInsertButton
                  textareaRef={messageInputRef}
                  onChange={setNewMessage}
                />
                <input
                  ref={messageInputRef}
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

      {/* Image lightbox modal */}
      {lightboxImage && (
        <div
          className={styles["lightbox-overlay"]}
          onClick={() => setLightboxImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div
            className={styles["lightbox-content"]}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className={styles["lightbox-close"]}
              onClick={() => setLightboxImage(null)}
              aria-label="Close"
            >
              ✕
            </button>
            <button
              className={styles["lightbox-delete"]}
              onClick={() => handleDeleteImage(lightboxImage.id)}
              aria-label="Delete image"
            >
              Delete image
            </button>
            <img
              src={`${ASSET_URL}/uploads/dm-images/${lightboxImage.filename}`}
              alt="Full size"
              className={styles["lightbox-img"]}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default Inbox;
