import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSocket } from "../../contexts/SocketContext";
import styles from "./gamechat.module.scss";

const formatTime = (dateStr) => {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const GameChat = ({ gameId, currentUser, gameState }) => {
  const { socket } = useSocket();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [opponentDisabledBy, setOpponentDisabledBy] = useState(null);
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

    const handleHistory = ({ gameId: gId, messages: history, chatDisabledBy }) => {
      if (parseInt(gId) === parseInt(gameId)) {
        setMessages(history);
        setOpponentDisabledBy(chatDisabledBy || null);
      }
    };

    const handleChatError = () => {};

    socket.on("gameChatMessage", handleMessage);
    socket.on("gameChatHistory", handleHistory);
    socket.on("gameChatError", handleChatError);

    return () => {
      socket.off("gameChatMessage", handleMessage);
      socket.off("gameChatHistory", handleHistory);
      socket.off("gameChatError", handleChatError);
    };
  }, [socket, gameId]);

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

  if (disabled) {
    return (
      <div className={styles["game-chat"]}>
        <div className={styles["chat-header"]}>
          <span>💬 Chat</span>
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
        <span className={styles["chat-toggle"]}>{collapsed ? "▼" : "▲"}</span>
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
          {currentUser && (
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
