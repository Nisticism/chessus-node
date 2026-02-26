-- Migration: Create streams table for live streams and videos
-- This table stores stream/video information that admins can manage

CREATE TABLE IF NOT EXISTS streams (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    streamer_name VARCHAR(100) NOT NULL,
    description TEXT,
    stream_url VARCHAR(500) NOT NULL,
    thumbnail_url VARCHAR(500),
    category ENUM('tournament', 'tutorial', 'casual', 'community', 'other') DEFAULT 'other',
    platform ENUM('twitch', 'youtube', 'kick', 'other') DEFAULT 'other',
    is_live BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    viewer_count INT DEFAULT 0,
    game_name VARCHAR(100),
    created_by INT UNSIGNED,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    scheduled_start DATETIME,
    scheduled_end DATETIME,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Index for fetching live streams
CREATE INDEX idx_streams_is_live ON streams(is_live);

-- Index for category filtering
CREATE INDEX idx_streams_category ON streams(category);

-- Index for featured streams
CREATE INDEX idx_streams_featured ON streams(is_featured);
