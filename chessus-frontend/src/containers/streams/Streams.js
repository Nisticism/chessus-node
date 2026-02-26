import React, { useState, useEffect } from "react";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import styles from "./streams.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  if (!imagePath.startsWith('/')) {
    return `${ASSET_URL}/${imagePath}`;
  }
  return `${ASSET_URL}${imagePath}`;
};

const getCategoryIcon = (category) => {
  const icons = {
    tournament: "🏆",
    tutorial: "📚",
    casual: "☕",
    community: "⚔",
    other: "📡"
  };
  return icons[category] || "📡";
};

const Streams = () => {
  const [activeCategory, setActiveCategory] = useState("all");
  const [streams, setStreams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchStreams();
  }, []);

  const fetchStreams = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}streams`);
      setStreams(response.data || []);
      setError(null);
    } catch (err) {
      console.error("Error fetching streams:", err);
      setError("Failed to load streams");
      setStreams([]);
    } finally {
      setLoading(false);
    }
  };

  const categories = [
    { id: "all", name: "All Streams", icon: "📡" },
    { id: "live", name: "Live Now", icon: "🔴" },
    { id: "tournament", name: "Tournaments", icon: "🏆" },
    { id: "tutorial", name: "Tutorials", icon: "📚" },
    { id: "casual", name: "Casual", icon: "☕" },
    { id: "community", name: "Community", icon: "⚔" },
  ];

  const filteredStreams = streams.filter((stream) => {
    if (activeCategory === "all") return true;
    if (activeCategory === "live") return stream.is_live;
    return stream.category === activeCategory;
  });

  const liveCount = streams.filter((s) => s.is_live).length;

  const handleStreamClick = (stream) => {
    if (stream.stream_url) {
      window.open(stream.stream_url, '_blank', 'noopener,noreferrer');
    }
  };

  const formatViewerCount = (count) => {
    if (!count) return "0";
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + "K";
    }
    return count.toString();
  };

  if (loading) {
    return (
      <div className={styles["streams-container"]}>
        <div className={styles["streams-header"]}>
          <h1>Live Streams & Videos</h1>
          <p className={styles["subtitle"]}>Loading streams...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["streams-container"]}>
      <div className={styles["streams-header"]}>
        <h1>Live Streams & Videos</h1>
        <p className={styles["subtitle"]}>
          Watch live gameplay, tournaments, and learn from the community
        </p>
        {streams.length > 0 && (
          <div className={styles["live-indicator"]}>
            <span className={styles["live-dot"]}></span>
            {liveCount} {liveCount === 1 ? 'stream' : 'streams'} live now
          </div>
        )}
      </div>

      {streams.length > 0 && (
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
      )}

      <div className={styles["streams-grid"]}>
        {error ? (
          <div className={styles["no-streams"]}>
            <div className={styles["no-streams-icon"]}>⚠️</div>
            <h3>Unable to Load Streams</h3>
            <p>{error}</p>
            <button className={styles["retry-btn"]} onClick={fetchStreams}>
              Try Again
            </button>
          </div>
        ) : streams.length === 0 ? (
          <div className={styles["no-streams"]}>
            <div className={styles["no-streams-icon"]}>📺</div>
            <h3>No Streams Available</h3>
            <p>There are no live streams or videos at the moment. Check back later for upcoming content!</p>
          </div>
        ) : filteredStreams.length > 0 ? (
          filteredStreams.map((stream) => (
            <div 
              key={stream.id} 
              className={styles["stream-card"]}
              onClick={() => handleStreamClick(stream)}
            >
              {stream.is_live && (
                <div className={styles["live-badge"]}>
                  <span className={styles["pulse-dot"]}></span>
                  LIVE
                </div>
              )}
              <div className={styles["stream-thumbnail"]}>
                {stream.thumbnail_url ? (
                  <img 
                    src={getImageUrl(stream.thumbnail_url)} 
                    alt={stream.title}
                    className={styles["thumbnail-image"]}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div 
                  className={styles["thumbnail-placeholder"]}
                  style={{ display: stream.thumbnail_url ? 'none' : 'flex' }}
                >
                  {getCategoryIcon(stream.category)}
                </div>
                {stream.is_live && stream.viewer_count > 0 && (
                  <div className={styles["viewer-count"]}>
                    👁️ {formatViewerCount(stream.viewer_count)}
                  </div>
                )}
              </div>
              <div className={styles["stream-info"]}>
                <h3 className={styles["stream-title"]}>{stream.title}</h3>
                <p className={styles["streamer-name"]}>{stream.streamer_name}</p>
                {stream.game_name && (
                  <p className={styles["game-name"]}>{stream.game_name}</p>
                )}
                {stream.platform && stream.platform !== 'other' && (
                  <span className={styles["platform-badge"]}>
                    {stream.platform.charAt(0).toUpperCase() + stream.platform.slice(1)}
                  </span>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className={styles["no-streams"]}>
            <div className={styles["no-streams-icon"]}>🔍</div>
            <h3>No Streams in This Category</h3>
            <p>Try selecting a different category to find more content.</p>
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
