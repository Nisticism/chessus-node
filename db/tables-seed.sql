CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50),
    email VARCHAR(50),
    last_active_at DATETIME
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

CREATE TABLE comments IF NOT EXISTS (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content VARCHAR(1000) NOT NULL,
    created_at DATETIME,
    FOREIGN KEY author_id
      REFERENCES users(id),
    FOREIGN KEY article_id
      REFERENCES articles(id)
);