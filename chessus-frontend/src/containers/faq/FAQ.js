import React, { useState } from "react";
import { Link } from "react-router-dom";
import styles from "./faq.module.scss";

const faqData = [
  {
    category: "About GridGrove",
    questions: [
      {
        q: "What is GridGrove?",
        a: "GridGrove is a community-driven platform where players can design, share, and play custom strategy board games. Think of it as a chess variant studio — you can create pieces with unique movement patterns, build games with custom rules, and challenge others online."
      },
      {
        q: "Is GridGrove free to use?",
        a: "Yes, GridGrove is completely free. You can create an account, design pieces and games, play matches, and participate in the community at no cost. We accept voluntary donations to help cover hosting costs, but there is no paywall or premium tier."
      },
      {
        q: "Was AI used to build GridGrove?",
        a: "Yes, AI coding tools were used as part of the development process — primarily as a programming assistant to help write, review, and refactor code. All design decisions, game logic, and creative direction were made by humans. The on-site AI training system is also a core feature, letting users train bots for their own custom games."
      },
      {
        q: "What are GridGrove's long-term goals?",
        a: "Our goals include expanding the tournament system for large-scale competitive events, building smarter AI opponents for any custom game, launching a mobile app, adding support for more board game formats like Shogi and Go, and growing a global community of strategy game designers. See the About page for more details."
      },
      {
        q: "Who created GridGrove?",
        a: "GridGrove was founded in 2025 with the goal of making chess variant design accessible to everyone. You can learn more about the team on the About page."
      },
      {
        q: "Can I use piece images or games from GridGrove commercially?",
        a: "Piece images uploaded by users are shared under community use terms — you may use them within GridGrove. For commercial or external use, check the image's original source and the uploader's intent. Game designs belong to their creators. See our Terms and Conditions for full details."
      },
    ]
  },
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
    category: "Piece Values & Analysis",
    questions: [
      {
        q: "What does the 'Approx. Value on 9×9' shown on a piece's detail page mean?",
        a: "It is a simulation-based estimate of how powerful the piece is on a 9×9 board. The system places the piece at the center of an empty board, counts every square it can move to and every square it can attack (with higher weights for ranged attacks), then divides the total by 5.5 to produce a human-readable score. A standard rook scores roughly 5.0 as a reference point. The estimate is intentionally approximate — it cannot account for board position, opponent density, or the tactical context of a specific game variant."
      },
      {
        q: "How are movement squares counted in the value estimate?",
        a: "Every square the piece can reach through any movement type — directional, L-shaped (ratio/knight-style), step-by-step BFS, special scenario moves, or custom-defined squares — adds 1.0 to the internal score. Step-by-step movement squares add 1.2 instead of 1.0, because the ability to navigate around obstacles improves functional mobility beyond what a raw square count captures. The simulation runs on a fully empty board, so blocker pieces are not considered (hopping bonuses handle that separately)."
      },
      {
        q: "How are attack squares counted?",
        a: "Each square the piece can threaten adds to the internal score independently of movement: normal captures add 1.0 each, ranged attacks add 1.5 (reflecting their superior threat from a distance), and step-by-step attack squares also receive a ×1.2 bonus. First-move-only captures are halved to 0.5 since they are rarely available. When a square appears in both the move set and the attack set, each contribution is counted separately — a piece that can both move to and capture on the same square gets credit for both."
      },
      {
        q: "What is the color-bound penalty?",
        a: "If every square a piece can reach shares the same board color as its starting square — as a bishop does — it receives a ×0.7 penalty on that contribution, because it can never threaten half the board. The check compares each reachable square's parity against the center square's parity. A bishop lands on squares matching the center, so it is penalized. A knight always lands on the opposite parity from the center, so it is not penalized. Move and attack coverage are tested independently — a piece could be color-bound in its movement but not in its attacks."
      },
      {
        q: "What is the directional coverage penalty?",
        a: "A piece that cannot reach any square forward (above its starting position in the simulation) or any square backward (below it) receives a ×0.7 penalty, reflecting that strictly one-directional pieces are far easier to avoid. This check is based on what the piece can actually reach after all movement types have been processed — including custom squares and special scenario moves — so a piece with symmetric custom movement that covers both directions is correctly treated as bidirectional and not penalized."
      },
      {
        q: "What global multipliers are applied to piece value?",
        a: "After the base move and attack contributions are summed, several multipliers adjust the score in order: No attack ability at all ×0.6 (pure movement pieces are much weaker). Ghostwalk ×1.4 (can pass through blocking pieces). Cannot be captured ×1.6 (near-invincible pieces dominate). Can promote ×1.2. Dies on capture ×0.8. Hopping over both allied and enemy pieces ×1.15; one side only ×1.1. Attack or trample radius ×1.25 applied to the attack contribution (area damage is more effective per square). No forward movement or no backward movement ×0.7. HP degradation scales the value proportionally for pieces with hit points."
      },
      {
        q: "How do special attack abilities affect the estimate?",
        a: "Several wizard-configurable abilities add further multipliers on top of the global ones: multiple capture actions per turn add up to ×1.32 (×0.08 per extra action, capped at 4 extras); multiple ranged capture actions per turn add up to ×1.28 (×0.07 per extra); chain capture (checkers-style multi-hop) ×1.1; capture-on-hop ×1.1 (when hopping is enabled); fire-over allies or enemies for ranged pieces applies ×1.1 for one side or ×1.15 for both; the same scaling applies to hop-attack-over. A delay before the piece can move (min turns until movement) reduces the value by 10% per turn, down to a minimum multiplier of ×0.5."
      },
      {
        q: "Is the piece value estimate used during live gameplay?",
        a: "Yes. The server pre-computes piece values at game start using the actual board dimensions for that game variant. During play, the material balance display uses these values to show which player has an advantage in captured pieces — the difference is only shown when meaningful. The AI bot also uses piece values for move ordering (captures of high-value targets are searched first) and as part of its position evaluation function when deciding which moves to make."
      },
      {
        q: "Why might the estimate seem lower than expected for my piece?",
        a: "The most common causes are the directional coverage penalty (piece only moves in one direction), the color-bound penalty (piece is restricted to one board color), or having no attack squares at all (×0.6 multiplier). Pieces with step-by-step ranged attacks should show correctly — the system uses both the raw DB field (step_by_step_attack_value) and the computed live-game field interchangeably. If the value still seems off, remember the estimate is for a 9×9 empty board; the piece's true value in a specific game variant may differ significantly based on board size, starting position, and opponent piece composition."
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
