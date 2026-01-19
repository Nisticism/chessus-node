import React, { useState } from "react";
import styles from "./streams.module.scss";

const Streams = () => {
  const [activeCategory, setActiveCategory] = useState("all");

  const streams = [
    {
      title: "Weekly Tournament - Championship Finals",
      streamer: "ProPlayer123",
      viewers: "1.2K",
      thumbnail: "🏆",
      category: "tournament",
      status: "live",
      game: "Ultimate Chess Variants",
    },
    {
      title: "Game Design Workshop - Creating Unique Pieces",
      streamer: "DesignMaster",
      viewers: "856",
      thumbnail: "🎨",
      category: "tutorial",
      status: "live",
      game: "Piece Workshop",
    },
    {
      title: "Speedrun Challenge - Custom Game Showcase",
      streamer: "SpeedyGamer",
      viewers: "623",
      thumbnail: "⚡",
      category: "casual",
      status: "live",
      game: "Lightning Tactics",
    },
    {
      title: "Community Game Night - Join Us!",
      streamer: "CommunityHost",
      viewers: "445",
      thumbnail: "♟️",
      category: "community",
      status: "live",
      game: "Various Custom Games",
    },
    {
      title: "Advanced Strategies - Meta Analysis",
      streamer: "StrategyGuru",
      viewers: "0",
      thumbnail: "📊",
      category: "tutorial",
      status: "offline",
      game: "Grand Strategy Chess",
    },
    {
      title: "Saturday Tournament Replays",
      streamer: "TournamentTV",
      viewers: "0",
      thumbnail: "📺",
      category: "tournament",
      status: "offline",
      game: "Tournament Archives",
    },
  ];

  const categories = [
    { id: "all", name: "All Streams", icon: "📡" },
    { id: "live", name: "Live Now", icon: "🔴" },
    { id: "tournament", name: "Tournaments", icon: "🏆" },
    { id: "tutorial", name: "Tutorials", icon: "📚" },
    { id: "casual", name: "Casual", icon: "☕" },
    { id: "community", name: "Community", icon: "👥" },
  ];

  const filteredStreams = streams.filter((stream) => {
    if (activeCategory === "all") return true;
    if (activeCategory === "live") return stream.status === "live";
    return stream.category === activeCategory;
  });

  const liveCount = streams.filter((s) => s.status === "live").length;

  return (
    <div className={styles["streams-container"]}>
      <div className={styles["streams-header"]}>
        <h1>Live Streams & Videos</h1>
        <p className={styles["subtitle"]}>
          Watch live gameplay, tournaments, and learn from the community
        </p>
        <div className={styles["live-indicator"]}>
          <span className={styles["live-dot"]}></span>
          {liveCount} streams live now
        </div>
      </div>

      <div className={styles["category-filter"]}>
        {categories.map((category) => (
          <button
            key={category.id}
            className={`${styles["category-button"]} ${
              activeCategory === category.id ? styles["active"] : ""
            }`}
            onClick={() => setActiveCategory(category.id)}
          >
            <span className={styles["category-icon"]}>{category.icon}</span>
            {category.name}
          </button>
        ))}
      </div>

      <div className={styles["streams-grid"]}>
        {filteredStreams.length > 0 ? (
          filteredStreams.map((stream, index) => (
            <div key={index} className={styles["stream-card"]}>
              {stream.status === "live" && (
                <div className={styles["live-badge"]}>
                  <span className={styles["pulse-dot"]}></span>
                  LIVE
                </div>
              )}
              <div className={styles["stream-thumbnail"]}>
                <div className={styles["thumbnail-placeholder"]}>
                  {stream.thumbnail}
                </div>
                {stream.status === "live" && (
                  <div className={styles["viewer-count"]}>
                    👁️ {stream.viewers}
                  </div>
                )}
              </div>
              <div className={styles["stream-info"]}>
                <h3 className={styles["stream-title"]}>{stream.title}</h3>
                <p className={styles["streamer-name"]}>{stream.streamer}</p>
                <p className={styles["game-name"]}>{stream.game}</p>
              </div>
            </div>
          ))
        ) : (
          <div className={styles["no-streams"]}>
            <p>No streams found in this category</p>
          </div>
        )}
      </div>

      <div className={styles["streaming-info"]}>
        <h2>Want to Stream?</h2>
        <p>
          If you're interested in streaming Squarestrat games, tournaments, or tutorials,
          contact us to get featured on this page! We love showcasing our community's content.
        </p>
        <p>
          Email us at <a href="mailto:streams@squarestrat.com">streams@squarestrat.com</a>
        </p>
      </div>
    </div>
  );
};

export default Streams;
