CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50),
    last_name VARCHAR(50),
    username VARCHAR(50) NOT NULL,
    email VARCHAR(50),
    password VARCHAR(100),
    role VARCHAR(20),
    last_active_at DATETIME,
    timezone VARCHAR(30),
    lang VARCHAR(30),
    country VARCHAR(30),
    bio VARCHAR(500),
    light_square_color VARCHAR(20) DEFAULT '#cad5e8',
    dark_square_color VARCHAR(20) DEFAULT '#08234d',
    elo INT DEFAULT 1000,
    profile_picture VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS game_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    creator_id INT UNSIGNED,
    article_id INT UNSIGNED,
    game_name VARCHAR(50) NOT NULL,
    descript VARCHAR(8000) NOT NULL,
    rules VARCHAR(8000) NOT NULL,
    mate_condition BOOLEAN,
    mate_piece INT,
    capture_condition BOOLEAN,
    capture_piece INT,
    value_condition BOOLEAN,
    value_piece INT,
    value_max INT,
    value_title VARCHAR(50),
    squares_condition BOOLEAN,
    squares_count BOOLEAN,
    hill_condition BOOLEAN,
    hill_x INT,
    hill_y INT,
    hill_turns INT,
    actions_per_turn INT,
    range_squares_string VARCHAR(1000),
    promotion_squares_string VARCHAR(1000),
    special_squares_string VARCHAR(1000),
    randomized_starting_positions VARCHAR(1000),
    other_game_data MEDIUMTEXT,
    optional_condition INT,
    board_width INT,
    board_height INT,
    player_count INT DEFAULT 2,
    starting_piece_count INT,
    pieces_string VARCHAR(8000) NOT NULL,
    last_played_at DATETIME,
    FOREIGN KEY (creator_id)
      REFERENCES users(id),
    FOREIGN KEY (article_id)
      REFERENCES articles(id)
);

-- increase size of game type name and pieces string

CREATE TABLE IF NOT EXISTS games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL,
    start_time DATETIME,
    end_time DATETIME,
    increment INT,
    turn_length INT,
    player_turn INT,
    player_count INT,
    game_length INT,
    game_turn_length INT,
    randomized_starting_positions VARCHAR(1000),
    --  other piece data can be stored here (has the piece been move/how many times)
    pieces VARCHAR(8000),
    other_data VARCHAR(800),
    FOREIGN KEY game_type_id
      REFERENCES game_types(id)
);

