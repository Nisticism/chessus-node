import React, { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import styles from "./donate.module.scss";
import Divider from "../Divider/Divider";
import ToggleSwitch from "../common/ToggleSwitch";
import StandardButton from "../standardbutton/StandardButton";
import { trackDonation } from "../../analytics/GoogleAnalytics";
import cashappQR from "../../assets/cashapp-qr.png";
import venmoQR from "../../assets/venmo-qr.png";

const Donate = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [qrModal, setQrModal] = useState(null); // 'cashapp' | 'venmo' | null
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [customAmount, setCustomAmount] = useState("");
  const [showThankYou, setShowThankYou] = useState(false);
  const [donationAmount, setDonationAmount] = useState(0);
  const [, setPaymentMethod] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPayPalLoaded, setIsPayPalLoaded] = useState(false);
  const [donateAnonymously, setDonateAnonymously] = useState(false);
  
  const location = useLocation();
  const navigate = useNavigate();

  const predefinedAmounts = [5, 10, 25, 50, 100];

  // Save anonymous donation preference if checked
  const saveAnonymousPreference = async () => {
    if (donateAnonymously && currentUser) {
      try {
        const API_URL = process.env.REACT_APP_API_URL;
        await fetch(`${API_URL}/api/preferences/colors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: currentUser.id,
            hide_donation_badge: true,
          })
        });
        // Update localStorage
        const updatedUser = { ...currentUser, hide_donation_badge: 1 };
        localStorage.setItem("user", JSON.stringify(updatedUser));
      } catch (error) {
        console.error('Failed to save anonymous preference:', error);
      }
    }
  };

  // Check for success parameter in URL
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const success = params.get('success');
    const amount = params.get('amount');
    const method = params.get('method');
    const sessionId = params.get('session_id');
    
    if (success === 'true' && amount) {
      setShowThankYou(true);
      setDonationAmount(parseFloat(amount));
      setPaymentMethod(method || 'payment');
      
      // Track successful donation
      trackDonation(parseFloat(amount));
      
      // Stripe: confirm the donation server-side using the checkout session id.
      // The server verifies the session directly with Stripe and credits it. This is
      // a fallback for the Stripe webhook and is deduped against it, so the donation
      // is recorded reliably whether or not the webhook fires. PayPal donations are
      // already recorded in the PayPal onApprove handler, so they need nothing here.
      if (method === 'stripe' && sessionId) {
        const confirmStripeDonation = async () => {
          try {
            const API_URL = process.env.REACT_APP_API_URL;
            await fetch(`${API_URL}/api/confirm-stripe-donation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sessionId })
            });
          } catch (error) {
            console.error('Failed to confirm Stripe donation:', error);
          }
        };
        confirmStripeDonation();
      }
      
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

  // Load PayPal SDK dynamically when component mounts
  useEffect(() => {
    const loadPayPalScript = () => {
      // Check if already loaded
      if (window.paypal) {
        setIsPayPalLoaded(true);
        return;
      }

      const clientId = process.env.REACT_APP_PAYPAL_CLIENT_ID;
      if (!clientId || clientId === 'YOUR_PAYPAL_CLIENT_ID') {
        console.log('PayPal client ID not configured');
        return;
      }

      // Check if script already exists
      const existingScript = document.querySelector('script[src*="paypal.com/sdk"]');
      if (existingScript) {
        setIsPayPalLoaded(true);
        return;
      }

      // Create and load PayPal script
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`;
      script.async = true;
      script.onload = () => setIsPayPalLoaded(true);
      script.onerror = () => console.error('Failed to load PayPal SDK');
      document.head.appendChild(script);
    };

    loadPayPalScript();
  }, []);

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
        body: JSON.stringify({
          amount,
          email: currentUser?.email,
          username: currentUser?.username,
          userId: currentUser?.id,
          hideBadge: !!(donateAnonymously && currentUser),
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to create checkout session');
      }
      
      const { url } = await response.json();
      
      // Save anonymous preference before redirecting to Stripe
      await saveAnonymousPreference();
      
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
    if (!window.paypal || !isPayPalLoaded) {
      alert("PayPal is still loading. Please wait a moment and try again.");
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
              description: 'GridGrove Donation',
              // Carry attribution so the PayPal webhook can credit the right account.
              // Format: userId|hideBadge
              custom_id: `${currentUser?.id || ''}|${donateAnonymously && currentUser ? '1' : '0'}`,
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
          await saveAnonymousPreference();
          // Record the donation server-side (idempotent; deduped against the PayPal
          // webhook via the capture id). The server re-verifies the order with PayPal
          // when server credentials are configured.
          try {
            const capture = details?.purchase_units?.[0]?.payments?.captures?.[0];
            const API_URL = process.env.REACT_APP_API_URL;
            await fetch(`${API_URL}/api/record-paypal-donation`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: data.orderID,
                captureId: capture?.id,
                amount,
                email: currentUser?.email || details?.payer?.email_address,
                username: currentUser?.username,
                userId: currentUser?.id,
                hideBadge: !!(donateAnonymously && currentUser),
              })
            });
          } catch (recErr) {
            console.error('Failed to record PayPal donation:', recErr);
          }
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
              Your generosity helps keep GridGrove running and enables us to continue 
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
        <h1 className={styles.title}>Support GridGrove</h1>
        
        <Divider />

        <div className={styles.description}>
          <p>
            GridGrove is a passion project dedicated to bringing creative chess variants 
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

              {currentUser && (
                <div className={styles.anonymousOption}>
                  <ToggleSwitch
                    checked={donateAnonymously}
                    onChange={(v) => setDonateAnonymously(v)}
                    label="Donate anonymously (hide my donor badge from my profile)"
                  />
                </div>
              )}
              
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
                🔒 Donations are processed securely. We never see or store your payment details — card, PayPal, Venmo, and Cash App information stays with the payment provider.
              </p>
              {(!process.env.REACT_APP_STRIPE_PUBLIC_KEY || !process.env.REACT_APP_PAYPAL_CLIENT_ID) && (
                <p className={styles.note}>
                  <em>⚠️ Payment keys not configured. Add your API keys to .env to enable payments.</em>
                </p>
              )}
            </div>

            {/* Other ways to give: Venmo + Cash App */}
            <div className={styles.altPayments}>
              <h3 className={styles.altPaymentsTitle}>Other Ways to Give</h3>
              <p className={styles.altPaymentsHint}>
                Prefer to send directly? Use Venmo or Cash App. Tap a card to view the QR code, or use the link below it.
              </p>
              <p className={styles.altPaymentsManualNote}>
                Note: Venmo and Cash App don’t expose a public payment-confirmation API, so donor badges from these methods
                are awarded as soon as we can manually verify your payment. Badges are based on the amount you sent (not the
                amount we receive after processor fees). If your badge hasn’t shown up within a day or two, please reach out
                to support and we’ll get it sorted.
              </p>
              <div className={styles.altPaymentsGrid}>
                <div
                  className={`${styles.altPaymentCard} ${styles.venmoCard}`}
                  onClick={() => setQrModal('venmo')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setQrModal('venmo'); }}
                  aria-label="Show Venmo QR code"
                >
                  <div className={styles.altPaymentLogo} aria-hidden="true">V</div>
                  <div className={styles.altPaymentBody}>
                    <div className={styles.altPaymentName}>Venmo</div>
                    <div className={styles.altPaymentHandle}>@GridGrove</div>
                    <div className={styles.altPaymentTapHint}>Tap to show QR code</div>
                  </div>
                  <a
                    href="https://www.venmo.com/u/GridGrove"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.altPaymentLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open Venmo ↗
                  </a>
                </div>

                <div
                  className={`${styles.altPaymentCard} ${styles.cashappCard}`}
                  onClick={() => setQrModal('cashapp')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setQrModal('cashapp'); }}
                  aria-label="Show Cash App QR code"
                >
                  <div className={styles.altPaymentLogo} aria-hidden="true">$</div>
                  <div className={styles.altPaymentBody}>
                    <div className={styles.altPaymentName}>Cash App</div>
                    <div className={styles.altPaymentHandle}>$GridGrove</div>
                    <div className={styles.altPaymentTapHint}>Tap to show QR code</div>
                  </div>
                  <a
                    href="https://cash.app/$gridgrove"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.altPaymentLink}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open Cash App ↗
                  </a>
                </div>
              </div>
            </div>

            {qrModal && (
              <div className={styles.qrModalOverlay} onClick={() => setQrModal(null)}>
                <div className={styles.qrModalContent} onClick={(e) => e.stopPropagation()}>
                  <button
                    className={styles.qrModalClose}
                    onClick={() => setQrModal(null)}
                    aria-label="Close QR code"
                  >✕</button>
                  <h3 className={styles.qrModalTitle}>
                    {qrModal === 'venmo' ? 'Venmo — @GridGrove' : 'Cash App — $GridGrove'}
                  </h3>
                  <img
                    src={qrModal === 'venmo' ? venmoQR : cashappQR}
                    alt={qrModal === 'venmo' ? 'Venmo QR code for @GridGrove' : 'Cash App QR code for $GridGrove'}
                    className={styles.qrModalImage}
                  />
                  <p className={styles.qrModalHint}>
                    Scan with your {qrModal === 'venmo' ? 'Venmo' : 'Cash App'} app, or use the link below.
                  </p>
                  <a
                    href={qrModal === 'venmo' ? 'https://www.venmo.com/u/GridGrove' : 'https://cash.app/$gridgrove'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.qrModalLink}
                  >
                    {qrModal === 'venmo' ? 'https://www.venmo.com/u/GridGrove' : 'https://cash.app/$gridgrove'}
                  </a>
                </div>
              </div>
            )}
        </div>

        <Divider />

        <div className={styles.donorBadgesInfo}>
          <h2 className={styles.sectionTitle}>Donor Recognition Badges</h2>
          <p className={styles.badgeDescription}>
            Show your support for GridGrove! Donors receive special badges displayed on their profiles:
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
            Badges are automatically awarded based on your cumulative donation total and will be visible on your profile page.
            You can choose to donate anonymously above, or hide your badge at any time from your <a href="/preferences">preferences</a>.
          </p>
        </div>

        <Divider />

        <div className={styles.alternativeSupport}>
            <h2 className={styles.sectionTitle}>Other Ways to Support</h2>
            <ul className={styles.supportList}>
              <li>Share GridGrove with your friends and chess communities</li>
              <li>Create and share your own unique chess variants</li>
              <li>Provide feedback and suggestions for improvement</li>
              <li>Report bugs and help us make the platform better</li>
              <li>Contribute to discussions in our forums</li>
            </ul>
        </div>

        {currentUser && (
          <div className={styles.thankYou}>
            <p>Thank you for being part of the GridGrove community, {currentUser.username}! 🎉</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Donate;
