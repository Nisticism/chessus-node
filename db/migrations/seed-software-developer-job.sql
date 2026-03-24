-- Seed initial Software Developer job posting
-- This will be inserted after the is_career column is added

INSERT INTO articles (
  author_id, 
  title, 
  descript, 
  content, 
  created_at, 
  public, 
  is_career,
  genre
) VALUES (
  1,  -- Nisticism's user ID
  'Software Developer - Full Stack',
  'Join our team building the future of strategic board games. Work with React, Node.js, and SQL to create an innovative chess variant platform.',
  '**Position: Software Developer - Full Stack**

**Location:** Remote

**About GridGrove**

GridGrove is revolutionizing the world of strategic board games by creating a platform where players can design, share, and play custom chess variants with unlimited possibilities. We\'re building more than just a chess platformâ€”we\'re creating a complete game design ecosystem.

**The Role**

We\'re looking for a passionate full-stack developer to join our team and help shape the future of GridGrove. You\'ll work on both frontend and backend features, implement complex game logic, and help build tools that empower game designers and players worldwide.

**Required Skills & Technologies**

- **Frontend:** React 18+, Redux, HTML5, CSS3/SCSS
- **Backend:** Node.js, Express
- **Database:** MySQL, SQL query optimization
- **Real-time:** Socket.io for live multiplayer functionality
- **Version Control:** Git

**Nice to Have**

- Experience with AI-assisted coding tools (GitHub Copilot, ChatGPT, Claude, etc.)
- Passion for chess, board games, or strategic games
- Experience with game development or complex state management
- Understanding of ELO rating systems
- Payment integration experience (Stripe, PayPal)
- Analytics implementation (Google Analytics)

**What You\'ll Work On**

- Implementing new game mechanics and piece abilities
- Building intuitive game creation and editing tools
- Developing real-time multiplayer features
- Optimizing game state management and performance
- Creating responsive, accessible UI components
- Writing clean, maintainable, well-documented code

**What We Offer**

- Fully remote work
- Flexible hours
- Work on innovative, challenging problems
- Opportunity to shape the product direction
- Collaborative, learning-focused environment
- Competitive compensation

**About You**

You\'re a developer who loves solving complex problems and building elegant solutions. You enjoy working with modern web technologies and aren\'t afraid to dive into challenging codebases. You appreciate clean code, good architecture, and understand the balance between perfection and shipping features.

Most importantly, you\'re excited about creating tools that empower creativity and bring people together through strategic games.

**How to Apply**

Send your resume, portfolio, and a brief note about why you\'re interested in GridGrove to **fosterhans@gmail.com**

Please include:
- Your GitHub profile or code samples
- Any relevant projects you\'ve built
- What excites you most about this role

We look forward to hearing from you!',
  NOW(),
  1,  -- public
  1,  -- is_career
  'Careers'
);
