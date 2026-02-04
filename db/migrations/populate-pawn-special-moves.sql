-- Populate special_scenario_moves for pawns to enable 2-square first move
-- Pawns move 1 square forward normally, but can move 2 squares on their first move

UPDATE pieces 
SET special_scenario_moves = '{"additionalMovements":{"up":[{"value":2,"firstMoveOnly":true}],"down":[{"value":2,"firstMoveOnly":true}]}}'
WHERE name = 'Pawn' OR piece_name = 'Pawn';
