import React from "react";
import styles from "./socialmedia.module.scss";

const SocialMedia = () => {
  const socialPlatforms = [
    {
      name: "Twitter",
      handle: "@Squarestrat",
      icon: "🐦",
      url: "https://twitter.com/squarestrat",
      description: "Follow us for quick updates, game highlights, and community interaction",
      stats: "2.5K Followers",
    },
    {
      name: "Discord",
      handle: "Squarestrat Community",
      icon: "💬",
      url: "https://discord.gg/squarestrat",
      description: "Join our active community for real-time chat, events, and support",
      stats: "5.2K Members",
    },
    {
      name: "YouTube",
      handle: "Squarestrat Official",
      icon: "▶️",
      url: "https://youtube.com/squarestrat",
      description: "Watch tutorials, gameplay videos, and tournament highlights",
      stats: "8.7K Subscribers",
    },
    {
      name: "Reddit",
      handle: "r/Squarestrat",
      icon: "🤖",
      url: "https://reddit.com/r/squarestrat",
      description: "Discuss strategies, share creations, and participate in community polls",
      stats: "3.1K Members",
    },
    {
      name: "Twitch",
      handle: "Squarestrat",
      icon: "📡",
      url: "https://twitch.tv/squarestrat",
      description: "Watch live streams of tournaments, game design sessions, and more",
      stats: "1.8K Followers",
    },
    {
      name: "Instagram",
      handle: "@Squarestrat",
      icon: "📸",
      url: "https://instagram.com/squarestrat",
      description: "Visual highlights, behind-the-scenes content, and community showcases",
      stats: "4.3K Followers",
    },
  ];

  const handleSocialClick = (url) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className={styles["social-media-container"]}>
      <div className={styles["social-media-header"]}>
        <h1>Connect With Us</h1>
        <p className={styles["subtitle"]}>
          Join our community across multiple platforms and stay connected
        </p>
      </div>

      <div className={styles["platforms-grid"]}>
        {socialPlatforms.map((platform, index) => (
          <div
            key={index}
            className={styles["platform-card"]}
            onClick={() => handleSocialClick(platform.url)}
          >
            <div className={styles["platform-header"]}>
              <div className={styles["icon"]}>{platform.icon}</div>
              <div className={styles["platform-info"]}>
                <h2 className={styles["platform-name"]}>{platform.name}</h2>
                <p className={styles["handle"]}>{platform.handle}</p>
              </div>
            </div>
            <p className={styles["description"]}>{platform.description}</p>
            <div className={styles["platform-footer"]}>
              <span className={styles["stats"]}>{platform.stats}</span>
              <span className={styles["follow-button"]}>Follow →</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles["community-section"]}>
        <h2>Stay Updated</h2>
        <p>
          Follow us on your favorite platforms to get the latest news, participate in events,
          and connect with fellow Squarestrat enthusiasts. Share your custom games, pieces, and
          strategies with the community!
        </p>
      </div>
    </div>
  );
};

export default SocialMedia;
