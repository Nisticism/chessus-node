-- Add password reset columns to users table
ALTER TABLE users 
ADD COLUMN password_reset_token VARCHAR(100) DEFAULT NULL,
ADD COLUMN password_reset_expires DATETIME DEFAULT NULL;

-- Add index for faster token lookups
CREATE INDEX idx_users_password_reset_token ON users(password_reset_token);
