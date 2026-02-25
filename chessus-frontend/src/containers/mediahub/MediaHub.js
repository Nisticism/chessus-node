import React from "react";
import { useNavigate } from "react-router-dom";
import styles from "./mediahub.module.scss";

const MediaHub = () => {
  const navigate = useNavigate();

  const mediaOptions = [
    {
      title: "General Forums",
      description: "Discuss strategies, share ideas, and connect with the Squarestrat community",
      icon: "💬",
      path: "/forums",
    },
    {
      title: "Game Forums",
      description: "Join discussions about specific custom games and share your experiences",
      icon: "♛",
      path: "/forums/game",
    },
    {
      title: "Social Media",
      description: "Follow us on social platforms and stay connected with our community",
      icon: "🌐",
      path: "/media/social",
    },
    {
      title: "Streams",
      description: "Watch live gameplay, tournaments, and community events",
      icon: "📺",
      path: "/media/streams",
    },
    {
      title: "News",
      description: "Stay updated with the latest announcements, features, and community highlights",
      icon: "📰",
      path: "/news",
    },
  ];

  const handleNavigate = (path) => {
    navigate(path);
  };

  return (
    <div className={styles["media-hub-container"]}>
      <div className={styles["media-hub-header"]}>
        <h1>Media Hub</h1>
        <p className={styles["subtitle"]}>
          Connect, share, and stay informed with the Squarestrat community
        </p>
      </div>

      <div className={styles["media-options-grid"]}>
        {mediaOptions.map((option, index) => (
          <div
            key={index}
            className={styles["media-option-card"]}
            onClick={() => handleNavigate(option.path)}
          >
            <div className={styles["icon"]}>{option.icon}</div>
            <h2 className={styles["option-title"]}>{option.title}</h2>
            <p className={styles["option-description"]}>{option.description}</p>
            <div className={styles["explore-button"]}>Explore →</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MediaHub;
