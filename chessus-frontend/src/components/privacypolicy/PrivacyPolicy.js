import React from "react";
import styles from "./privacypolicy.module.scss";

const PrivacyPolicy = () => {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.lastUpdated}>Last Updated: August 29, 2026</p>

        <section className={styles.section}>
          <h2>1. Information We Collect</h2>
          <p>
            When you create an account on GridGrove, we collect information you provide directly, including:
          </p>
          <ul>
            <li>Username and email address</li>
            <li>Profile information (optional profile picture, bio)</li>
            <li>Game creations, piece designs, and forum posts</li>
            <li>Match history and gameplay statistics</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide and maintain the GridGrove platform</li>
            <li>Enable you to create, share, and play custom board games</li>
            <li>Display your public profile and creations to other users</li>
            <li>Communicate with you about platform updates and features</li>
            <li>Improve our services and user experience</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>3. Information Sharing</h2>
          <p>
            Your username, public profile information, game creations, and forum posts are visible to other users.
          </p>
          <p>
            <strong>Piece images you upload are shared with the community.</strong> When you upload an
            image for use as a piece, that image is stored on our servers and made available to all
            GridGrove users for their own piece designs. Do not upload images you do not have the right
            to share publicly.
          </p>
          <p>
            <strong>We will never sell your personal information.</strong> We do not sell, trade, or otherwise 
            transfer your personal data to third parties for marketing or any other purpose. We may share 
            information only when required by law or to protect the rights and safety of GridGrove and its users.
          </p>
        </section>

        <section className={styles.section}>
          <h2>4. Data Security</h2>
          <p>
            We implement security measures to protect your information, including encrypted passwords and secure 
            server infrastructure. However, no method of transmission over the internet is 100% secure, and we 
            cannot guarantee absolute security.
          </p>
        </section>

        <section className={styles.section}>
          <h2>5. Cookies and Analytics</h2>
          <p>
            We use browser storage to keep you logged in and to remember your preferences. We do
            <strong> not</strong> use Google Analytics or any third-party advertising or tracking scripts.
          </p>
          <p>
            To understand overall usage of the site, we collect basic, anonymous analytics using our own
            servers (no third parties). For each page view we record: the page path, the referring site or
            campaign source (for example, a link you followed from Reddit), an approximate country derived
            from your IP address (the IP address itself is not stored), whether the visitor was signed in,
            and a random visitor identifier stored in your browser so we can count unique visitors. This
            data is not tied to your account or any personal information, is never sold or shared, and is
            used only in aggregate to see how many people use the site and where they come from.
          </p>
        </section>

        <section className={styles.section}>
          <h2>6. Your Rights</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access and update your account information</li>
            <li>Delete your account and associated data</li>
            <li>Opt out of promotional communications</li>
            <li>Request a copy of your data</li>
          </ul>
        </section>

        <section className={styles.section}>
          <h2>7. Children's Privacy</h2>
          <p>
            GridGrove is not intended for users under the age of 13. We do not knowingly collect personal 
            information from children under 13. If you believe we have collected information from a child under 13, 
            please contact us immediately.
          </p>
        </section>

        <section className={styles.section}>
          <h2>8. Changes to This Policy</h2>
          <p>
            We may update this privacy policy from time to time. We will notify users of significant changes by 
            posting the new policy on this page with an updated "Last Updated" date.
          </p>
        </section>

        <section className={styles.section}>
          <h2>9. Contact Us</h2>
          <p>
            If you have questions about this privacy policy or how we handle your data, please contact us through 
            our <a href="/contact">contact page</a>.
          </p>
        </section>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
