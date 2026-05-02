import React from "react";
import styles from "./termsandconditions.module.scss";

const TermsAndConditions = () => {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Terms and Conditions</h1>
        <p className={styles.lastUpdated}>Last Updated: May 1, 2026</p>
        <p className={styles.intro}>
          Welcome to GridGrove. By creating an account or using this platform, you agree to be bound
          by these Terms and Conditions. Please read them carefully before registering or participating
          in any activity on the site.
        </p>

        <section className={styles.section}>
          <h2>1. Acceptance of Terms</h2>
          <p>
            By accessing or using GridGrove (the "Platform"), you confirm that you are at least 13
            years of age and agree to comply with these Terms and Conditions, our Privacy Policy, and
            any additional guidelines posted on the Platform. If you do not agree, do not use the
            Platform.
          </p>
        </section>

        <section className={styles.section}>
          <h2>2. Fair Play</h2>
          <p>
            GridGrove is a competitive strategy gaming platform and we are committed to maintaining a
            fair and honest environment for all players. You agree to:
          </p>
          <ul>
            <li>
              Play honestly and in good faith. Using automated scripts, bots, exploits, or any
              unauthorized software to gain an advantage over other players is strictly prohibited.
            </li>
            <li>
              Refrain from intentionally manipulating game outcomes, including deliberately losing to
              inflate an opponent's rating, or colluding with other players to affect standings or
              tournaments.
            </li>
            <li>
              Not abuse or exploit bugs, glitches, or unintended mechanics. If you discover a bug
              that affects gameplay, you are encouraged to report it to the moderation team.
            </li>
            <li>
              Accept match outcomes gracefully. Abandoning games repeatedly without valid reason may
              result in penalties to your account.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>3. Respect for User Creations and Intellectual Credit</h2>
          <p>
            GridGrove allows users to create and share custom games, piece designs, and other
            creative content. You agree to respect the creative work of others:
          </p>
          <ul>
            <li>
              You may not copy, republish, or claim ownership of another user's game designs, piece
              artwork, or other creations without their explicit permission.
            </li>
            <li>
              When discussing or building upon another user's work in forums, comments, or your own
              creations, give appropriate credit to the original creator.
            </li>
            <li>
              Do not reverse-engineer, decompile, or attempt to extract proprietary elements from
              other users' published game types or piece designs to reproduce them as your own.
            </li>
            <li>
              GridGrove respects intellectual property rights and will respond to valid copyright
              complaints. If you believe your work has been misappropriated, contact the moderation
              team.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>4. Community Conduct — No Hate Speech or Harassment</h2>
          <p>
            GridGrove is for everyone. All users must treat others with basic respect and dignity.
            The following are strictly prohibited in any part of the Platform, including chat,
            messages, forum posts, comments, usernames, and profile content:
          </p>
          <ul>
            <li>
              Hate speech, slurs, or discriminatory language targeting any person or group based on
              race, ethnicity, nationality, religion, gender, gender identity, sexual orientation,
              age, disability, or any other protected characteristic.
            </li>
            <li>
              Harassment, intimidation, threats, or targeted abuse directed at any user.
            </li>
            <li>
              Doxxing — sharing another user's personal, private, or identifying information without
              their consent.
            </li>
            <li>
              Sexual, explicit, or graphic content of any kind.
            </li>
            <li>
              Impersonating other users, public figures, or GridGrove staff.
            </li>
          </ul>
          <p>
            Violations of this section may result in immediate account suspension or permanent ban
            without prior warning.
          </p>
        </section>

        <section className={styles.section}>
          <h2>5. Competitive Conduct and Sportsmanship</h2>
          <p>
            As a competitive platform, GridGrove expects players to conduct themselves with
            sportsmanship at all times:
          </p>
          <ul>
            <li>
              Trash-talking, taunting, or unsportsmanlike behavior directed at opponents during or
              after matches is not permitted.
            </li>
            <li>
              Do not spam, flood, or send repetitive messages to other users through any communication
              feature on the Platform.
            </li>
            <li>
              Respect the rules and spirit of each custom game type. Intentionally exploiting unclear
              rules in a bad-faith manner is considered unsportsmanlike.
            </li>
            <li>
              Decisions made by moderators and administrators regarding disputes, penalties, or
              tournament rulings are final. You may appeal a decision via the contact page, but
              continued disruptive behavior during an appeal is not permitted.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>6. Chat, Messaging, and Forum Rules</h2>
          <p>
            GridGrove provides chat, private messaging, and public forum features. When using these
            features you agree to:
          </p>
          <ul>
            <li>
              Keep all communications respectful and relevant to the Platform's gaming and strategy
              community.
            </li>
            <li>
              Not post spam, unsolicited advertisements, phishing links, or malicious content.
            </li>
            <li>
              Not share content that is illegal, violates third-party rights, or is otherwise
              objectionable.
            </li>
            <li>
              Not use private messages to harass or stalk other users. Users can block others to
              prevent further contact; circumventing a block through alternate accounts is prohibited.
            </li>
            <li>
              Forum posts must be made in good faith and in the appropriate category. Off-topic
              flooding, necroposting with irrelevant content, and deliberate misinformation are not
              permitted.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>7. Account Responsibility</h2>
          <ul>
            <li>
              You are responsible for maintaining the security of your account credentials. Do not
              share your password with anyone.
            </li>
            <li>
              Each person may maintain only one active account. Creating multiple accounts to
              circumvent bans, manipulate ratings, or abuse platform features is prohibited.
            </li>
            <li>
              You are responsible for all activity that occurs under your account. If you believe
              your account has been compromised, contact support immediately.
            </li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>8. User-Generated Content</h2>
          <p>
            By submitting content to GridGrove — including game designs, piece artwork, forum posts,
            comments, and profile information — you grant GridGrove a non-exclusive, royalty-free
            license to display, distribute, and promote that content on the Platform. You retain
            ownership of your original creations.
          </p>
          <p>
            You represent that any content you submit does not violate any third-party intellectual
            property rights, privacy rights, or applicable laws.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Enforcement and Moderation</h2>
          <p>
            GridGrove reserves the right to remove content, issue warnings, suspend, or permanently
            ban any account that violates these Terms and Conditions. The severity of enforcement
            action will generally reflect the severity of the violation, but egregious violations
            (such as hate speech or doxxing) may result in immediate permanent bans.
          </p>
          <p>
            GridGrove is not obligated to provide advance notice before taking enforcement action.
            Users may appeal moderation decisions through the contact page.
          </p>
        </section>

        <section className={styles.section}>
          <h2>10. Changes to These Terms</h2>
          <p>
            GridGrove may update these Terms and Conditions from time to time. When we do, we will
            update the "Last Updated" date at the top of this page. Continued use of the Platform
            after changes are posted constitutes your acceptance of the revised terms.
          </p>
        </section>

        <section className={styles.section}>
          <h2>11. Limitation of Liability</h2>
          <p>
            GridGrove is provided "as is" without warranties of any kind. We are not liable for
            damages arising from your use of the Platform, including but not limited to loss of data,
            account access, or in-game progress. Your use of the Platform is at your own risk.
          </p>
        </section>

        <section className={styles.section}>
          <h2>12. Contact</h2>
          <p>
            If you have questions about these Terms and Conditions or wish to report a violation,
            please use the <a href="/contact" className={styles.link}>Contact</a> page.
          </p>
        </section>
      </div>
    </div>
  );
};

export default TermsAndConditions;
