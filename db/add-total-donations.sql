-- Add total_donations column to users table
ALTER TABLE users ADD COLUMN total_donations DECIMAL(10, 2) DEFAULT 0.00;

-- Update existing users to have 0.00 as default
UPDATE users SET total_donations = 0.00 WHERE total_donations IS NULL;
