-- Add ban system columns to users table
ALTER TABLE users
ADD COLUMN banned TINYINT(1) DEFAULT 0 COMMENT 'Whether user is banned',
ADD COLUMN ban_reason TEXT DEFAULT NULL COMMENT 'Reason for ban',
ADD COLUMN banned_at DATETIME DEFAULT NULL COMMENT 'When user was banned',
ADD COLUMN banned_by INT DEFAULT NULL COMMENT 'User ID of admin/owner who banned',
ADD COLUMN ban_expires_at DATETIME DEFAULT NULL COMMENT 'When ban expires (NULL for permanent)',
ADD INDEX idx_banned (banned),
ADD INDEX idx_ban_expires (ban_expires_at);
