SELECT * FROM chessusnode.users;

CREATE TABLE chessusnode.`likes` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `article_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `liked` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_likes_users_user_id` (`user_id`),
  KEY `fk_likes_articles_article_id` (`article_id`),
  CONSTRAINT `fk_likes_articles_article_id` FOREIGN KEY (`article_id`) REFERENCES `articles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_likes_users_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=41 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SELECT * FROM likes;

SELECT * FROM articles;

INSERT INTO users VALUES (
'1',
'Hans', 
'Foster', 
'Nisticism', 
'fosterhans@gmail.com', 
'password', 
'Admin', 
null, 
'206-822-2274');

DELETE FROM users WHERE id=1;

DELETE FROM users WHERE username = 'NewAccount8';

UPDATE users SET role = "Admin" WHERE id=31;
UPDATE users SET id=1 WHERE id=31;

ALTER TABLE users ADD timezone varchar(30) AFTER last_active_at;
ALTER TABLE users ADD lang varchar(30) AFTER timezone;
ALTER TABLE users ADD country varchar(30) AFTER lang;
ALTER TABLE users ADD bio varchar(500) AFTER country;

ALTER TABLE users DROP phone;

ALTER TABLE articles ADD last_updated_at datetime AFTER created_at;

SELECT * from games;
SELECT * from users;
SELECT * from likes;
SELECT * from articles;
SELECT * from pieces;
SELECT * from players;

INSERT INTO users VALUES (
'2',
'aoeu', 
'aoeu', 
'testing1', 
'testing@gmail.com', 
'password', 
'Pleb', 
null, 
null,
null,
null,
null);
-- Add color preference columns to users table
ALTER TABLE users ADD COLUMN light_square_color VARCHAR(20) DEFAULT '#cad5e8' AFTER bio;
ALTER TABLE users ADD COLUMN dark_square_color VARCHAR(20) DEFAULT '#08234d' AFTER light_square_color;
