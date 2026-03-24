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
      title: "Leaderboard",
      description: "View the top players ranked by ELO rating",
      icon: "🏆",
      path: "/community/leaderboard",
    },
    {
      title: "Donate",
      description: "Support GridGrove and help us grow the platform",
      icon: "💝",
      path: "/donate",
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
