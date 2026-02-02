-- Update role enum to include 'owner' and set Nisticism as owner
-- First, modify the role column to allow 'owner' value
ALTER TABLE users MODIFY COLUMN role ENUM('user', 'admin', 'owner') DEFAULT 'user';

-- Set Nisticism as the owner
UPDATE users SET role = 'owner' WHERE username = 'Nisticism';
