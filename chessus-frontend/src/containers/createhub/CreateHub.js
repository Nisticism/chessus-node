import React from "react";
import { Link } from "react-router-dom";
import styles from "./createhub.module.scss";

const CreateHub = () => {
  const creationOptions = [
    {
      title: "Design a Game",
      description: "Create your own custom strategy game with unique rules, board layouts, and winning conditions. Define how pieces move, capture, and interact to craft entirely new game experiences.",
      link: "/create/game",
      icon: "♛"
    },
    {
      title: "Design a Piece",
      description: "Build custom chess pieces with your own movement patterns, capture rules, and special abilities. Upload custom graphics and define unique behaviors to use in your games.",
      link: "/create/piece",
      icon: "♟️"
    },
    {
      title: "View Games",
      description: "Browse all custom games created by the Squarestrat community. Discover new game types, see what others have built, and find inspiration for your own creations.",
      link: "/create/games",
      icon: "📋"
    },
    {
      title: "View Pieces",
      description: "Explore the collection of custom pieces designed by the community. See piece images, movement patterns, and find pieces to use in your own game designs.",
      link: "/create/pieces",
      icon: "👁️"
    }
  ];

  return (
    <div className="container">
      <div className={styles["createhub-container"]}>
        <div className={styles["createhub-header"]}>
          <h1>Create Hub</h1>
          <p className={styles["createhub-subtitle"]}>
            Design custom games and pieces, or explore what the community has created
          </p>
        </div>

        <div className={styles["options-grid"]}>
          {creationOptions.map((option, index) => (
            <Link 
              to={option.link} 
              key={index} 
              className={styles["option-card"]}
            >
              <div className={styles["option-icon"]}>{option.icon}</div>
              <h2 className={styles["option-title"]}>{option.title}</h2>
              <p className={styles["option-description"]}>{option.description}</p>
              <div className={styles["option-link"]}>
                Get Started →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CreateHub;