CREATE TABLE IF NOT EXISTS players (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL,
    turn_length INT,
    player_position INT,
    piece_count INT,
    time_remaining INT,
    value_remaining INT,
    points INT,
    FOREIGN KEY game_type_id
      REFERENCES game_types(id),
    FOREIGN KEY game_id
      REFERENCES games(id),
    FOREIGN KEY user_id
      REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pieces (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    piece_name VARCHAR(50) NOT NULL,
    piece_description VARCHAR(1000),
    piece_category VARCHAR(50),
    -- Directional movement.  Positive number or 0 = move exactly that many squares.  Negative number = up to that many squares
    -- Null = infinitely many squares
    directional_movement_style BOOLEAN,
    repeating_movement BOOLEAN,
    max_directional_movement_iterations INT,
    min_directional_movement_iterations INT,
    up_left_movement INT,
    up_movement INT,
    up_right_movement INT,
    right_movement INT,
    down_right_movement INT,
    down_movement INT,
    down_left_movement INT,
    left_movement INT,
    -- Ratio movement.  ratio_one_movement is a move in any direction, so long as ratio_two_movement goes in the perpendicular direction.
    -- Positive number or 0 = move exactly that many squares.  Negative number = up to that many squares.  Null = infinitely many squares
    ratio_movement_style BOOLEAN,
    ratio_one_movement INT,
    ratio_two_movement INT,
    repeating_ratio BOOLEAN,
    max_ratio_iterations BOOLEAN,
    min_ratio_iterations BOOLEAN,
    -- Step by step movement.  Piece can move up to value in any direction and can change direction within single move.
    step_by_step_movement_style BOOLEAN,
    step_by_step_movement_value INT,
    --  Hop over other pieces
    can_hop_over_allies BOOLEAN,
    can_hop_over_enemies BOOLEAN,
    --  Attack types
    can_capture_enemy_via_range BOOLEAN,
    can_capture_ally_via_range BOOLEAN,
    can_capture_enemy_on_move BOOLEAN,
    can_capture_ally_on_range BOOLEAN,
    can_attack_on_iteration BOOLEAN,
    --  Directional ranged attack
    up_left_attack_range INT,
    up_attack_range INT,
    up_right_attack_range INT,
    right_attack_range INT,
    down_right_attack_range INT,
    down_attack_range INT,
    down_left_attack_range INT,
    left_attack_range INT,
    repeating_directional_ranged_attack BOOLEAN,
    max_directional_ranged_attack_iterations INT,
    min_directional_ranged_attack_iterations INT,
    --  Ratio ranged attack
    ratio_one_attack_range INT,
    ratio_two_attack_range INT,
    repeating_ratio_ranged_attack BOOLEAN,
    max_ratio_ranged_attack_iterations INT,
    min_ratio_ranged_attack_iterations INT,
    --  Step by step attack range.
    step_by_step_attack_style BOOLEAN,
    step_by_step_attack_value BOOLEAN,
    --  Piece captures per move
    max_piece_captures_per_move INT,
    max_piece_captures_per_ranged_attack INT,
    --  Turn based attack style for first moves and special moves or captures
    special_scenario_moves VARCHAR(1000),
    special_scenario_captures VARCHAR(1000),
    --  Misc
    has_checkmate_rule BOOLEAN,
    has_check_rule BOOLEAN,
    has_lose_on_capture_rule BOOLEAN,
    min_turns_per_move BOOLEAN,
    piece_width INT,
    piece_height INT,
    piece_images TEXT,
    --  Foreign keys
    FOREIGN KEY game_type_id
      REFERENCES game_types(id),
    FOREIGN KEY creator_id
      REFERENCES users(id),
    FOREIGN KEY game_id
      REFERENCES games(id),
    FOREIGN KEY player_id
      REFERENCES players(id)
);

CREATE TABLE articles (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(50) NOT NULL,
    descript VARCHAR(1000),
    content MEDIUMTEXT NOT NULL,
    created_at DATETIME,
    genre VARCHAR(50),
    public BOOLEAN,
    FOREIGN KEY author_id 
      REFERENCES users(id),
    FOREIGN KEY game_type_id
      REFERENCES game_types(id) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS piece_capture (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    piece_id INT UNSIGNED NOT NULL,
    -- Capture type flags
    can_capture_enemy_via_range TINYINT(1) DEFAULT NULL,
    can_capture_ally_via_range TINYINT(1) DEFAULT NULL,
    can_capture_enemy_on_move TINYINT(1) DEFAULT NULL,
    can_capture_ally_on_range TINYINT(1) DEFAULT NULL,
    can_attack_on_iteration TINYINT(1) DEFAULT NULL,
    -- Directional capture on move
    up_left_capture INT DEFAULT 0,
    up_capture INT DEFAULT 0,
    up_right_capture INT DEFAULT 0,
    right_capture INT DEFAULT 0,
    down_right_capture INT DEFAULT 0,
    down_capture INT DEFAULT 0,
    down_left_capture INT DEFAULT 0,
    left_capture INT DEFAULT 0,
    -- Ratio capture (L-shape)
    ratio_one_capture INT DEFAULT NULL,
    ratio_two_capture INT DEFAULT NULL,
    -- Step by step capture
    step_by_step_capture INT DEFAULT NULL,
    -- Directional ranged attack
    up_left_attack_range INT DEFAULT NULL,
    up_attack_range INT DEFAULT NULL,
    up_right_attack_range INT DEFAULT NULL,
    right_attack_range INT DEFAULT NULL,
    down_right_attack_range INT DEFAULT NULL,
    down_attack_range INT DEFAULT NULL,
    down_left_attack_range INT DEFAULT NULL,
    left_attack_range INT DEFAULT NULL,
    repeating_directional_ranged_attack TINYINT(1) DEFAULT NULL,
    max_directional_ranged_attack_iterations INT DEFAULT NULL,
    min_directional_ranged_attack_iterations INT DEFAULT NULL,
    -- Ratio ranged attack
    ratio_one_attack_range INT DEFAULT NULL,
    ratio_two_attack_range INT DEFAULT NULL,
    repeating_ratio_ranged_attack TINYINT(1) DEFAULT NULL,
    max_ratio_ranged_attack_iterations INT DEFAULT NULL,
    min_ratio_ranged_attack_iterations INT DEFAULT NULL,
    -- Step by step attack
    step_by_step_attack_style TINYINT(1) DEFAULT NULL,
    step_by_step_attack_value TINYINT(1) DEFAULT NULL,
    -- Max captures
    max_piece_captures_per_move INT DEFAULT NULL,
    max_piece_captures_per_ranged_attack INT DEFAULT NULL,
    -- Special scenarios
    special_scenario_captures VARCHAR(1000) DEFAULT NULL,
    FOREIGN KEY (piece_id)
      REFERENCES pieces(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content VARCHAR(1000) NOT NULL,
    created_at DATETIME,
    author_id INT,
    article_id INT,
    FOREIGN KEY (author_id) REFERENCES users(id),
    FOREIGN KEY (article_id) REFERENCES articles(id)
);