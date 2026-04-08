import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./gamechat.module.scss";

import { parseServerDate } from "../../helpers/date-formatter";

const formatTime = (dateStr) => {
  const date = parseServerDate(dateStr);
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const GameChat = ({ gameId, currentUser, gameState, isPlayer, onUpdatePreference }) => {
  const { socket } = useSocket();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [opponentDisabledBy, setOpponentDisabledBy] = useState(null);
  const [chatPublic, setChatPublic] = useState({});
  const [bothPublic, setBothPublic] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Derive disabled state from own settings, game state, and opponent info
  const selfDisabled = currentUser?.disable_game_chat === 1 || currentUser?.disable_game_chat === true;
  const gameDisabled = !!gameState?.chatDisabled;
  const disabled = selfDisabled || gameDisabled || !!opponentDisabledBy;
  const disabledReason = gameDisabled
    ? "Chat is disabled for this game"
    : selfDisabled
    ? "Chat disabled (your settings)"
    : opponentDisabledBy
    ? `Chat disabled by ${opponentDisabledBy}'s settings`
    : null;

  // Whether this player has chat set to public
  const myPublic = isPlayer && currentUser ? !!chatPublic[currentUser.id] : false;

  // Load chat history when component mounts or when user re-enables chat
  useEffect(() => {
    if (!socket || !gameId) return;
    if (!selfDisabled) {
      socket.emit("getGameChatHistory", { gameId });
    }
  }, [socket, gameId, selfDisabled]);

  // Listen for chat messages
  useEffect(() => {
    if (!socket) return;

    const handleMessage = (msg) => {
      if (msg.gameId === parseInt(gameId)) {
        setMessages((prev) => [...prev, msg]);
      }
    };

    const handleHistory = ({ gameId: gId, messages: history, chatDisabledBy, chatPublic: cp, bothPublic: bp }) => {
      if (parseInt(gId) === parseInt(gameId)) {
        setMessages(history);
        setOpponentDisabledBy(chatDisabledBy || null);
        if (cp !== undefined) setChatPublic(cp);
        if (bp !== undefined) setBothPublic(bp);
      }
    };

    const handleChatError = () => {};

    const handleChatPublicUpdate = ({ gameId: gId, chatPublic: cp, bothPublic: bp }) => {
      if (parseInt(gId) === parseInt(gameId)) {
        setChatPublic(cp);
        setBothPublic(bp);
        // If spectator and chat just became public, re-fetch history
        if (!isPlayer && bp) {
          socket.emit("getGameChatHistory", { gameId });
        }
      }
    };

    socket.on("gameChatMessage", handleMessage);
    socket.on("gameChatHistory", handleHistory);
    socket.on("gameChatError", handleChatError);
    socket.on("chatPublicUpdate", handleChatPublicUpdate);

    return () => {
      socket.off("gameChatMessage", handleMessage);
      socket.off("gameChatHistory", handleHistory);
      socket.off("gameChatError", handleChatError);
      socket.off("chatPublicUpdate", handleChatPublicUpdate);
    };
  }, [socket, gameId, isPlayer]);

  // Auto-scroll to bottom within chat container only
  useEffect(() => {
    if (messagesEndRef.current && !collapsed) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages, collapsed]);

  const handleChatClick = useCallback((e) => {
    // Don't steal focus from the header toggle
    if (e.target.closest(`.${styles["chat-header"]}`)) return;
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(
    (e) => {
      e.preventDefault();
      if (!input.trim() || !socket || disabled) return;
      socket.emit("sendGameChat", { gameId, content: input.trim() });
      setInput("");
    },
    [input, socket, gameId, disabled]
  );

  const handleTogglePublic = useCallback((e) => {
    e.stopPropagation();
    if (!socket || !isPlayer) return;
    const newValue = !myPublic;
    socket.emit("toggleChatPublic", { gameId, isPublic: newValue });
    // Also persist to user preferences for future games
    if (onUpdatePreference) {
      onUpdatePreference('chat_public_for_spectators', newValue);
    }
  }, [socket, gameId, isPlayer, myPublic, onUpdatePreference]);

  // Spectator view when chat is not public
  if (!isPlayer && !bothPublic) {
    return (
      <div className={styles["game-chat"]}>
        <div className={styles["chat-header"]}>
          <span>💬 Chat</span>
        </div>
        <div className={styles["chat-disabled-msg"]}>
          Chat is private between players
        </div>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className={styles["game-chat"]}>
        <div className={styles["chat-header"]}>
          <span>💬 Chat</span>
          {isPlayer && (
            <div className={styles["chat-header-right"]}>
              <span
                className={`${styles["chat-public-toggle"]} ${myPublic ? styles["public-on"] : ""}`}
                onClick={handleTogglePublic}
                role="button"
                tabIndex={0}
                title={myPublic ? "Spectators can see your chat. Click to disable." : "Spectators cannot see chat. Click to allow."}
              >
                👁
                <span className={styles["chat-tooltip"]}>
                  {myPublic ? "Spectators can see chat. Both players must enable this. Click to disable." : "Spectators cannot see chat. Click to allow spectators to view chat."}
                </span>
              </span>
            </div>
          )}
        </div>
        <div className={styles["chat-disabled-msg"]}>
          {disabledReason || "Chat is disabled"}
        </div>
      </div>
    );
  }

  return (
    <div className={styles["game-chat"]} onClick={handleChatClick}>
      <div
        className={styles["chat-header"]}
        onClick={() => setCollapsed(!collapsed)}
      >
        <span>💬 Chat</span>
        <div className={styles["chat-header-right"]}>
          {isPlayer && (
            <span
              className={`${styles["chat-public-toggle"]} ${myPublic ? styles["public-on"] : ""}`}
              onClick={handleTogglePublic}
              role="button"
              tabIndex={0}
              title={myPublic ? "Spectators can see your chat. Click to disable." : "Spectators cannot see chat. Click to allow."}
            >
              👁
              <span className={styles["chat-tooltip"]}>
                {myPublic ? "Spectators can see chat. Both players must enable this. Click to disable." : "Spectators cannot see chat. Click to allow spectators to view chat."}
              </span>
            </span>
          )}
          {isPlayer && bothPublic && (
            <span className={styles["chat-public-badge"]}>Public</span>
          )}
          <span className={styles["chat-toggle"]}>{collapsed ? "▼" : "▲"}</span>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className={styles["chat-messages"]}>
            {messages.length === 0 && (
              <div className={styles["chat-empty"]}>No messages yet</div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={msg.id || idx}
                className={`${styles["chat-msg"]} ${
                  msg.senderId === currentUser?.id ? styles["own"] : ""
                }`}
              >
                <span className={styles["chat-sender"]}>
                  {msg.senderId === currentUser?.id ? "You" : msg.senderUsername}
                </span>
                <span className={styles["chat-text"]}>{msg.content}</span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {currentUser && isPlayer && (
            <form className={styles["chat-input-form"]} onSubmit={handleSend}>
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type..."
                className={styles["chat-input"]}
                maxLength={500}
              />
              <button
                type="submit"
                className={styles["chat-send"]}
                disabled={!input.trim()}
              >
                ↵
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
};

export default GameChat;
