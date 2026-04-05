-- Add parent_id column to comments table for threaded replies
ALTER TABLE comments ADD COLUMN parent_id INT DEFAULT NULL;
ALTER TABLE comments ADD CONSTRAINT fk_comment_parent FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE;
