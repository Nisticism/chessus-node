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
/*
 * What a pasted image is allowed to be, and the extension it gets on the way
 * up. Deliberately the same four types the file picker accepts.
 */
const PASTE_EXT_FOR_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

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
  const [imageError, setImageError] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null); // { id, filename, sender_id }
  /*
   * Images chosen but NOT yet sent.
   *
   * Pasting or picking an image used to upload and post it there and then, so a
   * screenshot went out on its own before you could say anything about it, and
   * there was no way back if you pasted the wrong thing. They now sit here as
   * chips until the message is sent, and go up with it.
   *
   * Each holds the File itself and an object URL for the preview, which has to
   * be released again - see the cleanup below.
   */
  const [pending, setPending] = useState([]);   // [{ key, file, url }]

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

    /*
     * Put the cursor in the message box on opening a conversation.
     *
     * Not only a convenience: a paste is only taken when no OTHER text field
     * has the cursor, and clicking a conversation leaves it in the search box
     * above the list - so pasting a screenshot straight after choosing who to
     * send it to did nothing at all.
     *
     * Only where there is a mouse. Doing it on a touch screen throws the
     * keyboard up over the conversation the moment it opens.
     */
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)')?.matches) {
      requestAnimationFrame(() => messageInputRef.current?.focus());
    }

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

  /*
   * Send the message and whatever is attached to it, as one thing.
   *
   * The files go up first, because a picture has to exist before there is an id
   * to hang on a message - but they stay LOOSE until the message claims them,
   * so a send that fails part way leaves uploaded images unattached rather than
   * a half-sent message. Either text or an image is enough on its own.
   */
  const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = newMessage.trim();
    if ((!text && !pending.length) || !selectedUserId || sendingMessage) return;

    setSendingMessage(true);
    setError(null);
    setImageError(null);
    try {
      const uploadedIds = [];
      for (const item of pending) {
        const formData = new FormData();
        formData.append("image", item.file);
        // defer: the message's own event tells the other side, so the picture
        // does not arrive a moment before the words it belongs to.
        formData.append("defer", "1");
        const res = await axios.post(
          `${API_URL}users/${currentUser.id}/messages/${selectedUserId}/images`,
          formData,
          { headers: { ...authHeader(), "Content-Type": "multipart/form-data" } }
        );
        uploadedIds.push(res.data.image.id);
      }

      await dispatch(sendMessage(currentUser.id, selectedUserId, text, uploadedIds));
      setNewMessage("");
      pending.forEach((x) => URL.revokeObjectURL(x.url));
      setPending([]);
    } catch (err) {
      setError(
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        "Failed to send message"
      );
    }
    setSendingMessage(false);
  };

  const handleImageAttach = () => {
    if (sendingMessage) return;
    setImageError(null);
    fileInputRef.current?.click();
  };

  /*
   * Sending one image, however it was chosen - picked from the file dialog or
   * pasted in. Written once because the two routes in have to agree about the
   * size limit, the per-conversation limit and what happens afterwards.
   */
  /*
   * Put an image on the message that is being written. Nothing leaves the
   * browser here - the checks that can be made now are made now, so a file that
   * is too big is refused while you can still do something about it rather than
   * after a round trip.
   */
  const attachImage = useCallback((file) => {
    if (!file || !currentUser || !selectedUserId) return;
    if (file.size > 1 * 1024 * 1024) {
      setImageError("Image must be 1 MB or smaller.");
      return;
    }
    setImageError(null);
    setPending((prev) => {
      if (prev.length + dmImages.length >= DM_IMAGE_LIMIT) {
        setImageError(`Maximum ${DM_IMAGE_LIMIT} images per conversation. Older ones expire after 24 hours.`);
        return prev;
      }
      return [...prev, { key: `${Date.now()}-${prev.length}`, file, url: URL.createObjectURL(file) }];
    });
  }, [currentUser, selectedUserId, dmImages.length]);

  const removePending = useCallback((key) => {
    setPending((prev) => {
      const gone = prev.find((x) => x.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((x) => x.key !== key);
    });
    setImageError(null);
  }, []);

  /*
   * Object URLs are held by the browser until they are given back, so anything
   * still attached when the conversation changes or the page goes away has to
   * be released - otherwise every screenshot ever pasted stays in memory.
   */
  useEffect(() => {
    return () => setPending((prev) => {
      prev.forEach((x) => URL.revokeObjectURL(x.url));
      return [];
    });
  }, [selectedUserId]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be re-selected
    attachImage(file);
  };

  /*
   * Ctrl-V a screenshot straight into the conversation.
   *
   * Listening on the window rather than on the text box: a screenshot is
   * usually taken and pasted in one motion, without clicking into the message
   * field first, and a paste that does nothing because the cursor was
   * elsewhere is the kind of thing people try once and give up on.
   *
   * It only ever acts on an image sitting in the clipboard, so pasting text
   * anywhere, or pasting anything at all into another field on the page, is
   * left completely alone.
   */
  useEffect(() => {
    if (!selectedUserId || isNaN(selectedUserId)) return undefined;

    const onPaste = (e) => {
      if (sendingMessage) return;
      // Another text field has the cursor - that paste is not ours to take.
      const active = document.activeElement;
      if (active && active !== messageInputRef.current
          && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind !== "file") continue;
        const ext = PASTE_EXT_FOR_MIME[item.type];
        if (!ext) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        // Stop the browser also dropping a filename into the message box.
        e.preventDefault();
        /*
         * A pasted screenshot arrives with no name of its own, and the server
         * checks the EXTENSION as well as the mime type - so it is given one
         * that matches what it actually is, rather than being rejected for
         * having no name.
         */
        attachImage(new File([blob], `pasted-${Date.now()}.${ext}`, { type: item.type }));
        return;
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [selectedUserId, sendingMessage, attachImage]);

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
    /*
     * Only images that belong to NO message. An attached one is drawn inside
     * its message's bubble, and would otherwise appear twice.
     */
    ...dmImages
      .filter((img) => !img.message_id)
      .map((img) => ({ ...img, _type: "image", _ts: new Date(img.created_at).getTime() })),
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
                            alt="Direct message attachment"
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
                      {/* Pictures sent WITH this message, above its words. */}
                      {(item.images || []).map((img) => (
                        <div key={img.id} className={styles["dm-image-wrapper"]}>
                          <button
                            className={styles["dm-image-delete-btn"]}
                            onClick={() => handleDeleteImage(img.id)}
                            title="Delete image"
                            aria-label="Delete image"
                          >
                            ✕
                          </button>
                          <img
                            src={`${ASSET_URL}/uploads/dm-images/${img.filename}`}
                            alt="Direct message attachment"
                            className={styles["dm-image-thumb"]}
                            onClick={() => setLightboxImage(img)}
                            draggable={false}
                          />
                        </div>
                      ))}
                      {item.content ? (
                        <div className={styles["message-content"]}>{renderContent(item.content)}</div>
                      ) : null}
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

              {/* Attached but not yet sent. */}
              {pending.length > 0 && (
                <div className={styles["pending-attachments"]}>
                  {pending.map((item) => (
                    <div key={item.key} className={styles["pending-chip"]}>
                      <img src={item.url} alt="Attachment preview" className={styles["pending-thumb"]} />
                      <button
                        type="button"
                        className={styles["pending-remove"]}
                        onClick={() => removePending(item.key)}
                        title="Remove this attachment"
                        aria-label="Remove attachment"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <span className={styles["pending-hint"]}>
                    {pending.length === 1 ? "1 image" : `${pending.length} images`} will be sent with this message
                  </span>
                </div>
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
                  disabled={sendingMessage || pending.length + dmImages.length >= DM_IMAGE_LIMIT}
                  title={
                    pending.length + dmImages.length >= DM_IMAGE_LIMIT
                      ? `Max ${DM_IMAGE_LIMIT} images per conversation`
                      : "Attach image (max 1 MB) — or paste a screenshot with Ctrl+V"
                  }
                  aria-label="Attach image"
                >
                  {sendingMessage ? "..." : <MdImage />}
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
                  placeholder={pending.length ? "Add a message, or just press Send" : "Type a message..."}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  /*
                   * Backspace with nothing left to delete takes the last
                   * attachment off instead - the same thing every other chat
                   * box does, and the reason it does not need explaining.
                   */
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !newMessage && pending.length) {
                      e.preventDefault();
                      removePending(pending[pending.length - 1].key);
                    }
                  }}
                  className={styles["message-input"]}
                  maxLength={2000}
                  disabled={sendingMessage}
                />
                <button
                  type="submit"
                  className={styles["send-btn"]}
                  disabled={(!newMessage.trim() && !pending.length) || sendingMessage}
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
