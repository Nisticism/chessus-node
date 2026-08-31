import React, { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useSelector, useDispatch } from "react-redux";
import axios from "../../services/axios-interceptor";
import { getPieceById, getGamesByPieceId, deletePiece, checkPieceDuplicates, setPieceValueCache } from "../../actions/pieces";
import PiecesService from "../../services/pieces.service";
import { estimatePieceValue } from "../../utils/pieceValueEstimator";
import PieceBoardPreview from "../piecewizard/PieceBoardPreview";
import InfoTooltip from "../piecewizard/InfoTooltip";
import Pagination from "../pagination/Pagination";
import styles from "./pieceview.module.scss";
import { parseServerDate } from "../../helpers/date-formatter";
import authHeader from "../../services/auth-header";
import { renderContent } from "../../helpers/render-content";

const EMPTY_PIECE_VALUE_CACHE = {};

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";
const API_URL = (process.env.REACT_APP_API_URL || "") + "/api/";

const PieceView = () => {
  const { pieceId } = useParams();
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();
  const pieceValueCache = useSelector((state) => state.pieces?.pieceValueCache || EMPTY_PIECE_VALUE_CACHE);
  const [piece, setPiece] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [imageBgColor, setImageBgColor] = useState('#6b6b6b'); // Default neutral gray
  const [gamesUsingPiece, setGamesUsingPiece] = useState([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesPage, setGamesPage] = useState(1);
  const [selectedPreviewImageUrl, setSelectedPreviewImageUrl] = useState(null);
  const GAMES_PER_PAGE = 10;

  // Creator options menu
  const [creatorMenuOpen, setCreatorMenuOpen] = useState(false);
  const creatorMenuRef = useRef(null);
  // Uniqueness check
  const [uniquenessCheckLoading, setUniquenessCheckLoading] = useState(false);
  const [uniquenessModalOpen, setUniquenessModalOpen] = useState(false);
  const [uniquenessMatches, setUniquenessMatches] = useState([]);
  const [uniquenessError, setUniquenessError] = useState('');
  // Piece comparer (sub-feature of the uniqueness checker)
  const [compareModalOpen, setCompareModalOpen] = useState(false);
  const [compareSearch, setCompareSearch] = useState('');
  const [compareResults, setCompareResults] = useState([]);
  const [compareSearchLoading, setCompareSearchLoading] = useState(false);
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareError, setCompareError] = useState('');
  const [compareTab, setCompareTab] = useState('differences');

  useEffect(() => {
    const loadPiece = async () => {
      try {
        setLoading(true);
        const pieceData = await getPieceById(pieceId);
        setPiece(pieceData);
        setLoading(false);
      } catch (err) {
        console.error("Error loading piece:", err);
        setError("Failed to load piece");
        setLoading(false);
      }
    };

    if (pieceId) {
      loadPiece();
    }
  }, [pieceId]);

  // Load games that use this piece
  useEffect(() => {
    const loadGames = async () => {
      try {
        setGamesLoading(true);
        const games = await getGamesByPieceId(pieceId);
        setGamesUsingPiece(games);
        setGamesLoading(false);
      } catch (err) {
        console.error("Error loading games for piece:", err);
        setGamesLoading(false);
      }
    };

    if (pieceId) {
      loadGames();
    }
  }, [pieceId]);

  // Analyze image brightness to determine background color
  useEffect(() => {
    if (!piece?.image_location) return;

    const firstImageUrl = getFirstImage(piece.image_location);
    if (!firstImageUrl) return;

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = firstImageUrl;
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        
        let totalBrightness = 0;
        let pixelCount = 0;
        
        // Sample pixels to calculate average brightness
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          
          // Only count non-transparent pixels
          if (a > 128) {
            // Calculate relative luminance
            const brightness = (0.299 * r + 0.587 * g + 0.114 * b);
            totalBrightness += brightness;
            pixelCount++;
          }
        }
        
        const avgBrightness = totalBrightness / pixelCount;
        
        // If piece is dark (brightness < 128), use light background
        // If piece is light (brightness >= 128), use dark background
        setImageBgColor(avgBrightness < 128 ? '#e8e8e8' : '#2a2a2a');
      } catch (error) {
        console.log('Could not analyze image brightness, using default');
        // Keep default neutral gray on error
      }
    };
    
    img.onerror = () => {
      console.log('Image load error, using default background');
    };
  }, [piece]);

  // Close creator menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (creatorMenuRef.current && !creatorMenuRef.current.contains(e.target)) {
        setCreatorMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const getFirstImage = (imageLocation) => {
    if (!imageLocation) return null;
    
    try {
      const images = JSON.parse(imageLocation);
      if (Array.isArray(images) && images.length > 0) {
        const imagePath = images[0];
        return imagePath.startsWith('http') ? imagePath : `${ASSET_URL}${imagePath}`;
      }
    } catch {
      const imagePath = imageLocation;
      if (imagePath.startsWith('http')) {
        return imagePath;
      } else if (imagePath.startsWith('/uploads/')) {
        return `${ASSET_URL}${imagePath}`;
      } else {
        return `${ASSET_URL}/uploads/pieces/${imagePath}`;
      }
    }
    
    return null;
  };

  const canEdit = () => {
    if (!currentUser || !piece) return false;
    const role = (currentUser.role || "").toLowerCase();
    return Number(piece.creator_id) === Number(currentUser.id) || role === "admin" || role === "owner";
  };

  const handleDeletePiece = async () => {
    if (!window.confirm(`Are you sure you want to delete "${piece.piece_name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await deletePiece(pieceId);
      navigate('/create/pieces');
    } catch (error) {
      alert('Failed to delete piece: ' + (error.message || error));
    }
  };

  const handleUniquenessCheck = async () => {
    if (!piece) return;
    setUniquenessError('');

    const role = (currentUser?.role || '').toLowerCase();
    const isAdminUser = role === 'admin' || role === 'owner';

    if (!isAdminUser) {
      const storageKey = `uniqueness-checks-${pieceId}`;
      const now = Date.now();
      const stored = (() => {
        try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
      })();
      const windowMs = 24 * 60 * 60 * 1000;
      const recent = stored.filter((t) => now - t < windowMs);
      if (recent.length >= 3) {
        const oldest = Math.min(...recent);
        const resetIn = Math.ceil((oldest + windowMs - now) / 60000);
        setUniquenessError(`Limit reached — you can run 3 uniqueness checks per 24 hours. Try again in about ${resetIn} minute${resetIn !== 1 ? 's' : ''}.`);
        setUniquenessModalOpen(true);
        return;
      }
      recent.push(now);
      localStorage.setItem(storageKey, JSON.stringify(recent));
    }

    setUniquenessCheckLoading(true);
    try {
      const result = await checkPieceDuplicates(piece, pieceId);
      setUniquenessMatches(result.matches || []);
      setUniquenessModalOpen(true);
    } catch (err) {
      setUniquenessError('Failed to run check. Please try again.');
      setUniquenessModalOpen(true);
    } finally {
      setUniquenessCheckLoading(false);
    }
  };

  const openCompareModal = () => {
    setCreatorMenuOpen(false);
    setCompareSearch('');
    setCompareResults([]);
    setCompareData(null);
    setCompareError('');
    setCompareTab('differences');
    setCompareModalOpen(true);
  };

  const handleSelectCompare = async (otherId) => {
    setCompareLoading(true);
    setCompareError('');
    try {
      const res = await PiecesService.comparePieces(pieceId, otherId);
      setCompareData(res.data);
      setCompareTab('differences');
    } catch (err) {
      setCompareError(err.response?.data?.error || 'Comparison failed. Please try again.');
    } finally {
      setCompareLoading(false);
    }
  };

  // Debounced piece search for the comparer.
  useEffect(() => {
    if (!compareModalOpen) return undefined;
    const term = compareSearch.trim();
    if (term.length < 2) { setCompareResults([]); return undefined; }
    let active = true;
    setCompareSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await PiecesService.getPieces(1, 10, 'newest', term);
        const list = (res.data?.pieces || res.data?.data || res.data || [])
          .filter((p) => String(p.id) !== String(pieceId));
        if (active) setCompareResults(list);
      } catch {
        if (active) setCompareResults([]);
      } finally {
        if (active) setCompareSearchLoading(false);
      }
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [compareSearch, compareModalOpen, pieceId]);
  const pieceImages = useMemo(() => {
    if (!piece?.image_location) return [];
    try {
      const images = JSON.parse(piece.image_location);
      if (Array.isArray(images)) {
        return images.map((img) => (img.startsWith('http') ? img : `${ASSET_URL}${img}`));
      }
    } catch {
      const imagePath = piece.image_location;
      if (imagePath.startsWith('http')) {
        return [imagePath];
      }
      if (imagePath.startsWith('/uploads/')) {
        return [`${ASSET_URL}${imagePath}`];
      }
      return [`${ASSET_URL}/uploads/pieces/${imagePath}`];
    }
    return [];
  }, [piece?.image_location]);

  useEffect(() => {
    setSelectedPreviewImageUrl(pieceImages[0] || null);
  }, [pieceImages]);

  const orderedPieceImages = useMemo(() => {
    if (!selectedPreviewImageUrl) {
      return pieceImages;
    }

    const remainingImages = pieceImages.filter((imageUrl) => imageUrl !== selectedPreviewImageUrl);
    return [selectedPreviewImageUrl, ...remainingImages];
  }, [pieceImages, selectedPreviewImageUrl]);

  // Create piece data with parsed images - useMemo must be before early returns
  const pieceDataWithImages = useMemo(() => {
    if (!piece) return null;
    
    // Sanitize piece data to ensure no raw 0 or 1 values leak through
    const sanitized = {
      ...piece,
      // Movement "type" flags are derived from values (value-only model).
      directional_movement_style: !!(piece.up_movement || piece.down_movement || piece.left_movement || piece.right_movement || piece.up_left_movement || piece.up_right_movement || piece.down_left_movement || piece.down_right_movement),
      ratio_movement_style: (piece.ratio_one_movement > 0 && piece.ratio_two_movement > 0),
      step_by_step_movement_style: Number(piece.step_by_step_movement_value ?? 0) !== 0,
      repeating_movement: !!piece.repeating_movement,
      can_capture_enemy_on_move: !!piece.can_capture_enemy_on_move,
      can_capture_enemy_via_range: !!piece.can_capture_enemy_via_range,
      can_hop_over_allies: !!piece.can_hop_over_allies,
      can_hop_over_enemies: !!piece.can_hop_over_enemies,
      exact_ratio_hop_only: !!piece.exact_ratio_hop_only,
      directional_hop_disabled: !!piece.directional_hop_disabled,
      directional_hop_only: !!piece.directional_hop_only,
      max_directional_hop_pieces: piece.max_directional_hop_pieces != null ? parseInt(piece.max_directional_hop_pieces) : null,
      can_hop_attack_over_allies: !!piece.can_hop_attack_over_allies,
      can_hop_attack_over_enemies: !!piece.can_hop_attack_over_enemies,
      exact_ratio_hop_only_attack: !!piece.exact_ratio_hop_only_attack,
      directional_hop_disabled_attack: !!piece.directional_hop_disabled_attack,
      directional_hop_only_attack: !!piece.directional_hop_only_attack,
      max_directional_hop_pieces_attack: piece.max_directional_hop_pieces_attack != null ? parseInt(piece.max_directional_hop_pieces_attack) : null,
      directional_attack_style: !!piece.directional_attack_style,
      ratio_attack_style: !!piece.ratio_attack_style,
      step_by_step_attack_style: !!piece.step_by_step_attack_style,
      step_by_step_attack_range: (piece.step_by_step_attack_value != null && piece.step_by_step_attack_value !== 0)
        ? (piece.step_by_step_attack_style ? -Math.abs(piece.step_by_step_attack_value) : piece.step_by_step_attack_value)
        : null,
      directional_ranged_attack_style: !!piece.directional_ranged_attack_style,
      ratio_ranged_attack_style: !!piece.ratio_ranged_attack_style,
      step_by_step_ranged_attack_style: !!piece.step_by_step_ranged_attack_style,
      repeating_directional_ranged_attack: !!piece.repeating_directional_ranged_attack,
      // First move only flags
      first_move_only: !!piece.first_move_only,
      first_move_only_capture: !!piece.first_move_only_capture,
      // Movement exact flags
      up_left_movement_exact: !!piece.up_left_movement_exact,
      up_movement_exact: !!piece.up_movement_exact,
      up_right_movement_exact: !!piece.up_right_movement_exact,
      right_movement_exact: !!piece.right_movement_exact,
      down_right_movement_exact: !!piece.down_right_movement_exact,
      down_movement_exact: !!piece.down_movement_exact,
      down_left_movement_exact: !!piece.down_left_movement_exact,
      left_movement_exact: !!piece.left_movement_exact,
      // Capture exact flags
      up_left_capture_exact: !!piece.up_left_capture_exact,
      up_capture_exact: !!piece.up_capture_exact,
      up_right_capture_exact: !!piece.up_right_capture_exact,
      right_capture_exact: !!piece.right_capture_exact,
      down_right_capture_exact: !!piece.down_right_capture_exact,
      down_capture_exact: !!piece.down_capture_exact,
      down_left_capture_exact: !!piece.down_left_capture_exact,
      left_capture_exact: !!piece.left_capture_exact,
      // Attack range exact flags
      up_left_attack_range_exact: !!piece.up_left_attack_range_exact,
      up_attack_range_exact: !!piece.up_attack_range_exact,
      up_right_attack_range_exact: !!piece.up_right_attack_range_exact,
      right_attack_range_exact: !!piece.right_attack_range_exact,
      down_right_attack_range_exact: !!piece.down_right_attack_range_exact,
      down_attack_range_exact: !!piece.down_attack_range_exact,
      down_left_attack_range_exact: !!piece.down_left_attack_range_exact,
      left_attack_range_exact: !!piece.left_attack_range_exact,
      hop_stop_at_occupied: !!piece.hop_stop_at_occupied,
      repeating_ratio_capture: !!piece.repeating_ratio_capture,
      hop_stop_at_occupied_attack: !!piece.hop_stop_at_occupied_attack,
      chain_hop_allies: !!piece.chain_hop_allies,
      // Direction change boolean fields
      directional_movement_change: !!piece.directional_movement_change,
      repeating_movement_change: !!piece.repeating_movement_change,
      require_empty_via_movement: !!piece.require_empty_via_movement,
      require_direction_change: !!piece.require_direction_change,
      directional_capture_change: !!piece.directional_capture_change,
      repeating_capture_change: !!piece.repeating_capture_change,
      require_empty_via_capture: !!piece.require_empty_via_capture,
      require_direction_change_capture: !!piece.require_direction_change_capture,
      // Special ability boolean fields (DEFAULT 0 in DB)
      can_promote: !!piece.can_promote,
      can_castle: !!piece.can_castle,
      can_en_passant: !!piece.can_en_passant,
      capture_on_hop: !!piece.capture_on_hop,
      chain_capture_enabled: !!piece.chain_capture_enabled,
      can_capture_allies: !!piece.can_capture_allies,
      must_move_if_able: !!piece.must_move_if_able,
      die_on_capture: !!piece.die_on_capture,
      die_on_capture_grants_win: !!piece.die_on_capture_grants_win,
      piece_image_previews: orderedPieceImages,
      // Use database field names directly for PieceBoardPreview
      special_scenario_moves: piece.special_scenario_moves || "",
      special_scenario_capture: piece.special_scenario_captures || ""
    };
    
    return sanitized;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedPieceImages, piece]);

  // Compute (or retrieve from Redux cache) the base piece value on an 8×8 board.
  // The cache is keyed by piece_id so navigating away and back skips the recalculation.
  // It is invalidated by PieceWizard after a successful edit.
  const pieceBaseValue = useMemo(() => {
    if (!piece) return null;
    const id = piece.piece_id;
    if (pieceValueCache[id] !== undefined) return pieceValueCache[id];
    return estimatePieceValue(piece, 9, 9);
  }, [piece, pieceValueCache]);

  useEffect(() => {
    if (!piece) return;
    const id = piece.piece_id;
    if (pieceValueCache[id] !== undefined) return;
    dispatch(setPieceValueCache(id, estimatePieceValue(piece, 9, 9)));
  }, [piece, pieceValueCache, dispatch]);

  // Helper to get additional movements from special_scenario_moves
  const getAdditionalMovements = useMemo(() => {
    if (!piece?.special_scenario_moves) return {};
    try {
      const parsed = typeof piece.special_scenario_moves === 'string' 
        ? JSON.parse(piece.special_scenario_moves)
        : piece.special_scenario_moves;
      return parsed?.additionalMovements || {};
    } catch {
      return {};
    }
  }, [piece]);

  // Helper to get additional captures from special_scenario_captures
  const getAdditionalCaptures = useMemo(() => {
    if (!piece?.special_scenario_captures) return {};
    try {
      const parsed = typeof piece.special_scenario_captures === 'string' 
        ? JSON.parse(piece.special_scenario_captures)
        : piece.special_scenario_captures;
      return parsed?.additionalCaptures || {};
    } catch {
      return {};
    }
  }, [piece]);

  // Helper to format movement value
  const formatMovementValue = (value) => {
    if (value === null || value === undefined) return 'None';
    if (value === 0) return '0 squares';
    if (value === 99) return 'Infinite (∞)';
    if (value < 0) return `Up to ${Math.abs(value)} squares`;
    return `${value} square${value !== 1 ? 's' : ''}`;
  };

  // Helper to get directional arrow icon
  const getDirectionArrow = (directionName) => {
    const arrows = {
      'Up': '⬆️',
      'Down': '⬇️',
      'Left': '⬅️',
      'Right': '➡️',
      'Up-Left': '↖️',
      'Up-Right': '↗️',
      'Down-Left': '↙️',
      'Down-Right': '↘️'
    };
    return arrows[directionName] || '';
  };

  // Helper to get directional movement details
  const getDirectionalDetails = () => {
    if (!piece) return [];
    const directions = [
      { name: 'Up', value: piece.up_movement, exact: !!piece.up_movement_exact, availableFor: piece.up_movement_available_for },
      { name: 'Down', value: piece.down_movement, exact: !!piece.down_movement_exact, availableFor: piece.down_movement_available_for },
      { name: 'Left', value: piece.left_movement, exact: !!piece.left_movement_exact, availableFor: piece.left_movement_available_for },
      { name: 'Right', value: piece.right_movement, exact: !!piece.right_movement_exact, availableFor: piece.right_movement_available_for },
      { name: 'Up-Left', value: piece.up_left_movement, exact: !!piece.up_left_movement_exact, availableFor: piece.up_left_movement_available_for },
      { name: 'Up-Right', value: piece.up_right_movement, exact: !!piece.up_right_movement_exact, availableFor: piece.up_right_movement_available_for },
      { name: 'Down-Left', value: piece.down_left_movement, exact: !!piece.down_left_movement_exact, availableFor: piece.down_left_movement_available_for },
      { name: 'Down-Right', value: piece.down_right_movement, exact: !!piece.down_right_movement_exact, availableFor: piece.down_right_movement_available_for }
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

  // Helper to get directional capture details
  const getDirectionalCaptureDetails = () => {
    if (!piece) return [];
    const directions = [
      { name: 'Up', value: piece.up_capture, exact: !!piece.up_capture_exact, availableFor: piece.up_capture_available_for },
      { name: 'Down', value: piece.down_capture, exact: !!piece.down_capture_exact, availableFor: piece.down_capture_available_for },
      { name: 'Left', value: piece.left_capture, exact: !!piece.left_capture_exact, availableFor: piece.left_capture_available_for },
      { name: 'Right', value: piece.right_capture, exact: !!piece.right_capture_exact, availableFor: piece.right_capture_available_for },
      { name: 'Up-Left', value: piece.up_left_capture, exact: !!piece.up_left_capture_exact, availableFor: piece.up_left_capture_available_for },
      { name: 'Up-Right', value: piece.up_right_capture, exact: !!piece.up_right_capture_exact, availableFor: piece.up_right_capture_available_for },
      { name: 'Down-Left', value: piece.down_left_capture, exact: !!piece.down_left_capture_exact, availableFor: piece.down_left_capture_available_for },
      { name: 'Down-Right', value: piece.down_right_capture, exact: !!piece.down_right_capture_exact, availableFor: piece.down_right_capture_available_for }
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

  // Helper to get directional attack range details
  const getDirectionalAttackDetails = () => {
    if (!piece) return [];
    const directions = [
      { name: 'Up', value: piece.up_attack_range, exact: !!piece.up_attack_range_exact, availableFor: piece.up_attack_range_available_for },
      { name: 'Down', value: piece.down_attack_range, exact: !!piece.down_attack_range_exact, availableFor: piece.down_attack_range_available_for },
      { name: 'Left', value: piece.left_attack_range, exact: !!piece.left_attack_range_exact, availableFor: piece.left_attack_range_available_for },
      { name: 'Right', value: piece.right_attack_range, exact: !!piece.right_attack_range_exact, availableFor: piece.right_attack_range_available_for },
      { name: 'Up-Left', value: piece.up_left_attack_range, exact: !!piece.up_left_attack_range_exact, availableFor: piece.up_left_attack_range_available_for },
      { name: 'Up-Right', value: piece.up_right_attack_range, exact: !!piece.up_right_attack_range_exact, availableFor: piece.up_right_attack_range_available_for },
      { name: 'Down-Left', value: piece.down_left_attack_range, exact: !!piece.down_left_attack_range_exact, availableFor: piece.down_left_attack_range_available_for },
      { name: 'Down-Right', value: piece.down_right_attack_range, exact: !!piece.down_right_attack_range_exact, availableFor: piece.down_right_attack_range_available_for }
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

  // Helper to get DC second-leg direction details for movement
  const getDCMovementDetails = () => {
    if (!piece) return [];
    const directions = [
      { name: 'Up', value: piece.up_movement_change, exact: !!piece.up_movement_change_exact, availableFor: piece.up_movement_change_available_for },
      { name: 'Down', value: piece.down_movement_change, exact: !!piece.down_movement_change_exact, availableFor: piece.down_movement_change_available_for },
      { name: 'Left', value: piece.left_movement_change, exact: !!piece.left_movement_change_exact, availableFor: piece.left_movement_change_available_for },
      { name: 'Right', value: piece.right_movement_change, exact: !!piece.right_movement_change_exact, availableFor: piece.right_movement_change_available_for },
      { name: 'Up-Left', value: piece.up_left_movement_change, exact: !!piece.up_left_movement_change_exact, availableFor: piece.up_left_movement_change_available_for },
      { name: 'Up-Right', value: piece.up_right_movement_change, exact: !!piece.up_right_movement_change_exact, availableFor: piece.up_right_movement_change_available_for },
      { name: 'Down-Left', value: piece.down_left_movement_change, exact: !!piece.down_left_movement_change_exact, availableFor: piece.down_left_movement_change_available_for },
      { name: 'Down-Right', value: piece.down_right_movement_change, exact: !!piece.down_right_movement_change_exact, availableFor: piece.down_right_movement_change_available_for },
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

  // Helper to get DC second-leg direction details for capture
  const getDCCaptureDetails = () => {
    if (!piece) return [];
    const useMov = piece.attacks_like_movement && !piece.directional_capture_change;
    const directions = [
      { name: 'Up', value: useMov ? piece.up_movement_change : piece.up_capture_change, exact: !!(useMov ? piece.up_movement_change_exact : piece.up_capture_change_exact), availableFor: useMov ? piece.up_movement_change_available_for : piece.up_capture_change_available_for },
      { name: 'Down', value: useMov ? piece.down_movement_change : piece.down_capture_change, exact: !!(useMov ? piece.down_movement_change_exact : piece.down_capture_change_exact), availableFor: useMov ? piece.down_movement_change_available_for : piece.down_capture_change_available_for },
      { name: 'Left', value: useMov ? piece.left_movement_change : piece.left_capture_change, exact: !!(useMov ? piece.left_movement_change_exact : piece.left_capture_change_exact), availableFor: useMov ? piece.left_movement_change_available_for : piece.left_capture_change_available_for },
      { name: 'Right', value: useMov ? piece.right_movement_change : piece.right_capture_change, exact: !!(useMov ? piece.right_movement_change_exact : piece.right_capture_change_exact), availableFor: useMov ? piece.right_movement_change_available_for : piece.right_capture_change_available_for },
      { name: 'Up-Left', value: useMov ? piece.up_left_movement_change : piece.up_left_capture_change, exact: !!(useMov ? piece.up_left_movement_change_exact : piece.up_left_capture_change_exact), availableFor: useMov ? piece.up_left_movement_change_available_for : piece.up_left_capture_change_available_for },
      { name: 'Up-Right', value: useMov ? piece.up_right_movement_change : piece.up_right_capture_change, exact: !!(useMov ? piece.up_right_movement_change_exact : piece.up_right_capture_change_exact), availableFor: useMov ? piece.up_right_movement_change_available_for : piece.up_right_capture_change_available_for },
      { name: 'Down-Left', value: useMov ? piece.down_left_movement_change : piece.down_left_capture_change, exact: !!(useMov ? piece.down_left_movement_change_exact : piece.down_left_capture_change_exact), availableFor: useMov ? piece.down_left_movement_change_available_for : piece.down_left_capture_change_available_for },
      { name: 'Down-Right', value: useMov ? piece.down_right_movement_change : piece.down_right_capture_change, exact: !!(useMov ? piece.down_right_movement_change_exact : piece.down_right_capture_change_exact), availableFor: useMov ? piece.down_right_movement_change_available_for : piece.down_right_capture_change_available_for },
    ];
    return directions.filter(d => d.value != null && d.value !== 0);
  };

  const parseCustomSquares = (squareData) => {
    if (!squareData) return [];

    try {
      const parsedSquares = typeof squareData === 'string'
        ? JSON.parse(squareData)
        : squareData;

      if (!Array.isArray(parsedSquares)) {
        return [];
      }

      return parsedSquares
        .filter((square) => Number.isInteger(square?.row) && Number.isInteger(square?.col))
        .sort((leftSquare, rightSquare) => {
          if (leftSquare.row !== rightSquare.row) {
            return leftSquare.row - rightSquare.row;
          }

          return leftSquare.col - rightSquare.col;
        });
    } catch {
      return [];
    }
  };

  const customMovementSquares = useMemo(
    () => parseCustomSquares(piece?.custom_movement_squares),
    [piece?.custom_movement_squares]
  );

  const customAttackSquares = useMemo(
    () => parseCustomSquares(piece?.custom_attack_squares),
    [piece?.custom_attack_squares]
  );

  const COLLAPSE_CUSTOM_SQUARES_THRESHOLD = 10;
  const [showCustomMovementList, setShowCustomMovementList] = useState(false);
  const [showCustomAttackList, setShowCustomAttackList] = useState(false);

  useEffect(() => {
    setShowCustomMovementList(customMovementSquares.length > 0 && customMovementSquares.length < COLLAPSE_CUSTOM_SQUARES_THRESHOLD);
  }, [customMovementSquares.length]);

  useEffect(() => {
    setShowCustomAttackList(customAttackSquares.length > 0 && customAttackSquares.length < COLLAPSE_CUSTOM_SQUARES_THRESHOLD);
  }, [customAttackSquares.length]);

  const formatCustomSquareCoordinate = (square) => `(${square.row}, ${square.col})`;

  const formatCustomSquareArray = (squares) => `[${squares.map(formatCustomSquareCoordinate).join(', ')}]`;

  const describeCustomSquareOffset = (square) => {
    const parts = [];

    if (square.row < 0) {
      parts.push(`up ${Math.abs(square.row)}`);
    } else if (square.row > 0) {
      parts.push(`down ${square.row}`);
    }

    if (square.col < 0) {
      parts.push(`left ${Math.abs(square.col)}`);
    } else if (square.col > 0) {
      parts.push(`right ${square.col}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'piece position';
  };

  const firstImageUrl = piece ? getFirstImage(piece.image_location) : null;

  // Sanitize piece for display to prevent 0/1 from showing as text
  const displayPiece = useMemo(() => {
    if (!piece) return null;
    return {
      ...piece,
      // Movement "type" flags are derived from values (value-only model).
      directional_movement_style: !!(piece.up_movement || piece.down_movement || piece.left_movement || piece.right_movement || piece.up_left_movement || piece.up_right_movement || piece.down_left_movement || piece.down_right_movement),
      ratio_movement_style: (piece.ratio_one_movement > 0 && piece.ratio_two_movement > 0),
      step_by_step_movement_style: Number(piece.step_by_step_movement_value ?? 0) !== 0,
      repeating_movement: !!piece.repeating_movement,
      can_capture_enemy_on_move: !!piece.can_capture_enemy_on_move,
      can_capture_enemy_via_range: !!piece.can_capture_enemy_via_range,
      can_hop_over_allies: !!piece.can_hop_over_allies,
      can_hop_over_enemies: !!piece.can_hop_over_enemies,
      exact_ratio_hop_only: !!piece.exact_ratio_hop_only,
      directional_hop_disabled: !!piece.directional_hop_disabled,
      directional_hop_only: !!piece.directional_hop_only,
      max_directional_hop_pieces: piece.max_directional_hop_pieces != null ? parseInt(piece.max_directional_hop_pieces) : null,
      can_hop_attack_over_allies: !!piece.can_hop_attack_over_allies,
      can_hop_attack_over_enemies: !!piece.can_hop_attack_over_enemies,
      exact_ratio_hop_only_attack: !!piece.exact_ratio_hop_only_attack,
      directional_hop_disabled_attack: !!piece.directional_hop_disabled_attack,
      directional_hop_only_attack: !!piece.directional_hop_only_attack,
      max_directional_hop_pieces_attack: piece.max_directional_hop_pieces_attack != null ? parseInt(piece.max_directional_hop_pieces_attack) : null,
      directional_attack_style: !!piece.directional_attack_style,
      ratio_attack_style: !!piece.ratio_attack_style,
      step_by_step_attack_style: !!piece.step_by_step_attack_style,
      step_by_step_attack_range: (piece.step_by_step_attack_value != null && piece.step_by_step_attack_value !== 0)
        ? (piece.step_by_step_attack_style ? -Math.abs(piece.step_by_step_attack_value) : piece.step_by_step_attack_value)
        : null,
      directional_ranged_attack_style: !!piece.directional_ranged_attack_style,
      ratio_ranged_attack_style: !!piece.ratio_ranged_attack_style,
      step_by_step_ranged_attack_style: !!piece.step_by_step_ranged_attack_style,
      repeating_directional_ranged_attack: !!piece.repeating_directional_ranged_attack,
      // First move only flags
      first_move_only: !!piece.first_move_only,
      first_move_only_capture: !!piece.first_move_only_capture,
      // Convert special ability fields to booleans
      can_promote: !!piece.can_promote,
      can_castle: !!piece.can_castle,
      can_en_passant: !!piece.can_en_passant,
      has_checkmate_rule: !!piece.has_checkmate_rule,
      has_check_rule: !!piece.has_check_rule,
      has_lose_on_capture_rule: !!piece.has_lose_on_capture_rule,
      capture_on_hop: !!piece.capture_on_hop,
      chain_capture_enabled: !!piece.chain_capture_enabled,
      can_capture_allies: !!piece.can_capture_allies,
      cannot_be_captured: !!piece.cannot_be_captured,
      must_move_if_able: !!piece.must_move_if_able,
      must_move_uses_action: !!piece.must_move_uses_action,
      repeating_ratio: !!piece.repeating_ratio,
      repeating_ratio_capture: !!piece.repeating_ratio_capture,
      hop_stop_at_occupied: piece.hop_stop_at_occupied !== undefined ? !!piece.hop_stop_at_occupied : true,
      hop_stop_at_occupied_attack: !!piece.hop_stop_at_occupied_attack,
      chain_hop_allies: !!piece.chain_hop_allies,
      // Direction change boolean fields
      directional_movement_change: !!piece.directional_movement_change,
      repeating_movement_change: !!piece.repeating_movement_change,
      require_empty_via_movement: !!piece.require_empty_via_movement,
      require_direction_change: !!piece.require_direction_change,
      directional_capture_change: !!piece.directional_capture_change,
      repeating_capture_change: !!piece.repeating_capture_change,
      require_empty_via_capture: !!piece.require_empty_via_capture,
      require_direction_change_capture: !!piece.require_direction_change_capture,
      // Die-on-capture boolean fields
      die_on_capture: !!piece.die_on_capture,
      die_on_capture_grants_win: !!piece.die_on_capture_grants_win,
    };
  }, [piece]);

  if (loading) {
    return (
      <div className={styles["container"]}>
        <div className={styles["loading"]}>Loading piece...</div>
      </div>
    );
  }

  if (error || !piece) {
    return (
      <div className={styles["container"]}>
        <div className={styles["error"]}>{error || "Piece not found"}</div>
        <button onClick={() => navigate('/create/pieces')} className={styles["back-button"]}>
          Back to Pieces
        </button>
      </div>
    );
  }

  // Use displayPiece for rendering to prevent 0/1 from showing
  const pieceToDisplay = displayPiece || piece;

  // Calculate the board size that PieceBoardPreview would use for this piece
  const calculatePreviewBoardSize = () => {
    if (!piece) return { boardWidth: 9, boardHeight: 9 };
    let maxRange = 0;
    const movements = [
      piece.up_left_movement, piece.up_movement, piece.up_right_movement,
      piece.left_movement, piece.right_movement,
      piece.down_left_movement, piece.down_movement, piece.down_right_movement
    ];
    const captures = [
      piece.up_left_capture, piece.up_capture, piece.up_right_capture,
      piece.left_capture, piece.right_capture,
      piece.down_left_capture, piece.down_capture, piece.down_right_capture
    ];
    const attacks = [
      piece.up_left_attack_range, piece.up_attack_range, piece.up_right_attack_range,
      piece.left_attack_range, piece.right_attack_range,
      piece.down_left_attack_range, piece.down_attack_range, piece.down_right_attack_range
    ];
    const ratioMovement = Math.abs(piece.ratio_one_movement || 0) + Math.abs(piece.ratio_two_movement || 0);
    const ratioCapture = Math.abs(piece.ratio_one_capture || 0) + Math.abs(piece.ratio_two_capture || 0);
    const ratioAttack = Math.abs(piece.ratio_one_attack_range || 0) + Math.abs(piece.ratio_two_attack_range || 0);
    const stepMovement = Math.abs(piece.step_by_step_movement_value || 0);
    const stepCapture = Math.abs(piece.step_by_step_capture || 0);
    const computedStepAttack = (piece.step_by_step_attack_value != null && piece.step_by_step_attack_value !== 0)
      ? (piece.step_by_step_attack_style ? -Math.abs(piece.step_by_step_attack_value) : piece.step_by_step_attack_value)
      : (piece.step_by_step_attack_range || 0);
    const stepAttack = Math.abs(computedStepAttack);
    [...movements, ...captures, ...attacks].forEach(val => {
      if (val !== 99 && val !== null && val !== undefined) {
        const absVal = Math.abs(val);
        if (!isNaN(absVal)) maxRange = Math.max(maxRange, absVal);
      }
    });
    maxRange = Math.max(maxRange, ratioMovement, ratioCapture, ratioAttack, stepMovement, stepCapture, stepAttack);
    const padding = Math.max(4, maxRange);
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    return { boardWidth: pw + padding * 2, boardHeight: ph + padding * 2 };
  };

  const handleTryInSandbox = () => {
    const MAX_SANDBOXES = 4;
    const existingSandboxes = (() => {
      try {
        const saved = localStorage.getItem('chessus-sandboxes');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch (e) { /* ignore */ }
      return [];
    })();

    if (existingSandboxes.length >= MAX_SANDBOXES) {
      const confirmed = window.confirm(
        `You already have ${MAX_SANDBOXES} sandbox boards open. Opening this piece in a new sandbox will close your least recent sandbox ("${existingSandboxes[0]?.name || 'Sandbox 1'}"). Continue?`
      );
      if (!confirmed) return;
    }

    const { boardWidth: bw, boardHeight: bh } = calculatePreviewBoardSize();
    const pw = piece.piece_width || 1;
    const ph = piece.piece_height || 1;
    const centerX = Math.floor((bw - pw) / 2);
    const centerY = Math.floor((bh - ph) / 2);

    const pendingData = {
      pieceId: piece.piece_id,
      pieceName: piece.piece_name,
      boardWidth: bw,
      boardHeight: bh,
      centerX,
      centerY
    };
    localStorage.setItem('chessus-sandbox-pending-piece', JSON.stringify(pendingData));
    navigate('/sandbox');
  };

  return (
    <div className={styles["container"]}>
      <div className={styles["header"]}>
        <button onClick={() => navigate('/create/pieces')} className={styles["back-button"]}>
          ← Back to Pieces
        </button>
        <div className={styles["header-actions"]}>
          <button 
            onClick={handleTryInSandbox} 
            className={styles["sandbox-button"]}
          >
            ⚔️ Try in Sandbox
          </button>
          {canEdit() && (
            <div className={styles["creator-menu-wrapper"]} ref={creatorMenuRef}>
              <button
                type="button"
                className={styles["creator-menu-btn"]}
                onClick={() => setCreatorMenuOpen((v) => !v)}
                aria-haspopup="true"
                aria-expanded={creatorMenuOpen}
              >
                ⚙ Creator Options {creatorMenuOpen ? '▲' : '▼'}
              </button>
              {creatorMenuOpen && (
                <div className={styles["creator-menu-dropdown"]}>
                  <button
                    className={styles["creator-menu-item"]}
                    onClick={() => { setCreatorMenuOpen(false); navigate(`/create/piece/edit/${pieceId}`); }}
                  >
                    ✏️ Edit Piece
                  </button>
                  <button
                    className={styles["creator-menu-item"]}
                    onClick={() => { setCreatorMenuOpen(false); handleDeletePiece(); }}
                  >
                    🗑️ Delete Piece
                  </button>
                  <button
                    type="button"
                    className={styles["creator-menu-item"]}
                    onClick={() => { setCreatorMenuOpen(false); handleUniquenessCheck(); }}
                    disabled={uniquenessCheckLoading}
                  >
                    {uniquenessCheckLoading ? '🔍 Checking…' : '🔍 Run Uniqueness Check'}
                  </button>
                  <button
                    type="button"
                    className={styles["creator-menu-item"]}
                    onClick={openCompareModal}
                  >
                    🔀 Compare With Piece
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className={styles["piece-info"]}>
        <div className={styles["title-section"]}>
          {firstImageUrl && (
            <img 
              src={firstImageUrl} 
              alt={pieceToDisplay.piece_name} 
              className={styles["piece-image"]}
              style={{ backgroundColor: imageBgColor }}
            />
          )}
          <div>
            <h1>{pieceToDisplay.piece_name}</h1>
            {pieceToDisplay.moderation_status && pieceToDisplay.moderation_status !== 'approved' && 
             (currentUser && (Number(currentUser.id) === Number(pieceToDisplay.creator_id) || currentUser.role === 'admin' || currentUser.role === 'owner')) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span className={styles[`moderation-badge-${pieceToDisplay.moderation_status}`]}>
                  {pieceToDisplay.moderation_status === 'pending_review' ? '⏳ Images Under Review' : '❌ Images Rejected'}
                </span>
                {(currentUser.role === 'admin' || currentUser.role === 'owner') && pieceToDisplay.moderation_status === 'pending_review' && (
                  <button
                    onClick={async () => {
                      try {
                        await axios.post(
                          `${API_URL}admin/pieces/${pieceToDisplay.piece_id}/approve-moderation`,
                          {},
                          { headers: authHeader() }
                        );
                        window.location.reload();
                      } catch (err) {
                        console.error("Failed to approve:", err);
                      }
                    }}
                    style={{
                      padding: '4px 12px', fontSize: '0.85rem', cursor: 'pointer',
                      background: '#27ae60', color: '#fff', border: 'none', borderRadius: '4px'
                    }}
                  >
                    Approve
                  </button>
                )}
              </div>
            )}
            {pieceToDisplay.creator_username && (
              <p className={styles["creator"]}>
                Created by {pieceToDisplay.creator_username === 'Anonymous' ? 'Anonymous' : <Link to={`/profile/${pieceToDisplay.creator_username}`}>{pieceToDisplay.creator_username}</Link>}
                {pieceToDisplay.created_at && (
                  <> on {parseServerDate(pieceToDisplay.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</>
                )}
              </p>
            )}
          </div>
        </div>

        {pieceToDisplay.piece_description && (
          <div className={styles["section"]}>
            <h2>Description</h2>
            <div>{renderContent(pieceToDisplay.piece_description)}</div>
          </div>
        )}

        {pieceImages.length > 0 && (
          <div className={styles["section"]}>
            <h2>Piece Images</h2>
            <div className={styles["images-gallery"]}>
              {pieceImages.map((imageUrl, index) => (
                <button
                  key={index}
                  type="button"
                  className={`${styles["image-item"]} ${selectedPreviewImageUrl === imageUrl ? styles["selected-image-item"] : ''}`}
                  onClick={() => setSelectedPreviewImageUrl(imageUrl)}
                  title={selectedPreviewImageUrl === imageUrl ? "Currently shown on the board" : "Show this image on the board"}
                >
                  <img 
                    src={imageUrl} 
                    alt={`${pieceToDisplay.piece_name} ${index + 1}`}
                    loading="lazy"
                    className={styles["gallery-image"]}
                  />
                  {index === 0 && <span className={styles["default-badge"]}>Default</span>}
                  {selectedPreviewImageUrl === imageUrl && <span className={styles["preview-badge"]}>Preview</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className={styles["section"]}>
          <h2>Movement & Attack Pattern</h2>
          <p className={styles["hint"]}>Hover over the board to see where this piece can move, capture, and ranged attack</p>
          <div className={styles["board-container"]}>
            <PieceBoardPreview pieceData={pieceDataWithImages} showLegend={true} />
          </div>
        </div>

        <div className={styles["stats-grid"]}>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Size</span>
              <InfoTooltip text="The width × height in squares this piece occupies on the board" />
            </div>
            <span className={styles["stat-value"]}>{pieceToDisplay.piece_width} × {pieceToDisplay.piece_height}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Directional Movement</span>
              <InfoTooltip text="Piece moves in straight lines (up, down, left, right, diagonals) with configurable range per direction" />
            </div>
            <span className={styles["stat-value"]}>{pieceToDisplay.directional_movement_style ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Ratio Movement</span>
              <InfoTooltip text="Piece moves in an L-shape pattern defined by a ratio (e.g. 2:1 like a knight)" />
            </div>
            <span className={styles["stat-value"]}>
              {pieceToDisplay.ratio_movement_style ? 'Yes' : 'No'}
              {pieceToDisplay.ratio_movement_style && pieceToDisplay.ratio_one_movement && pieceToDisplay.ratio_two_movement && (
                <span> ({pieceToDisplay.ratio_one_movement}:{pieceToDisplay.ratio_two_movement})</span>
              )}
            </span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Step-by-Step Movement</span>
              <InfoTooltip text="Piece moves a fixed number of steps in any valid direction, potentially changing direction at each step" />
            </div>
            <span className={styles["stat-value"]}>
              {pieceToDisplay.step_by_step_movement_style ? 'Yes' : 'No'}
              {pieceToDisplay.step_by_step_movement_style && pieceToDisplay.step_by_step_movement_value != null && (
                <span> ({pieceToDisplay.step_by_step_movement_value} steps)</span>
              )}
            </span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Capture on Move</span>
              <InfoTooltip text="Can capture enemy pieces while moving (see Attack Details for specific squares)" />
            </div>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_capture_enemy_on_move ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Ranged Attack</span>
              <InfoTooltip text="Can attack enemy pieces from a distance without moving to their square" />
            </div>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_capture_enemy_via_range ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Hop Over Allies</span>
              <InfoTooltip text="Can jump over friendly pieces in its movement path" />
            </div>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_hop_over_allies ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Hop Over Enemies</span>
              <InfoTooltip text="Can jump over enemy pieces in its movement path" />
            </div>
            <span className={styles["stat-value"]}>{pieceToDisplay.can_hop_over_enemies ? 'Yes' : 'No'}</span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Exact Movement</span>
              <InfoTooltip text="When enabled, pieces must move exactly the specified number of squares, not any distance up to that number" />
            </div>
            <span className={styles["stat-value"]}>
              {(piece.up_movement_exact || piece.down_movement_exact || piece.left_movement_exact || piece.right_movement_exact ||
                piece.up_left_movement_exact || piece.up_right_movement_exact || piece.down_left_movement_exact || piece.down_right_movement_exact) ? 'Yes' : 'No'}
            </span>
          </div>
          <div className={styles["stat-card"]}>
            <div className={styles["stat-header"]}>
              <span className={styles["stat-label"]}>Approx. Value on 9×9</span>
              <InfoTooltip text="Estimated piece value calculated by simulating this piece at the center of an empty 9×9 board and counting every square it can move to and attack. Includes penalties for color-bound movement or attack. Does not include per-game ability overrides. A standard rook scores ~5.0." />
            </div>
            <span className={styles["stat-value"]}>
              {pieceBaseValue !== null ? pieceBaseValue : '…'}
            </span>
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Movement Details</h2>
          
          {/* Directional Movement */}
          {pieceToDisplay.directional_movement_style && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🧭</span>
                <h3>Directional Movement</h3>
              </div>
              {pieceToDisplay.first_move_only && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>All directional movement is first-move only</span>
                </div>
              )}
              {getDirectionalDetails().length > 0 && (
                <div className={styles["direction-list"]}>
                  {getDirectionalDetails().map(dir => (
                    <div key={dir.name} className={styles["direction-item"]}>
                      <span className={styles["direction-name"]}>
                        <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                        {dir.name}
                      </span>
                      <span className={styles["direction-value"]}>
                        {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)}
                        {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                      </span>
                      {getAdditionalMovements[dir.name.toLowerCase().replace('-', '_')] && (
                        <div className={styles["additional-moves"]}>
                          {getAdditionalMovements[dir.name.toLowerCase().replace('-', '_')].map((move, idx) => (
                            <span key={idx} className={styles["additional-tag"]}>
                              + {formatMovementValue(move.value)}
                              {move.exact && <span className={styles["mini-badge"] + ' ' + styles["exact-mini"]}>exact</span>}
                              {move.firstMoveOnly && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>1st move</span>}
                              {move.availableForMoves && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>{move.availableForMoves === 1 ? '1st move' : `1st ${move.availableForMoves} moves`}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className={styles["ability-properties"]}>
                {pieceToDisplay.repeating_movement && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Can Repeat Movement
                    {pieceToDisplay.max_directional_movement_iterations != null && 
                      ` (max ${pieceToDisplay.max_directional_movement_iterations}x)`}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Ratio Movement */}
          {pieceToDisplay.ratio_movement_style && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🔀</span>
                <h3>Ratio Movement (L-Shape)</h3>
              </div>
              {pieceToDisplay.first_move_only && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>Ratio movement is first-move only</span>
                </div>
              )}
              <div className={styles["ratio-display"]}>
                Pattern: <span className={styles["ratio-value"]}>
                  {pieceToDisplay.ratio_one_movement || '?'}:{pieceToDisplay.ratio_two_movement || '?'}
                </span>
              </div>
              {pieceToDisplay.repeating_ratio && (
                <div className={styles["ability-properties"]}>
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Repeating ratio hops
                    {piece.max_ratio_iterations === -1
                      ? ' (infinite)'
                      : piece.max_ratio_iterations != null && piece.max_ratio_iterations > 1
                        ? ` (max ${piece.max_ratio_iterations}x)`
                        : ''}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step by Step Movement */}
          {pieceToDisplay.step_by_step_movement_style && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>👣</span>
                <h3>Step-by-Step Movement</h3>
              </div>
              {pieceToDisplay.first_move_only && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>Step-by-step movement is first-move only</span>
                </div>
              )}
              <div className={styles["step-display"]}>
                Can move up to <span className={styles["step-value"]}>{Math.abs(pieceToDisplay.step_by_step_movement_value || 0)}</span> squares,
                {(pieceToDisplay.step_by_step_movement_value || 0) < 0
                  ? ' counting only horizontal and vertical steps (Manhattan distance — diagonals excluded)'
                  : ' in any direction including diagonals (Chebyshev distance)'}, changing direction within a single move
              </div>
            </div>
          )}

          {customMovementSquares.length > 0 && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🟩</span>
                <h3>Custom Square Movement ({customMovementSquares.length})</h3>
              </div>
              {pieceToDisplay.first_move_only && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>Custom movement is first-move only</span>
                </div>
              )}
              <div className={styles["custom-square-summary"]}>
                Relative offsets [row, col]:
                <span className={styles["custom-square-array"]}>{formatCustomSquareArray(customMovementSquares)}</span>
              </div>
              {customMovementSquares.length >= COLLAPSE_CUSTOM_SQUARES_THRESHOLD && (
                <button
                  type="button"
                  onClick={() => setShowCustomMovementList((prev) => !prev)}
                  style={{
                    marginTop: '8px', marginBottom: '8px', padding: '4px 10px',
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem'
                  }}
                >
                  {showCustomMovementList ? `Hide ${customMovementSquares.length} squares` : `Show all ${customMovementSquares.length} squares`}
                </button>
              )}
              {showCustomMovementList && (
                <div className={styles["custom-square-list"]}>
                  {customMovementSquares.map((square, index) => (
                    <div key={`${square.row}-${square.col}-${index}`} className={styles["custom-square-item"]}>
                      <span className={styles["custom-square-coordinate"]}>{formatCustomSquareCoordinate(square)}</span>
                      <span className={styles["custom-square-description"]}>{describeCustomSquareOffset(square)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Movement Modifiers */}
          <div className={styles["modifiers-grid"]}>
            {pieceToDisplay.min_turns_per_move != null && pieceToDisplay.min_turns_per_move > 0 && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>⏱️</span>
                Inactive for first {pieceToDisplay.min_turns_per_move} turn{pieceToDisplay.min_turns_per_move !== 1 ? 's' : ''}
              </div>
            )}
            {pieceToDisplay.max_turns_per_move != null && pieceToDisplay.max_turns_per_move > 0 && (
              <div className={styles["modifier-badge"]}>
                <span className={styles["modifier-icon"]}>⏱️</span>
                Max {pieceToDisplay.max_turns_per_move} turn{pieceToDisplay.max_turns_per_move !== 1 ? 's' : ''} per move
              </div>
            )}
          </div>

          {/* Hopping Section */}
          {(() => {
            const hasMovHop = pieceToDisplay.can_hop_over_allies || pieceToDisplay.can_hop_over_enemies
              || pieceToDisplay.exact_ratio_hop_only || pieceToDisplay.directional_hop_disabled || pieceToDisplay.directional_hop_only;
            const hasAtkHop = pieceToDisplay.can_hop_attack_over_allies || pieceToDisplay.can_hop_attack_over_enemies
              || pieceToDisplay.exact_ratio_hop_only_attack || pieceToDisplay.directional_hop_disabled_attack || pieceToDisplay.directional_hop_only_attack
              || (pieceToDisplay.chain_capture_enabled && pieceToDisplay.chain_hop_allies);
            if (!hasMovHop && !hasAtkHop) return null;

            const movWho = pieceToDisplay.can_hop_over_allies && pieceToDisplay.can_hop_over_enemies
              ? 'allies and enemies'
              : pieceToDisplay.can_hop_over_allies ? 'allies' : pieceToDisplay.can_hop_over_enemies ? 'enemies' : null;
            const atkWho = pieceToDisplay.can_hop_attack_over_allies && pieceToDisplay.can_hop_attack_over_enemies
              ? 'allies and enemies'
              : pieceToDisplay.can_hop_attack_over_allies ? 'allies' : pieceToDisplay.can_hop_attack_over_enemies ? 'enemies' : null;
            const movHopStop = pieceToDisplay.repeating_ratio
              && (pieceToDisplay.max_ratio_iterations === -1 || (pieceToDisplay.max_ratio_iterations || 1) > 1)
              && pieceToDisplay.hop_stop_at_occupied;
            const atkHopStop = pieceToDisplay.repeating_ratio_capture
              && (pieceToDisplay.max_ratio_capture_iterations === -1 || (pieceToDisplay.max_ratio_capture_iterations || 1) > 1)
              && pieceToDisplay.hop_stop_at_occupied_attack;

            return (
              <div className={styles["hop-section"]}>
                <div className={styles["hop-section-header"]}>
                  <span className={styles["hop-section-icon"]}>🦘</span>
                  <span>Hopping</span>
                </div>
                <ul className={styles["hop-list"]}>
                  {hasMovHop && (
                    <li>
                      <strong>Movement</strong>
                      {movWho ? `: can hop over ${movWho}` : ''}
                      {pieceToDisplay.exact_ratio_hop_only ? ' · only on ratio/exact moves' : ''}
                      {pieceToDisplay.directional_hop_only ? ' · required for directional moves' : ''}
                      {pieceToDisplay.directional_hop_only && pieceToDisplay.max_directional_hop_pieces ? ` · max ${pieceToDisplay.max_directional_hop_pieces} piece${pieceToDisplay.max_directional_hop_pieces !== 1 ? 's' : ''} in path` : ''}
                      {pieceToDisplay.directional_hop_disabled ? ' · disabled for directional moves' : ''}
                      {movHopStop ? ' · stops at occupied intermediates when repeating' : ''}
                    </li>
                  )}
                  {hasAtkHop && (
                    <li>
                      <strong>Attack</strong>
                      {atkWho ? `: can hop over ${atkWho}` : ''}
                      {pieceToDisplay.exact_ratio_hop_only_attack ? ' · only on ratio/exact attacks' : ''}
                      {pieceToDisplay.directional_hop_only_attack ? ' · required for directional attacks' : ''}
                      {pieceToDisplay.directional_hop_only_attack && pieceToDisplay.max_directional_hop_pieces_attack ? ` · max ${pieceToDisplay.max_directional_hop_pieces_attack} piece${pieceToDisplay.max_directional_hop_pieces_attack !== 1 ? 's' : ''} in path` : ''}
                      {pieceToDisplay.directional_hop_disabled_attack ? ' · disabled for directional attacks' : ''}
                      {atkHopStop ? ' · stops at occupied intermediates when repeating' : ''}
                      {pieceToDisplay.chain_capture_enabled && pieceToDisplay.chain_hop_allies ? ' · hops over allies during chain captures' : ''}
                    </li>
                  )}
                </ul>
              </div>
            );
          })()}
        </div>

        {/* Direction Change Movement */}
        {pieceToDisplay.directional_movement_change && getDCMovementDetails().length > 0 && (
          <div className={styles["section"]}>
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>↩️</span>
                <h3>Direction Change Movement</h3>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: '0.9rem', opacity: 0.8 }}>
                This piece can turn at a via square mid-move. After traveling its normal first leg in any enabled direction, it pivots and continues along a second leg in one of the directions below (same or opposite direction not allowed).
              </p>
              <div className={styles["direction-list"]}>
                {getDCMovementDetails().map(dir => (
                  <div key={dir.name} className={styles["direction-item"]}>
                    <span className={styles["direction-name"]}>
                      <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                      {dir.name}
                    </span>
                    <span className={styles["direction-value"]}>
                      {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)}
                      {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles["ability-properties"]}>
                {pieceToDisplay.repeating_movement_change && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Exact second-leg distances repeat infinitely
                  </div>
                )}
                {pieceToDisplay.require_empty_via_movement && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>⬜</span>
                    Via (turning) square must be empty
                  </div>
                )}
                {pieceToDisplay.require_direction_change && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>⚠️</span>
                    Direction change is mandatory — must turn mid-move
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className={styles["section"]}>
          <h2>Special Abilities</h2>
          <div className={styles["abilities-grid"]}>
            {pieceToDisplay.can_promote && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>👑</span>
                <span className={styles["special-name"]}>Can Promote</span>
              </div>
            )}
            {pieceToDisplay.can_castle && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🏰</span>
                <span className={styles["special-name"]}>
                  Can Castle
                  {pieceToDisplay.castling_distance != null && (
                    <span style={{ fontWeight: 400, opacity: 0.8 }}> ({pieceToDisplay.castling_distance} squares)</span>
                  )}
                </span>
              </div>
            )}
            {pieceToDisplay.has_checkmate_rule && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>⚔️</span>
                <span className={styles["special-name"]}>Checkmate on Attack</span>
              </div>
            )}
            {pieceToDisplay.has_check_rule && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>⚠️</span>
                <span className={styles["special-name"]}>Check on Attack</span>
              </div>
            )}
            {pieceToDisplay.has_lose_on_capture_rule && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>💀</span>
                <span className={styles["special-name"]}>Lose Game if Captured</span>
              </div>
            )}
            {pieceToDisplay.can_en_passant && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>↗️</span>
                <span className={styles["special-name"]}>Can En Passant <InfoTooltip text="Can capture an enemy piece of the same type that has just used a first-move-only movement to land horizontally adjacent. For example, a Pawn can only en passant capture another Pawn." /></span>
              </div>
            )}
            {pieceToDisplay.capture_on_hop && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🔄</span>
                <span className={styles["special-name"]}>Capture on Hop <InfoTooltip text="When this piece hops over an enemy piece during movement, it captures the hopped-over piece (like checkers)." /></span>
              </div>
            )}
            {pieceToDisplay.chain_capture_enabled && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>⛓️</span>
                <span className={styles["special-name"]}>Chain Capture <InfoTooltip text="After capturing, this piece can make additional captures in the same turn (multi-jump like checkers)." /></span>
              </div>
            )}
            {pieceToDisplay.can_capture_allies && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🤝</span>
                <span className={styles["special-name"]}>Can Capture Allies <InfoTooltip text="This piece can capture friendly pieces on the same team." /></span>
              </div>
            )}
            {pieceToDisplay.must_move_if_able && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🦆</span>
                <span className={styles["special-name"]}>Must Move If Able <InfoTooltip text={`On its owner's turn, this piece is forced to move if it has any legal move available.${pieceToDisplay.must_move_uses_action ? ' The forced move consumes one of the player\u2019s actions per turn.' : ' The forced move does NOT consume an action per turn.'}`} /></span>
              </div>
            )}
            {pieceToDisplay.die_on_capture && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>💥</span>
                <span className={styles["special-name"]}>Dies on Capture <InfoTooltip text="This piece is also removed from the board when it captures another piece." /></span>
              </div>
            )}
            {pieceToDisplay.die_on_capture && pieceToDisplay.die_on_capture_grants_win && (
              <div className={styles["special-ability-card"]}>
                <span className={styles["special-icon"]}>🏆</span>
                <span className={styles["special-name"]}>Attacker Wins on Final Capture <InfoTooltip text="If this piece kills the opponent's last required-to-win piece while dying in the process, the attacker wins instead of drawing." /></span>
              </div>
            )}
            {!pieceToDisplay.can_promote && !pieceToDisplay.can_castle && !pieceToDisplay.has_checkmate_rule && 
             !pieceToDisplay.has_check_rule && !pieceToDisplay.has_lose_on_capture_rule && !pieceToDisplay.can_en_passant &&
             !pieceToDisplay.capture_on_hop && !pieceToDisplay.chain_capture_enabled &&
             !pieceToDisplay.can_capture_allies && !pieceToDisplay.must_move_if_able &&
             !pieceToDisplay.die_on_capture && (
              <div className={styles["no-abilities"]}>
                <span className={styles["no-abilities-icon"]}>✨</span>
                <span>No special abilities</span>
              </div>
            )}
          </div>
        </div>

        <div className={styles["section"]}>
          <h2>Used In Games ({gamesUsingPiece.length})</h2>
          {gamesLoading ? (
            <div className={styles["loading-games"]}>
              <span>Loading games...</span>
            </div>
          ) : gamesUsingPiece.length > 0 ? (
            <>
              <div className={styles["games-grid"]}>
                {gamesUsingPiece.slice((gamesPage - 1) * GAMES_PER_PAGE, gamesPage * GAMES_PER_PAGE).map((game) => (
                  <Link 
                    key={game.id} 
                    to={`/games/${game.id}`} 
                    className={styles["game-card"]}
                  >
                    <div className={styles["game-name"]}>{game.game_name}</div>
                    <div className={styles["game-creator"]}>
                      by {game.creator_username || 'Unknown'}
                    </div>
                  </Link>
                ))}
              </div>
              {gamesUsingPiece.length > GAMES_PER_PAGE && (
                <Pagination
                  currentPage={gamesPage}
                  totalPages={Math.ceil(gamesUsingPiece.length / GAMES_PER_PAGE)}
                  onPageChange={setGamesPage}
                />
              )}
            </>
          ) : (
            <div className={styles["no-abilities"]}>
              <span className={styles["no-abilities-icon"]}>♟</span>
              <span>Not used in any games yet</span>
            </div>
          )}
        </div>

        <div className={styles["section"]}>
          <h2>Attack Details</h2>
          
          {/* Capture on Move */}
          {pieceToDisplay.can_capture_enemy_on_move && (
            getDirectionalCaptureDetails().length > 0 ||
            pieceToDisplay.ratio_one_capture || pieceToDisplay.ratio_two_capture ||
            pieceToDisplay.step_by_step_capture != null ||
            !!piece.repeating_capture
          ) && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>⚔️</span>
                <h3>Capture While Moving</h3>
              </div>
              {pieceToDisplay.first_move_only_capture && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>All directional capture is first-move only</span>
                </div>
              )}
              {getDirectionalCaptureDetails().length > 0 && (
                <div className={styles["direction-list"]}>
                  {getDirectionalCaptureDetails().map(dir => (
                    <div key={dir.name} className={styles["direction-item"]}>
                      <span className={styles["direction-name"]}>
                        <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                        {dir.name}
                      </span>
                      <span className={styles["direction-value"]}>
                        {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)}
                        {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                      </span>
                      {getAdditionalCaptures[dir.name.toLowerCase().replace('-', '_')] && (
                        <div className={styles["additional-moves"]}>
                          {getAdditionalCaptures[dir.name.toLowerCase().replace('-', '_')].map((capture, idx) => (
                            <span key={idx} className={styles["additional-tag"]} style={{ background: 'rgba(255, 152, 0, 0.2)' }}>
                              + {formatMovementValue(capture.value)}
                              {capture.exact && <span className={styles["mini-badge"] + ' ' + styles["exact-mini"]}>exact</span>}
                              {capture.firstMoveOnly && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>1st move</span>}
                              {capture.availableForMoves && <span className={styles["mini-badge"] + ' ' + styles["first-move-mini"]}>{capture.availableForMoves === 1 ? '1st move' : `1st ${capture.availableForMoves} moves`}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className={styles["ability-properties"]}>
                {(pieceToDisplay.ratio_one_capture || pieceToDisplay.ratio_two_capture) && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔀</span>
                    Ratio Capture: {pieceToDisplay.ratio_one_capture || '?'}:{pieceToDisplay.ratio_two_capture || '?'}
                    {!!piece.repeating_ratio_capture && (
                      <span> (repeating{piece.max_ratio_capture_iterations != null && piece.max_ratio_capture_iterations !== -1 ? `, max ${piece.max_ratio_capture_iterations}x` : ''})</span>
                    )}
                  </div>
                )}
                {pieceToDisplay.step_by_step_capture != null && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>👣</span>
                    Step Capture: {Math.abs(pieceToDisplay.step_by_step_capture)} squares
                    {pieceToDisplay.step_by_step_capture < 0
                      ? ' (Manhattan — orthogonal only)'
                      : ' (Chebyshev — any direction)'}
                  </div>
                )}
                {!!piece.repeating_capture && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Can Repeat Capture
                    {piece.max_directional_capture_iterations != null && 
                      ` (max ${piece.max_directional_capture_iterations}x)`}
                  </div>
                )}
                {pieceToDisplay.capture_actions_per_turn != null && pieceToDisplay.capture_actions_per_turn > 1 && (
                  <div className={styles["property-tag"]}>
                    {pieceToDisplay.capture_actions_per_turn === -1 ? 'Unlimited' : pieceToDisplay.capture_actions_per_turn} capture action{pieceToDisplay.capture_actions_per_turn !== 2 ? 's' : ''} per turn
                  </div>
                )}
              </div>
            </div>
          )}

          {customAttackSquares.length > 0 && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🟥</span>
                <h3>Custom Square Attack ({customAttackSquares.length})</h3>
              </div>
              {pieceToDisplay.first_move_only_capture && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>Custom attack is first-move only</span>
                </div>
              )}
              <div className={styles["custom-square-summary"]}>
                Relative capture offsets [row, col]:
                <span className={styles["custom-square-array"]}>{formatCustomSquareArray(customAttackSquares)}</span>
              </div>
              {customAttackSquares.length >= COLLAPSE_CUSTOM_SQUARES_THRESHOLD && (
                <button
                  type="button"
                  onClick={() => setShowCustomAttackList((prev) => !prev)}
                  style={{
                    marginTop: '8px', marginBottom: '8px', padding: '4px 10px',
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: '4px', color: 'inherit', cursor: 'pointer', fontSize: '0.85rem'
                  }}
                >
                  {showCustomAttackList ? `Hide ${customAttackSquares.length} squares` : `Show all ${customAttackSquares.length} squares`}
                </button>
              )}
              {showCustomAttackList && (
                <div className={styles["custom-square-list"]}>
                  {customAttackSquares.map((square, index) => (
                    <div key={`${square.row}-${square.col}-${index}`} className={styles["custom-square-item"]}>
                      <span className={styles["custom-square-coordinate"]}>{formatCustomSquareCoordinate(square)}</span>
                      <span className={styles["custom-square-description"]}>{describeCustomSquareOffset(square)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ranged Attack */}
          {pieceToDisplay.can_capture_enemy_via_range && (
            <div className={styles["ability-card"]} style={{ borderLeftColor: '#f44336' }}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>💥</span>
                <h3>Ranged Attack</h3>
              </div>
              {pieceToDisplay.first_move_only_capture && (
                <div className={styles["global-modifier"]}>
                  <span className={styles["modifier-icon"]}>⏱️</span>
                  <span>All ranged attacks are first-move only</span>
                </div>
              )}
              {getDirectionalAttackDetails().length > 0 && (
                <div className={styles["direction-list"]}>
                  {getDirectionalAttackDetails().map(dir => (
                    <div key={dir.name} className={styles["direction-item"]}>
                      <span className={styles["direction-name"]}>
                        <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                        {dir.name}
                      </span>
                      <span className={styles["direction-value"]}>
                        {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)} range
                        {dir.exact && <span className={styles["exact-badge"]}> (exact)</span>}
                        {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className={styles["ability-properties"]}>
                {(pieceToDisplay.ratio_one_attack_range || pieceToDisplay.ratio_two_attack_range) && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔀</span>
                    Ratio Range: {pieceToDisplay.ratio_one_attack_range || '?'}:{pieceToDisplay.ratio_two_attack_range || '?'}
                  </div>
                )}
                {pieceToDisplay.step_by_step_attack_range != null && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>👣</span>
                    Step Range: {Math.abs(pieceToDisplay.step_by_step_attack_range)} squares{pieceToDisplay.step_by_step_attack_range < 0 ? ' (Manhattan — orthogonal only)' : ' (Chebyshev — any direction)'}
                  </div>
                )}
                {pieceToDisplay.ranged_capture_actions_per_turn != null && pieceToDisplay.ranged_capture_actions_per_turn > 1 && (
                  <div className={styles["property-tag"]}>
                    {pieceToDisplay.ranged_capture_actions_per_turn === -1 ? 'Unlimited' : pieceToDisplay.ranged_capture_actions_per_turn} ranged capture action{pieceToDisplay.ranged_capture_actions_per_turn !== 2 ? 's' : ''} per turn
                  </div>
                )}
                {pieceToDisplay.repeating_directional_ranged_attack && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Can Repeat Attack
                    {pieceToDisplay.max_directional_ranged_attack_iterations != null && 
                      ` (max ${pieceToDisplay.max_directional_ranged_attack_iterations}x)`}
                  </div>
                )}
                {pieceToDisplay.can_fire_over_enemies ? (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🎯</span>
                    Can fire over enemy pieces
                  </div>
                ) : (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🚫</span>
                    Blocked by enemy pieces
                  </div>
                )}
                {pieceToDisplay.can_fire_over_allies ? (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🎯</span>
                    Can fire over allied pieces
                  </div>
                ) : (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🚫</span>
                    Blocked by allied pieces
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Direction Change Capture */}
          {(pieceToDisplay.directional_capture_change || (pieceToDisplay.attacks_like_movement && pieceToDisplay.directional_movement_change)) && getDCCaptureDetails().length > 0 && (
            <div className={styles["ability-card"]}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>↩️</span>
                <h3>Direction Change Attack</h3>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: '0.9rem', opacity: 0.8 }}>
                This piece can turn at a via square mid-attack. After traveling its normal first leg, it pivots and continues in one of the directions below to reach its capture target (same or opposite direction not allowed).
              </p>
              <div className={styles["direction-list"]}>
                {getDCCaptureDetails().map(dir => (
                  <div key={dir.name} className={styles["direction-item"]}>
                    <span className={styles["direction-name"]}>
                      <span className={styles["direction-arrow"]}>{getDirectionArrow(dir.name)}</span>
                      {dir.name}
                    </span>
                    <span className={styles["direction-value"]}>
                      {dir.exact ? 'Exactly ' : ''}{formatMovementValue(dir.value)}
                      {dir.availableFor && <span className={styles["first-move-badge"]}> (1st {dir.availableFor} move{dir.availableFor !== 1 ? 's' : ''})</span>}
                    </span>
                  </div>
                ))}
              </div>
              <div className={styles["ability-properties"]}>
                {(pieceToDisplay.repeating_capture_change || (pieceToDisplay.attacks_like_movement && pieceToDisplay.repeating_movement_change)) && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>🔄</span>
                    Exact second-leg distances repeat infinitely
                  </div>
                )}
                {(pieceToDisplay.require_empty_via_capture || (pieceToDisplay.attacks_like_movement && pieceToDisplay.require_empty_via_movement)) && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>⬜</span>
                    Via (turning) square must be empty
                  </div>
                )}
                {(pieceToDisplay.require_direction_change_capture || (pieceToDisplay.attacks_like_movement && pieceToDisplay.require_direction_change)) && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>⚠️</span>
                    Direction change is mandatory — must turn mid-attack
                  </div>
                )}
              </div>
            </div>
          )}

          {!pieceToDisplay.can_capture_enemy_via_range && 
           !pieceToDisplay.capture_on_hop && !pieceToDisplay.can_capture_allies &&
           customAttackSquares.length === 0 &&
           !(pieceToDisplay.directional_capture_change || (pieceToDisplay.attacks_like_movement && pieceToDisplay.directional_movement_change)) &&
           (!pieceToDisplay.can_capture_enemy_on_move || (
             getDirectionalCaptureDetails().length === 0 &&
             !pieceToDisplay.ratio_one_capture && !pieceToDisplay.ratio_two_capture &&
             pieceToDisplay.step_by_step_capture == null &&
             !piece.repeating_capture
           )) && (
            <div className={styles["no-abilities"]}>
              <span className={styles["no-abilities-icon"]}>🛡️</span>
              <span>This piece cannot attack</span>
            </div>
          )}

          {/* Capture on Hop */}
          {pieceToDisplay.capture_on_hop && (
            <div className={styles["ability-card"]} style={{ borderLeftColor: '#ff9800' }}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🔄</span>
                <h3>Capture on Hop</h3>
              </div>
              <div className={styles["step-display"]}>
                When this piece hops over an enemy piece during movement, it captures the hopped-over piece (like checkers).
              </div>
              <div className={styles["ability-properties"]}>
                {pieceToDisplay.chain_capture_enabled && (
                  <div className={styles["property-tag"]}>
                    <span className={styles["property-icon"]}>⛓️</span>
                    Chain Capture — can make additional captures in the same turn (multi-jump)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Can Capture Allies */}
          {pieceToDisplay.can_capture_allies && (
            <div className={styles["ability-card"]} style={{ borderLeftColor: '#9c27b0' }}>
              <div className={styles["ability-header"]}>
                <span className={styles["ability-icon"]}>🤝</span>
                <h3>Ally Capture</h3>
              </div>
              <div className={styles["step-display"]}>
                This piece can capture friendly pieces on the same team.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Uniqueness Check Modal */}
      {uniquenessModalOpen && (
        <div
          className={styles["uniqueness-modal-overlay"]}
          onClick={() => { setUniquenessModalOpen(false); setUniquenessError(''); }}
        >
          <div className={styles["uniqueness-modal"]} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles["uniqueness-modal-title"]}>🔍 Uniqueness Check</h3>
            {uniquenessError ? (
              <p style={{ color: '#ff9090', marginBottom: '16px' }}>{uniquenessError}</p>
            ) : uniquenessMatches.length === 0 ? (
              <p style={{ color: 'var(--text-light-gray)', marginBottom: '16px' }}>
                This piece is unique! No other pieces in the database have the same ruleset.
              </p>
            ) : (
              <>
                <p style={{ color: 'var(--text-light-gray)', marginBottom: '10px' }}>
                  {uniquenessMatches.length} piece{uniquenessMatches.length !== 1 ? 's have' : ' has'} an identical ruleset:
                </p>
                <ul className={styles["uniqueness-match-list"]}>
                  {uniquenessMatches.map((m) => (
                    <li key={m.id}>
                      <Link to={`/pieces/${m.id}`} onClick={() => setUniquenessModalOpen(false)}>
                        {m.piece_name}
                      </Link>
                      {' '}
                      <span style={{ color: 'var(--text-light-gray)', fontSize: '0.85em' }}>
                        by {m.creator_username || 'Anonymous'}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <button
              type="button"
              className={styles["uniqueness-modal-close"]}
              onClick={() => { setUniquenessModalOpen(false); setUniquenessError(''); }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Piece Comparer Modal */}
      {compareModalOpen && (
        <div className={styles["uniqueness-modal-overlay"]} onClick={() => setCompareModalOpen(false)}>
          <div className={styles["compare-modal"]} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles["uniqueness-modal-title"]}>🔀 Compare Pieces</h3>
            {!compareData ? (
              <>
                <p className={styles["compare-hint"]}>
                  Search for another piece to compare with <strong>{piece?.piece_name}</strong>.
                </p>
                <input
                  type="text"
                  className={styles["compare-search-input"]}
                  placeholder="Search pieces by name…"
                  value={compareSearch}
                  onChange={(e) => setCompareSearch(e.target.value)}
                  autoFocus
                />
                {compareError && <p className={styles["compare-error"]}>{compareError}</p>}
                <div className={styles["compare-results"]}>
                  {compareSearchLoading ? (
                    <p className={styles["compare-muted"]}>Searching…</p>
                  ) : compareResults.length === 0 ? (
                    <p className={styles["compare-muted"]}>
                      {compareSearch.trim().length < 2 ? 'Type at least 2 characters to search.' : 'No pieces found.'}
                    </p>
                  ) : (
                    compareResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={styles["compare-result-item"]}
                        onClick={() => handleSelectCompare(p.id)}
                        disabled={compareLoading}
                      >
                        <span>{p.piece_name}</span>
                        {p.creator_username && <span className={styles["compare-result-by"]}>by {p.creator_username}</span>}
                      </button>
                    ))
                  )}
                  {compareLoading && <p className={styles["compare-muted"]}>Comparing…</p>}
                </div>
              </>
            ) : (
              <>
                <div className={styles["compare-header"]}>
                  <strong>{compareData.pieceA?.name}</strong> vs <strong>{compareData.pieceB?.name}</strong>
                </div>
                <div className={styles["compare-tabs"]}>
                  <button
                    type="button"
                    className={`${styles["compare-tab"]} ${compareTab === 'differences' ? styles["compare-tab-active"] : ''}`}
                    onClick={() => setCompareTab('differences')}
                  >
                    Differences ({compareData.differences.length})
                  </button>
                  <button
                    type="button"
                    className={`${styles["compare-tab"]} ${compareTab === 'similarities' ? styles["compare-tab-active"] : ''}`}
                    onClick={() => setCompareTab('similarities')}
                  >
                    Similarities ({compareData.similarities.length})
                  </button>
                </div>
                <div className={styles["compare-table"]}>
                  {compareTab === 'differences' ? (
                    compareData.differences.length === 0 ? (
                      <p className={styles["compare-muted"]}>No differences — these pieces are functionally identical.</p>
                    ) : (
                      <>
                        <div className={`${styles["compare-row"]} ${styles["compare-row-head"]}`}>
                          <span>Attribute</span>
                          <span>{compareData.pieceA?.name}</span>
                          <span>{compareData.pieceB?.name}</span>
                        </div>
                        {compareData.differences.map((d) => (
                          <div key={d.field} className={styles["compare-row"]}>
                            <span>{d.label}</span>
                            <span>{d.a}</span>
                            <span>{d.b}</span>
                          </div>
                        ))}
                      </>
                    )
                  ) : (
                    compareData.similarities.length === 0 ? (
                      <p className={styles["compare-muted"]}>No shared non-default attributes.</p>
                    ) : (
                      <>
                        <div className={`${styles["compare-row"]} ${styles["compare-row-two"]} ${styles["compare-row-head"]}`}>
                          <span>Attribute</span>
                          <span>Shared value</span>
                        </div>
                        {compareData.similarities.map((s) => (
                          <div key={s.field} className={`${styles["compare-row"]} ${styles["compare-row-two"]}`}>
                            <span>{s.label}</span>
                            <span>{s.value}</span>
                          </div>
                        ))}
                      </>
                    )
                  )}
                </div>
                <button type="button" className={styles["compare-back"]} onClick={() => { setCompareData(null); setCompareError(''); }}>
                  ← Compare another
                </button>
              </>
            )}
            <button type="button" className={styles["uniqueness-modal-close"]} onClick={() => setCompareModalOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PieceView;
