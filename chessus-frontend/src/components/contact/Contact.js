import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import styles from './Contact.module.scss';
import Divider from '../Divider/Divider';
import StandardButton from '../standardbutton/StandardButton';

const Contact = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [formData, setFormData] = useState({
    name: currentUser?.username || '',
    email: currentUser?.email || '',
    subject: '',
    message: ''
  });
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);

    try {
      const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
      const response = await fetch(`${API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      setSubmitted(true);
      setFormData({
        name: currentUser?.username || '',
        email: currentUser?.email || '',
        subject: '',
        message: ''
      });

      // Reset submitted state after 5 seconds
      setTimeout(() => {
        setSubmitted(false);
      }, 5000);
    } catch (err) {
      setError('Failed to send message. Please try again or contact directly via email.');
      console.error('Contact form error:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.contactContainer}>
      <div className={styles.contactContent}>
        <h1 className={styles.title}>Contact Us</h1>
        
        <Divider />

        <div className={styles.description}>
          <p>
            Have a question, suggestion, or feedback? We'd love to hear from you! 
            Fill out the form below or reach out through one of our other channels.
          </p>
        </div>

        <Divider />

        {submitted && (
          <div className={styles.successMessage}>
            <span className={styles.successIcon}>✓</span>
            <p>Thank you for your message! We'll get back to you as soon as possible.</p>
          </div>
        )}

        {error && (
          <div className={styles.errorMessage}>
            <span className={styles.errorIcon}>⚠</span>
            <p>{error}</p>
          </div>
        )}

        <div className={styles.formSection}>
          <h2 className={styles.sectionTitle}>Send us a Message</h2>
          
          <form onSubmit={handleSubmit} className={styles.contactForm}>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="name">Your Name *</label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="Enter your name"
                  className={styles.formInput}
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="email">Your Email *</label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="your.email@example.com"
                  className={styles.formInput}
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="subject">Subject *</label>
              <input
                type="text"
                id="subject"
                name="subject"
                value={formData.subject}
                onChange={handleChange}
                required
                placeholder="What's this about?"
                className={styles.formInput}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="message">Message *</label>
              <textarea
                id="message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                required
                placeholder="Tell us what's on your mind..."
                rows={8}
                className={styles.formTextarea}
              />
            </div>

            <div className={styles.buttonContainer}>
              <StandardButton
                buttonText={sending ? "Sending..." : "Send Message"}
                onClick={handleSubmit}
                disabled={sending}
              />
            </div>
          </form>
        </div>

        <Divider />

        <div className={styles.otherContactMethods}>
          <h2 className={styles.sectionTitle}>Other Ways to Reach Us</h2>
          
          <div className={styles.contactMethods}>
            <div className={styles.contactMethod}>
              <span className={styles.methodIcon}>✉</span>
              <div className={styles.methodInfo}>
                <h3>Direct Email</h3>
                <p>
                  <a href="mailto:fosterhans@gmail.com">fosterhans@gmail.com</a>
                </p>
              </div>
            </div>

            <div className={styles.contactMethod}>
              <span className={styles.methodIcon}>💬</span>
              <div className={styles.methodInfo}>
                <h3>Community Forums</h3>
                <p>
                  Join discussions and get help from the community in our{' '}
                  <a href="/forums">forums</a>
                </p>
              </div>
            </div>

            <div className={styles.contactMethod}>
              <span className={styles.methodIcon}>🔗</span>
              <div className={styles.methodInfo}>
                <h3>Social Media</h3>
                <p>
                  {/* Add your social media links here */}
                  Follow us on social media (links coming soon)
                </p>
              </div>
            </div>

            <div className={styles.contactMethod}>
              <span className={styles.methodIcon}>🐛</span>
              <div className={styles.methodInfo}>
                <h3>Bug Reports</h3>
                <p>
                  Found a bug? Report it directly through the contact form above or visit our forums
                </p>
              </div>
            </div>
          </div>
        </div>

        <Divider />

        <div className={styles.responseTime}>
          <p>
            <strong>Response Time:</strong> We typically respond within 24-48 hours. 
            For urgent matters, please indicate "URGENT" in your subject line.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Contact;
