import React, { useState } from "react";
import { useSelector } from "react-redux";
import styles from "./donate.module.scss";
import Divider from "../Divider/Divider";
import StandardButton from "../standardbutton/StardardButton";

const Donate = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const [selectedAmount, setSelectedAmount] = useState(null);
  const [customAmount, setCustomAmount] = useState("");

  const predefinedAmounts = [5, 10, 25, 50, 100];

  const handleAmountSelect = (amount) => {
    setSelectedAmount(amount);
    setCustomAmount("");
  };

  const handleCustomAmountChange = (e) => {
    const value = e.target.value;
    if (value === "" || /^\d+(\.\d{0,2})?$/.test(value)) {
      setCustomAmount(value);
      setSelectedAmount(null);
    }
  };

  const handleDonate = () => {
    const amount = selectedAmount || parseFloat(customAmount);
    if (!amount || amount <= 0) {
      alert("Please select or enter a valid donation amount");
      return;
    }
    // TODO: Integrate payment processing here
    alert(`Payment integration coming soon! Selected amount: $${amount}`);
  };

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

            <div className={styles.donateButton}>
              <StandardButton
                buttonText="Continue to Payment"
                onClick={handleDonate}
              />
            </div>

            <div className={styles.paymentNote}>
              <p className={styles.note}>
                <em>Payment integration coming soon. We'll be adding secure payment 
                processing through trusted providers.</em>
              </p>
            </div>
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
