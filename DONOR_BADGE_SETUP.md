# Donor Badge System Setup

## Database Migration Required

Run this SQL command in your MySQL database to add the `total_donations` column:

```sql
ALTER TABLE users ADD COLUMN total_donations DECIMAL(10, 2) DEFAULT 0.00;
UPDATE users SET total_donations = 0.00 WHERE total_donations IS NULL;
```

### How to run:

**Option 1: MySQL Workbench or phpMyAdmin**
1. Open your database management tool
2. Select the `chessusnode` database
3. Run the SQL commands above

**Option 2: Command Line**
```bash
mysql -u your_username -p chessusnode < db/add-total-donations.sql
```

**Option 3: From your application**
The migration file is located at: `db/add-total-donations.sql`

## How It Works

### Database
- New column `total_donations` tracks cumulative donation amounts per user
- Updated automatically when donations are confirmed via `/api/confirm-donation`

### Badge Tiers
- **Silver Supporter** (✦): $5.00 - $49.99 total donations
- **Gold Supporter** (⭐): $50.00+ total donations
- No badge shown for donations under $5

### Frontend
- Badge logic in `DonorBadge` component determines tier based on `total_donations` value
- Badges display on user profiles next to role badge
- Hover over badge to see exact donation total
- Responsive design works on mobile and desktop

### Donation Flow
1. User completes payment (Stripe/PayPal)
2. Frontend calls `/api/confirm-donation` with email and amount
3. Backend updates user's `total_donations` in database
4. Backend sends thank you email (if SendGrid configured)
5. User's profile automatically shows appropriate badge

## Testing

After running the migration:
1. Make a test donation (use Stripe test card: 4242 4242 4242 4242)
2. Check your profile - you should see a badge appear
3. Make additional donations to test badge tier upgrades
4. Total donations accumulate across all donations

## Features

✅ Two badge tiers (Silver and Gold)
✅ Automatic badge assignment based on total donations
✅ Badges displayed on user profiles
✅ Beautiful gradient styling matching site theme
✅ Explanation on donation page
✅ Responsive design
✅ Hover tooltips show exact amount
✅ Database tracking of cumulative donations

