-- Add is_career flag to articles table for job postings

ALTER TABLE articles 
ADD COLUMN is_career TINYINT(1) DEFAULT 0 
COMMENT 'Flag to indicate if article is a job posting' 
AFTER is_news;
