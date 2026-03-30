import React, { useState } from "react";
import { Link } from "react-router-dom";
import styles from "./faq.module.scss";

const faqData = [
  {
    category: "Creating Pieces",
    questions: [
      {
        q: "How do I create a custom piece?",
        a: "Navigate to Create > New Piece. You'll be taken to the Piece Wizard where you can define your piece's name, movement pattern, capture behavior, and appearance. Start by choosing a base movement type, then customize the range and direction of movement on the grid."
      },
      {
        q: "What movement options are available for custom pieces?",
        a: "You can define movement in any combination of directions: horizontal, vertical, diagonal, and L-shaped (like a knight). You can set the range for each direction, allow or disallow jumping over other pieces, and configure special behaviors like hop-only movement."
      },
      {
        q: "Can my piece have different movement and capture patterns?",
        a: "Yes! In the Piece Wizard, you can configure movement and capture independently. A piece might move in one pattern but capture in a completely different pattern, similar to how a pawn in standard chess moves forward but captures diagonally."
      },
      {
        q: "How do I upload a custom image for my piece?",
        a: "During piece creation, you can upload an SVG or image file for your piece's appearance. The image will be displayed on the board during gameplay. We recommend using SVG format for the best quality at all board sizes."
      },
      {
        q: "Can I edit a piece after creating it?",
        a: "Yes, you can edit your pieces at any time by going to Create > Piece Library, finding your piece, and clicking the edit button. Note that changes to a piece may affect games that use it."
      }
    ]
  },
  {
    category: "Creating Games",
    questions: [
      {
        q: "How do I create a custom game variant?",
        a: "Go to Create > New Game. You'll set up the board size, choose which pieces to include, define their starting positions, and configure game rules like win conditions, castling, en passant, and draw rules."
      },
      {
        q: "What board sizes are supported?",
        a: "GridGrove supports a wide variety of board sizes. You can create boards ranging from small 4x4 grids up to larger configurations, allowing for everything from quick tactical games to sprawling strategic battles."
      },
      {
        q: "Can I use both standard chess pieces and custom pieces in my game?",
        a: "Absolutely! When designing a game, you can mix and match standard chess pieces with any custom pieces created by the community. This lets you create unique variants that build on familiar chess concepts."
      },
      {
        q: "How do I set up starting positions for pieces?",
        a: "In the game designer, you'll see a visual board where you can drag and drop pieces onto their starting squares. You can place pieces for both players and configure the board layout however you like."
      },
      {
        q: "What win conditions can I set?",
        a: "The primary win condition is checkmate, but you can configure additional rules like draw conditions based on move limits, stalemate handling, and other custom victory conditions depending on your game design."
      },
      {
        q: "Is there a step-by-step tutorial for creating a game?",
        a: "Yes! We have a detailed tutorial that walks you through recreating standard chess from scratch — including creating all six pieces, placing them on the board, and configuring special rules like castling, en passant, and promotion.",
        link: { to: "/tutorial/chess", text: "View Chess Tutorial →" }
      }
    ]
  },
  {
    category: "Playing Games",
    questions: [
      {
        q: "How do I find and join a game?",
        a: "Go to Play > Browse Open Games to see available matches. You can filter by game variant and join any open game. You can also play in the Sandbox to practice, or create a private game to play with friends."
      },
      {
        q: "How does the ELO rating system work?",
        a: "All players start with an ELO rating of 1000. When you win a game, your rating increases, and when you lose, it decreases. The amount of change depends on the rating difference between you and your opponent — beating a higher-rated player earns more points."
      },
      {
        q: "Can I play with friends?",
        a: "Yes! You can challenge friends directly from their profile page or from the Play section. You can also create private games and share the link with friends to invite them to play."
      },
      {
        q: "What is the Sandbox?",
        a: "The Sandbox is a free-play mode where you can experiment with any game variant without affecting your ELO rating. It's perfect for learning new game types, testing strategies, or just having fun without competitive pressure."
      },
      {
        q: "How do tournaments work?",
        a: "Tournaments are organized competitive events where players compete in a structured format. Check the Play > Tournaments section for upcoming events, entry requirements, and schedules."
      }
    ]
  },
  {
    category: "Account & Profile",
    questions: [
      {
        q: "How do I change my profile picture?",
        a: "Visit your profile page and click on your current profile picture. A modal will appear where you can upload a new image. You can also change it from Edit Account under the Profile Picture Upload section."
      },
      {
        q: "Can I change my username?",
        a: "Yes, go to your profile and click Edit Account. You can update your username there, as long as your new username isn't already taken by another player."
      },
      {
        q: "How do I add a bio to my profile?",
        a: "Navigate to Edit Account from your profile page. You'll find a Bio section where you can write about yourself, your play style, or anything you'd like other players to know about you."
      },
      {
        q: "Can other players see my name on my profile?",
        a: "By default, your name is private. You can enable the \"Display name on profile\" setting in Edit Account to make your first and last name visible to other players who visit your profile."
      }
    ]
  },
  {
    category: "Community & Forums",
    questions: [
      {
        q: "How do I participate in the forums?",
        a: "Visit the Community section and click on Forums. You can browse existing discussions, reply to threads, or create new topics. There are both general forums for broad discussion and game-specific forums for talking about particular variants."
      },
      {
        q: "How can I support GridGrove?",
        a: "You can support GridGrove by donating through our Support Us page. Donations help keep the platform running and fund new features. Donors receive special badges displayed on their profile based on their contribution level."
      },
      {
        q: "What are donor badges?",
        a: "Donor badges are special recognitions displayed on your profile. Silver badges are awarded for donations of $5–$49.99, and Gold badges for donations of $50 or more. You can choose to hide your badge in your account settings if you prefer."
      },
      {
        q: "How do I report a bug or suggest a feature?",
        a: "Use the Contact page to reach out to us with bug reports, feature suggestions, or any other feedback. You can also discuss ideas in the forums where the community and developers can weigh in."
      }
    ]
  }
];

