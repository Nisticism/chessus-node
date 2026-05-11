import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import styles from "./streams.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const getImageUrl = (imagePath) => {
  if (!imagePath) return null;
  if (imagePath.startsWith('http')) return imagePath;
  if (!imagePath.startsWith('/')) return `${ASSET_URL}/${imagePath}`;
  return `${ASSET_URL}${imagePath}`;
};

const USER_STREAMS_POLL_MS = 2 * 60 * 1000; // 2 minutes — matches server cache TTL

const TwitchIcon = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
  </svg>
);

const Streams = () => {
  const [userStreams, setUserStreams] = useState([]);
  const [userStreamsLoading, setUserStreamsLoading] = useState(true);
  const userStreamsPollRef = useRef(null);

  useEffect(() => {
    fetchUserStreams();
    userStreamsPollRef.current = setInterval(fetchUserStreams, USER_STREAMS_POLL_MS);
    return () => clearInterval(userStreamsPollRef.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchUserStreams = async () => {
    try {
      const response = await axios.get(`${API_URL}user-streams`);
      setUserStreams(response.data || []);
    } catch (err) {
      console.error("Error fetching user streams:", err);
    } finally {
      setUserStreamsLoading(false);
    }
  };

  const formatViewerCount = (count) => {
    if (!count) return "0";
    if (count >= 1000) return (count / 1000).toFixed(1) + "K";
    return count.toString();
  };

  // Live-first sort: live streams at top, offline below, each group alphabetical
  const liveStreams = userStreams.filter(s => s.is_live);
  const offlineStreams = userStreams.filter(s => !s.is_live);
  const liveCount = liveStreams.length;

  if (userStreamsLoading) {
    return (
      <div className={styles["streams-container"]}>
        <div className={styles["streams-header"]}>
          <h1>Live Streams</h1>
          <p className={styles["subtitle"]}>Loading streams...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles["streams-container"]}>
      <div className={styles["streams-header"]}>
        <h1>Live Streams</h1>
        <p className={styles["subtitle"]}>
          Watch GridGrove community members play live on Twitch
        </p>
        {liveCount > 0 && (
          <div className={styles["live-indicator"]}>
            <span className={styles["live-dot"]}></span>
            {liveCount} {liveCount === 1 ? 'stream' : 'streams'} live now
          </div>
        )}
      </div>

      {/* ── Live Now ─────────────────────────────────────────── */}
      {liveStreams.length > 0 && (
        <section className={styles["live-section"]}>
          <div className={styles["section-heading"]}>
            <span className={styles["live-label"]}>
              <span className={styles["pulse-dot"]}></span>
              Live Now
            </span>
          </div>
          <div className={styles["live-grid"]}>
            {liveStreams.map(us => (
              <a
                key={us.user_id}
                href={`https://twitch.tv/${us.twitch_channel}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles["live-card"]}
              >
                <div className={styles["live-card-thumb"]}>
                  {us.thumbnail_url ? (
                    <img
                      src={us.thumbnail_url}
                      alt={`${us.username}'s stream`}
                      className={styles["thumb-img"]}
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles["thumb-placeholder"]}>
                      <TwitchIcon className={styles["twitch-icon"]} />
                    </div>
                  )}
                  <div className={styles["live-card-badge"]}>
                    <span className={styles["pulse-dot"]}></span>
                    LIVE
                  </div>
                  {us.viewer_count > 0 && (
                    <div className={styles["viewer-pill"]}>
                      {formatViewerCount(us.viewer_count)} viewers
                    </div>
                  )}
                </div>
                <div className={styles["live-card-body"]}>
                  <div className={styles["live-card-user"]}>
                    {us.profile_picture ? (
                      <img
                        src={getImageUrl(us.profile_picture)}
                        alt={us.username}
                        className={styles["live-card-avatar"]}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles["live-card-avatar-placeholder"]}>
                        {us.username[0].toUpperCase()}
                      </div>
                    )}
                    <div>
                      <span className={styles["live-card-username"]}>{us.username}</span>
                      <span className={styles["live-card-channel"]}>twitch.tv/{us.twitch_channel}</span>
                    </div>
                  </div>
                  {us.stream_title && (
                    <p className={styles["live-card-title"]}>{us.stream_title}</p>
                  )}
                  {us.game_name && (
                    <p className={styles["live-card-game"]}>{us.game_name}</p>
                  )}
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── Community Channels ───────────────────────────────── */}
      {userStreams.length > 0 ? (
        <section className={styles["community-streams-section"]}>
          <h2 className={styles["community-streams-title"]}>Community Channels</h2>
          <p className={styles["community-streams-subtitle"]}>
            GridGrove players who have linked their Twitch channels
          </p>
          <div className={styles["community-grid"]}>
            {[...liveStreams, ...offlineStreams].map(us => (
              <div
                key={us.user_id}
                className={`${styles["community-card"]} ${us.is_live ? styles["community-card-live"] : ""}`}
              >
                {us.is_live && (
                  <div className={styles["community-live-badge"]}>
                    <span className={styles["pulse-dot"]}></span>
                    LIVE
                  </div>
                )}
                <div className={styles["community-card-top"]}>
                  {us.thumbnail_url && us.is_live ? (
                    <img
                      src={us.thumbnail_url}
                      alt={`${us.twitch_channel} stream`}
                      className={styles["community-thumbnail"]}
                      loading="lazy"
                    />
                  ) : (
                    <div className={styles["community-thumbnail-placeholder"]}>
                      <TwitchIcon className={styles["twitch-icon"]} />
                    </div>
                  )}
                </div>
                <div className={styles["community-card-body"]}>
                  <div className={styles["community-user"]}>
                    {us.profile_picture ? (
                      <img
                        src={getImageUrl(us.profile_picture)}
                        alt={us.username}
                        className={styles["community-avatar"]}
                        loading="lazy"
                      />
                    ) : (
                      <div className={styles["community-avatar-placeholder"]}>
                        {us.username[0].toUpperCase()}
                      </div>
                    )}
                    <div className={styles["community-user-info"]}>
                      <Link to={`/profile/${us.username}`} className={styles["community-username"]}>
                        {us.username}
                      </Link>
                      {us.is_live ? (
                        <span className={styles["community-status-live"]}>
                          {us.viewer_count > 0 ? `${formatViewerCount(us.viewer_count)} viewers` : "Live"}
                        </span>
                      ) : (
                        <span className={styles["community-status-offline"]}>Offline</span>
                      )}
                    </div>
                  </div>
                  {us.stream_title && us.is_live && (
                    <p className={styles["community-stream-title"]}>{us.stream_title}</p>
                  )}
                  {us.game_name && us.is_live && (
                    <p className={styles["community-game-name"]}>{us.game_name}</p>
                  )}
                  <a
                    href={`https://twitch.tv/${us.twitch_channel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles["community-watch-btn"]} ${us.is_live ? styles["community-watch-btn-live"] : ""}`}
                    onClick={e => e.stopPropagation()}
                  >
                    {us.is_live ? "Watch Live" : "View Channel"}
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles["no-channels"]}>
          <div className={styles["no-channels-icon"]}>
            <TwitchIcon className={styles["twitch-icon-lg"]} />
          </div>
          <h3>No community channels yet</h3>
          <p>Players can link their Twitch channel from <strong>Profile &rarr; Edit Account &rarr; Connected Accounts</strong>.</p>
        </div>
      )}

      <div className={styles["streaming-info"]}>
        <p>
          Community streams are shown as live only when the streamer is playing chess or another
          grid-based strategy game on Twitch. To have your stream featured on this page,{" "}
          email <a href="mailto:support@gridgrove.gg">support@gridgrove.gg</a>.
        </p>
      </div>
    </div>
  );
};

export default Streams;
