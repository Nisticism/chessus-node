-- Migration: Add friend request approval system
-- Description: Adds status column to friends table to support pending friend requests

-- Add status column with enum values
ALTER TABLE friends ADD COLUMN status ENUM('pending', 'accepted', 'declined') DEFAULT 'accepted' AFTER friend_id;

-- Index for efficient status queries
CREATE INDEX idx_friends_status ON friends (status);

-- Note: Existing friendships will have status 'accepted' by default
