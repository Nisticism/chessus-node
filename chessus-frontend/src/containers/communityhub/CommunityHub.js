import React from "react";
import { useNavigate } from "react-router-dom";
import styles from "./communityhub.module.scss";

const CommunityHub = () => {
  const navigate = useNavigate();

  const communityOptions = [
    {
      title: "Players",
      description: "Browse all registered players and view their profiles",
      icon: "🧑‍🤝‍🧑",
      path: "/community/players",
    },
    {
      title: "Forums",
      description: "Browse all general and game-specific forum discussions in one place",
      icon: "💬",
      path: "/forums",
    },
    {
      title: "Social Media",
      description: "Follow us on social platforms and stay connected with our community",
      icon: "🌐",
      path: "/community/social",
    },
    {
      title: "Streams",
      description: "Watch live gameplay, tournaments, and community events",
      icon: "📺",
      path: "/community/streams",
    },
    {
      title: "Leaderboard",
      description: "See top-ranked players and track standings across game types",
      icon: "🏆",
      path: "/leaderboard",
    },
  ];

  const handleNavigate = (path) => {
    navigate(path);
  };

  return (
    <div className={styles["community-hub-container"]}>
      <div className={styles["community-hub-header"]}>
        <h1>Community Hub</h1>
      </div>

      <div className={styles["community-welcome"]}>
        <h2>Welcome to the GridGrove Community</h2>
        <p>
          This is your starting point for everything community-related on GridGrove.
          Browse player profiles, participate in forum discussions, check the leaderboard,
          tune into live streams, or connect with us on social media.
        </p>
      </div>

      <div className={styles["community-options-grid"]}>
        {communityOptions.map((option, index) => (
          <div
            key={index}
            className={styles["community-option-card"]}
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

export default CommunityHub;