const FAQ = () => {
  const [openItems, setOpenItems] = useState({});
  const [activeCategory, setActiveCategory] = useState(null);

  const toggleItem = (categoryIndex, questionIndex) => {
    const key = `${categoryIndex}-${questionIndex}`;
    setOpenItems(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const filteredData = activeCategory !== null 
    ? [faqData[activeCategory]] 
    : faqData;

  return (
    <div className={styles["faq-container"]}>
      <div className={styles["faq-header"]}>
        <h1>Frequently Asked Questions</h1>
        <p className={styles["subtitle"]}>
          Find answers to common questions about GridGrove
        </p>
      </div>

      <div className={styles["category-filters"]}>
        <button 
          className={`${styles["filter-button"]} ${activeCategory === null ? styles["active"] : ""}`}
          onClick={() => setActiveCategory(null)}
        >
          All
        </button>
        {faqData.map((category, index) => (
          <button
            key={index}
            className={`${styles["filter-button"]} ${activeCategory === index ? styles["active"] : ""}`}
            onClick={() => setActiveCategory(activeCategory === index ? null : index)}
          >
            {category.category}
          </button>
        ))}
      </div>

      <div className={styles["faq-content"]}>
        {filteredData.map((category, catIdx) => {
          const actualCatIdx = activeCategory !== null ? activeCategory : catIdx;
          return (
            <div key={actualCatIdx} className={styles["faq-category"]}>
              <h2 className={styles["category-title"]}>{category.category}</h2>
              <div className={styles["questions-list"]}>
                {category.questions.map((item, qIdx) => {
                  const key = `${actualCatIdx}-${qIdx}`;
                  const isOpen = openItems[key];
                  return (
                    <div 
                      key={qIdx} 
                      className={`${styles["faq-item"]} ${isOpen ? styles["open"] : ""}`}
                    >
                      <button 
                        className={styles["faq-question"]}
                        onClick={() => toggleItem(actualCatIdx, qIdx)}
                      >
                        <span>{item.q}</span>
                        <span className={styles["toggle-icon"]}>{isOpen ? "−" : "+"}</span>
                      </button>
                      {isOpen && (
                        <div className={styles["faq-answer"]}>
                          <p>{item.a}</p>
                          {item.link && (
                            <p style={{ marginTop: '10px' }}>
                              <Link to={item.link.to} className={styles["faq-link"]}>{item.link.text}</Link>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default FAQ;
