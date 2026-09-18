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
import axios from "axios";
import API_URL from "../../global/global";

/*
 * What to show before the server has answered.
 *
 * The real numbers come from /api/supporter-perks, which reads the same
 * site_settings rows the game limiter applies - the limits are editable from
 * the admin dashboard, so a page with them written in would start lying the
 * first time anyone moved one. These are the defaults that endpoint falls back
 * to, kept here only so the section is never blank while the request is out.
 */
const PERK_FALLBACK = {
  silverMinDonation: 5,
  goldMinDonation: 50,
  freePuzzlesPerGame: 3,
  dailyPuzzleCap: 20,
  gameLimits: {
    free: { live: 4, correspondence: 12 },
    silver: { live: 10, correspondence: 40 },
    gold: { live: 16, correspondence: 80 },
  },
};

const Donate = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [qrModal, setQrModal] = useState(null); // 'cashapp' | 'venmo' | null
  // The perk list, from the server. See PERK_FALLBACK above.
  const [perks, setPerks] = useState(PERK_FALLBACK);
  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}supporter-perks`)
      .then(({ data }) => { if (!cancelled && data?.gameLimits) setPerks(data); })
      .catch(() => { /* the fallback is already on screen */ });
    return () => { cancelled = true; };
  }, []);
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
            to players around the world. Your support helps us maintain servers and
            develop new features.
          </p>
          <p>
            Designing games and pieces, playing them, and solving puzzles stay open to
            everyone. Supporting the site lifts the limits that keep the servers
            affordable, and adds a handful of things that cost us something to run.
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

        {/*
          * What a supporter actually gets.
          *
          * Written from the checks that enforce them rather than from memory -
          * the numbers here are the ones in server/index.js and the game_limit_*
          * site settings, and Gold is described as Silver plus its differences
          * because that is exactly what it is in the code: the same predicates
          * with a higher threshold.
          */}
        <div className={styles.donorBadgesInfo}>
          <h2 className={styles.sectionTitle}>What Supporters Get</h2>
          <p className={styles.badgeDescription}>
            Cumulative, and permanent — your total is what counts, so it can be
            reached a few dollars at a time.
          </p>

          <div className={styles.perkTiers}>
            <div className={styles.perkTier}>
              <h3 className={styles.silverBadge}>✦ Silver Supporter — ${perks.silverMinDonation}+</h3>
              <ul className={styles.perkList}>
                <li>
                  <strong>Build as many puzzles as you like.</strong> Everyone can build
                  {' '}{perks.freePuzzlesPerGame} puzzles per game; Silver removes that cap,
                  leaving only the {perks.dailyPuzzleCap}-a-day ceiling that keeps scripts
                  off the list. Solving puzzles is free for everyone, always.
                </li>
                <li>
                  <strong>More games at once.</strong> {perks.gameLimits.silver.live} live games and
                  {' '}{perks.gameLimits.silver.correspondence} correspondence, up from {perks.gameLimits.free.live} and
                  {' '}{perks.gameLimits.free.correspondence}.
                </li>
                <li>
                  <strong>Your own board colours.</strong> Pick the light and dark squares
                  yourself instead of choosing from the built-in themes.
                </li>
                <li>
                  <strong>Custom piece sounds.</strong> Give a piece its own move, capture
                  and hit sounds.
                </li>
                <li>
                  <strong>The Silver badge</strong> on your profile, which you can hide at
                  any time.
                </li>
              </ul>
            </div>

            <div className={styles.perkTier}>
              <h3 className={styles.goldBadge}>⭐ Gold Supporter — ${perks.goldMinDonation}+</h3>
              <ul className={styles.perkList}>
                <li>
                  <strong>Everything Silver Supporters get</strong>, plus:
                </li>
                <li>
                  <strong>No puzzle limit at all.</strong> Not even the
                  {' '}{perks.dailyPuzzleCap}-a-day one. Build as many as you want, whenever
                  you want.
                </li>
                <li>
                  <strong>More games again.</strong> {perks.gameLimits.gold.live} live games and
                  {' '}{perks.gameLimits.gold.correspondence} correspondence — {perks.gameLimits.gold.live - perks.gameLimits.silver.live} and
                  {' '}{perks.gameLimits.gold.correspondence - perks.gameLimits.silver.correspondence} more than Silver.
                </li>
                <li>
                  <strong>The Gold badge</strong> on your profile in place of the Silver one.
                </li>
              </ul>
            </div>
          </div>

          <p className={styles.badgeNote}>
            Tiers are awarded automatically from your cumulative donation total. You can
            donate anonymously above, or hide your badge at any time from your{' '}
            <a href="/preferences">preferences</a>. Admins and owners have every supporter
            perk without donating.
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
