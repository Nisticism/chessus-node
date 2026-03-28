import React from "react";
import styles from "./privacypolicy.module.scss";

const PrivacyPolicy = () => {
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.lastUpdated}>Last Updated: February 1, 2026</p>

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
          <h2>5. Cookies and Tracking</h2>
          <p>
            We use cookies and similar technologies to maintain your login session and improve your experience. 
            We may use analytics tools to understand how users interact with our platform.
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
