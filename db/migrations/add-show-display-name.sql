-- Add show_display_name column to users table
-- When true, first_name and last_name are visible to other users on the profile page

ALTER TABLE chessusnode.users ADD COLUMN show_display_name TINYINT(1) NOT NULL DEFAULT 0;
