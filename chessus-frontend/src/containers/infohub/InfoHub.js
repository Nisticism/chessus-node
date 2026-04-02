import React from "react";
import { useNavigate } from "react-router-dom";
import styles from "./infohub.module.scss";

const InfoHub = () => {
  const navigate = useNavigate();

  const infoOptions = [
    {
      title: "News",
      description: "Stay updated with the latest announcements, features, and community highlights",
      icon: "📰",
      path: "/news",
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
    {
      title: "Contact",
      description: "Get in touch with the GridGrove team for support, feedback, or inquiries",
      icon: "✉️",
      path: "/contact",
    },
    {
      title: "Support GridGrove",
      description: "Support GridGrove and help us grow the platform",
      icon: "💝",
      path: "/donate",
    },
  ];

  const handleNavigate = (path) => {
    navigate(path);
  };

  return (
    <div className={styles["info-hub-container"]}>
      <div className={styles["info-hub-header"]}>
        <h1>Info Hub</h1>
        <p className={styles["subtitle"]}>
          News, help, and everything you need to know about GridGrove
        </p>
      </div>

      <div className={styles["info-options-grid"]}>
        {infoOptions.map((option, index) => (
          <div
            key={index}
            className={styles["info-option-card"]}
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

export default InfoHub;
