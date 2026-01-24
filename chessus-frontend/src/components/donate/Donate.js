import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "./donate.module.scss";
import Divider from "../Divider/Divider";
import StandardButton from "../standardbutton/StardardButton";
import { trackDonation } from "../../analytics/GoogleAnalytics";

const Donate = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showThankYou, setShowThankYou] = useState(false);
  const [donationAmount, setDonationAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const location = useLocation();
  const navigate = useNavigate();

  const predefinedAmounts = [5, 10, 25, 50, 100];

  // Check for success parameter in URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const success = params.get('success');
    const amount = params.get('amount');
    const method = params.get('method');
    
    if (success === 'true' && amount) {
      setShowThankYou(true);
      setDonationAmount(parseFloat(amount));
      setPaymentMethod(method || 'payment');
      
      // Track successful donation
      trackDonation(parseFloat(amount));
      
      // Send donation confirmation email
      const confirmDonation = async () => {
        if (currentUser && currentUser.email) {
          try {
            const API_URL = process.env.REACT_APP_API_URL;
            await fetch(`${API_URL}/api/confirm-donation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: currentUser.email,
                username: currentUser.username,
                amount: parseFloat(amount)
              })
            });
          } catch (error) {
            console.error('Failed to send donation confirmation email:', error);
          }
        }
      };
      confirmDonation();
      
      // Clear URL parameters
      setTimeout(() => {
        navigate('/donate', { replace: true });
      }, 100);
      
      // Auto-hide thank you message after 10 seconds
      setTimeout(() => {
        setShowThankYou(false);
      }, 10000);
    }
  }, [location, navigate, currentUser]);

  const handleAmountSelect = (amount) => {
    setSelectedAmount(amount);
    setCustomAmount(amount.toString());
  };

  const handleCustomAmountChange = (e) => {
    const value = e.target.value;
    if (value === "" || /^\d+(\.\d{0,2})?$/.test(value)) {
      setCustomAmount(value);
      setSelectedAmount(null);
    }
  };

  const getAmount = () => {
    return selectedAmount || parseFloat(customAmount) || 0;
  };

  const handleStripePayment = async () => {
    const amount = getAmount();
    if (!amount || amount <= 0) {
      alert("Please select or enter a valid donation amount");
      return;
    }

    if (!process.env.REACT_APP_STRIPE_PUBLIC_KEY) {
      alert("Stripe is not configured. Please add REACT_APP_STRIPE_PUBLIC_KEY to your .env file");
      return;
    }

    setIsProcessing(true);
    
    try {
      // Call backend to create Stripe checkout session
      const API_URL = process.env.REACT_APP_API_URL;
      const response = await fetch(`${API_URL}/api/create-stripe-checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }
      
      const { url } = await response.json();
      
      // Redirect directly to Stripe Checkout URL
      window.location.href = url;
    } catch (error) {
      console.error('Payment error:', error);
      alert('Payment setup failed. Make sure the backend endpoint /api/create-stripe-checkout is configured.');
      setIsProcessing(false);
    }
  };

  const handlePayPalPayment = () => {
    const amount = getAmount();
    if (!amount || amount <= 0) {
      alert("Please select or enter a valid donation amount");
      return;
    }

    if (!process.env.REACT_APP_PAYPAL_CLIENT_ID) {
      alert("PayPal is not configured. Please add REACT_APP_PAYPAL_CLIENT_ID to your .env file");
      return;
    }

    setIsProcessing(true);
    
    // Check if PayPal SDK is loaded
    if (!window.paypal) {
      alert("PayPal SDK not loaded. Please refresh the page and try again.");
      setIsProcessing(false);
      return;
    }

    // Render PayPal button dynamically
    const paypalContainer = document.getElementById('paypal-button-container');
    if (paypalContainer) {
      paypalContainer.innerHTML = '';
      
      window.paypal.Buttons({
        createOrder: (data, actions) => {
          return actions.order.create({
            purchase_units: [{
              description: 'Squarestrat Donation',
              amount: {
                currency_code: 'USD',
                value: amount.toFixed(2)
              }
            }]
          });
        },
        onApprove: async (data, actions) => {
          const details = await actions.order.capture();
          console.log('PayPal payment successful:', details);
          window.location.href = `/donate?success=true&amount=${amount}&method=paypal`;
        },
        onCancel: () => {
          setIsProcessing(false);
          alert('Payment cancelled');
        },
        onError: (err) => {
          console.error('PayPal error:', err);
          setIsProcessing(false);
          alert('Payment failed. Please try again.');
        }
      }).render('#paypal-button-container');
    }
  };

  if (showThankYou) {
    return (
      <div className={styles.donateContainer}>
        <div className={styles.donateContent}>
          <div className={styles.thankYouPage}>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.thankYouTitle}>Thank You for Your Support! 🎉</h1>
            <p className={styles.thankYouAmount}>
              Your donation of <strong>${donationAmount.toFixed(2)}</strong> has been received
            </p>
            <p className={styles.thankYouMessage}>
              Your generosity helps keep Squarestrat running and enables us to continue 
              developing new features for the community. We truly appreciate your support!
            </p>
            {currentUser && (
              <p className={styles.thankYouUser}>
                Thank you, <strong>{currentUser.username}</strong>!
              </p>
            )}
            <div className={styles.thankYouActions}>
              <StandardButton
                buttonText="Return to Donate Page"
                onClick={() => setShowThankYou(false)}
              />
              <StandardButton
                buttonText="Go to Home"
                onClick={() => navigate('/')}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.donateContainer}>
      <div className={styles.donateContent}>
        <h1 className={styles.title}>Support Squarestrat</h1>
        
        <Divider />

        <div className={styles.description}>
          <p>
            Squarestrat is a passion project dedicated to bringing creative chess variants 
            to players around the world. Your support helps us maintain servers, develop 
            new features, and keep the platform free for everyone.
          </p>
          <p>
            Every contribution, no matter how small, makes a difference and is greatly appreciated!
          </p>
        </div>

        <Divider />

        <div className={styles.donationSection}>
            <h2 className={styles.sectionTitle}>Choose Your Contribution</h2>
            
            <div className={styles.amountButtons}>
              {predefinedAmounts.map((amount) => (
                <button
                  key={amount}
                  className={`${styles.amountButton} ${selectedAmount === amount ? styles.selected : ''}`}
                  onClick={() => handleAmountSelect(amount)}
                >
                  ${amount}
                </button>
              ))}
            </div>

            <div className={styles.customAmount}>
              <label className={styles.customLabel}>Or enter a custom amount:</label>
              <div className={styles.customInput}>
                <span className={styles.dollarSign}>$</span>
                <input
                  type="text"
                  value={customAmount}
                  onChange={handleCustomAmountChange}
                  placeholder="0.00"
                  className={styles.amountInput}
                />
              </div>
            </div>

            <div className={styles.paymentMethods}>
              <h3 className={styles.paymentMethodsTitle}>Select Payment Method</h3>
              
              <div className={styles.paymentButtons}>
                <button
                  className={`${styles.paymentButton} ${styles.stripeButton}`}
                  onClick={handleStripePayment}
                  disabled={isProcessing}
                >
                  <span className={styles.paymentIcon}>💳</span>
                  <span>Pay with Stripe</span>
                  <span className={styles.paymentSubtext}>Credit/Debit Card</span>
                </button>

                <button
                  className={`${styles.paymentButton} ${styles.paypalButton}`}
                  onClick={handlePayPalPayment}
                  disabled={isProcessing}
                >
                  <span className={styles.paymentIcon}>P</span>
                  <span>Pay with PayPal</span>
                  <span className={styles.paymentSubtext}>PayPal Account</span>
                </button>
              </div>

              {/* PayPal button will be rendered here when clicked */}
              <div id="paypal-button-container" className={styles.paypalButtonContainer}></div>

              {isProcessing && (
                <p className={styles.processingMessage}>Processing your request...</p>
              )}
            </div>

            <div className={styles.paymentNote}>
              <p className={styles.secureNote}>
                🔒 All payments are processed securely through industry-leading payment providers
              </p>
              {(!process.env.REACT_APP_STRIPE_PUBLIC_KEY || !process.env.REACT_APP_PAYPAL_CLIENT_ID) && (
                <p className={styles.note}>
                  <em>⚠️ Payment keys not configured. Add your API keys to .env to enable payments.</em>
                </p>
              )}
            </div>
        </div>

        <Divider />

        <div className={styles.donorBadgesInfo}>
          <h2 className={styles.sectionTitle}>Donor Recognition Badges</h2>
          <p className={styles.badgeDescription}>
            Show your support for Squarestrat! Donors receive special badges displayed on their profiles:
          </p>
          <div className={styles.badgeTiers}>
            <div className={styles.badgeTier}>
              <span className={styles.badgeIcon}>✦</span>
              <div className={styles.badgeTierInfo}>
                <h3 className={styles.silverBadge}>Silver Supporter</h3>
                <p>Awarded for total donations of $5 - $49.99</p>
              </div>
            </div>
            <div className={styles.badgeTier}>
              <span className={styles.badgeIcon}>⭐</span>
              <div className={styles.badgeTierInfo}>
                <h3 className={styles.goldBadge}>Gold Supporter</h3>
                <p>Awarded for total donations of $50 or more</p>
              </div>
            </div>
          </div>
          <p className={styles.badgeNote}>
            Badges are automatically awarded based on your cumulative donation total and will be visible on your profile page to all users.
          </p>
        </div>

        <Divider />

        <div className={styles.alternativeSupport}>
            <h2 className={styles.sectionTitle}>Other Ways to Support</h2>
            <ul className={styles.supportList}>
              <li>Share Squarestrat with your friends and chess communities</li>
              <li>Create and share your own unique chess variants</li>
              <li>Provide feedback and suggestions for improvement</li>
              <li>Report bugs and help us make the platform better</li>
              <li>Contribute to discussions in our forums</li>
            </ul>
        </div>

        {currentUser && (
          <div className={styles.thankYou}>
            <p>Thank you for being part of the Squarestrat community, {currentUser.username}! 🎉</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Donate;
