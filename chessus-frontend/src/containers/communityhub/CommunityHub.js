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
      title: "News",
      description: "Stay updated with the latest announcements, features, and community highlights",
      icon: "📰",
      path: "/news",
    },
    {
      title: "Support GridGrove",
      description: "Support GridGrove and help us grow the platform",
      icon: "💝",
      path: "/donate",
    },
    {
      title: "FAQ",
      description: "Find answers to common questions about creating pieces, games, and more",
      icon: "❓",
      path: "/faq",
    },
    {
      title: "About Us",
      description: "Learn about GridGrove, our team, and our mission",
      icon: "ℹ️",
      path: "/community/about",
    },
  ];

  const handleNavigate = (path) => {
    navigate(path);
  };

  return (
    <div className={styles["community-hub-container"]}>
      <div className={styles["community-hub-header"]}>
        <h1>Community Hub</h1>
        <p className={styles["subtitle"]}>
          Connect with players, compete for the top spot, and support the platform
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

      <div className={styles["community-welcome"]}>
        <h2>Welcome to the GridGrove Community!</h2>
        <p>
          Join thousands of players creating custom chess variants, competing in tournaments,
          and sharing strategies. Whether you're here to climb the leaderboard, showcase your
          creative designs, or simply enjoy unique gameplay experiences, you'll find your place
          in our vibrant community.
        </p>
      </div>
    </div>
  );
};

export default CommunityHub;
