import React, { useState, useEffect, useCallback, useRef } from "react";
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./admin-dashboard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import { formatDateTime, parseServerDate } from "../../helpers/date-formatter";
import AiTrainingPanel from "./AiTrainingPanel";
import FairyStockfishPanel from "./FairyStockfishPanel";
import TrafficPanel from "./TrafficPanel";
import ConfirmDeleteModal from "../common/ConfirmDeleteModal";
import ToggleSwitch from "../common/ToggleSwitch";
import NumberInput from "../common/NumberInput";

const AdminDashboard = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const navigate = useNavigate();
  const location = useLocation();

  // Convenience flag: true when the logged-in user is Admin 2 (restricted)
  const isAdmin2 = currentUser?.role === 'admin' && currentUser?.admin_level === 2;

  // Read ?tab= and ?gameTypeId= from the URL so other pages can deep-link
  // into a specific tab (e.g. the "Request AI analysis" button on game pages).
  const urlParams = new URLSearchParams(location.search);
  const tabFromUrl = urlParams.get('tab');
  const gameTypeIdFromUrl = urlParams.get('gameTypeId');

  const [activeTab, setActiveTab] = useState(tabFromUrl || "users");
  const [aiPanelInitialGameTypeId] = useState(gameTypeIdFromUrl ? parseInt(gameTypeIdFromUrl, 10) : null);
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [userSort, setUserSort] = useState({ sortBy: 'id', sortOrder: 'DESC' });
  const [loading, setLoading] = useState(true);
  // Users tab search
  const [userSearch, setUserSearch] = useState('');
  const userSearchRef = useRef('');
  const [editingItem, setEditingItem] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editFormData, setEditFormData] = useState({});
  const [alertMessage, setAlertMessage] = useState("");
  const [alertType, setAlertType] = useState(""); // "success" or "error"
  const [showAlert, setShowAlert] = useState(false);
  
  // Ban system states
  const [showBanModal, setShowBanModal] = useState(false);
  const [banningUser, setBanningUser] = useState(null);
  const [banReason, setBanReason] = useState("");
  const [banExpiration, setBanExpiration] = useState("");
  const [isPermanentBan, setIsPermanentBan] = useState(true);

  // Donor badge states
  const [showDonorModal, setShowDonorModal] = useState(false);
  const [donorUser, setDonorUser] = useState(null);
  const [donorAmount, setDonorAmount] = useState('');
  const [donorHideBadge, setDonorHideBadge] = useState(false);
  const donorOverlayMouseDown = useRef(false);

  // Delete account confirm modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingDeleteUser, setPendingDeleteUser] = useState(null);

  // Promote-to-admin modal (choose Admin 1 vs Admin 2)
  const [showPromoteModal, setShowPromoteModal] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState(null);
  const [promoteLevel, setPromoteLevel] = useState(1);
  
  // Featured games states
  const [featuredGames, setFeaturedGames] = useState(Array(9).fill(null)); // 9 slots
  const [availableGames, setAvailableGames] = useState([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);

  // Community stream channels state (user-registered Twitch channels)
  const [adminUserStreams, setAdminUserStreams] = useState([]);
  const [adminUserStreamsLoading, setAdminUserStreamsLoading] = useState(false);

  // Site settings state
  const [siteSettings, setSiteSettings] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  // Draft state for the editable forum-invite text (so admins can type without saving on every keystroke)
  const [forumInviteDraft, setForumInviteDraft] = useState('');
  const [savingForumInvite, setSavingForumInvite] = useState(false);
  const [twitchClientIdDraft, setTwitchClientIdDraft] = useState('');
  const [twitchClientSecretDraft, setTwitchClientSecretDraft] = useState('');
  const [savingTwitchCreds, setSavingTwitchCreds] = useState(false);
  const [twitchCredsSaved, setTwitchCredsSaved] = useState(false);
  const [twitchCredsError, setTwitchCredsError] = useState('');
  // About Us editor state — drafts are local until "Save" is clicked.
  // Mission is plain text (paragraphs separated by blank lines). Team is
  // a JSON array of { username, profile_link, role, contribution,
  // picture_url } capped at 20 entries.
  const ABOUT_TEAM_MAX = 20;
  const ABOUT_GOALS_MAX = 6;
  const DEFAULT_ABOUT_GOALS = [
    { icon: '🏆', title: 'Global Tournaments', description: 'Expand our tournament system to support large-scale competitive events with prizes and rankings across multiple game variants.' },
    { icon: '🤖', title: 'AI Opponents', description: 'Develop AI that can learn and play any custom game variant, giving players practice partners and solo play options.' },
    { icon: '📱', title: 'Mobile App', description: 'Bring GridGrove to iOS and Android so players can create, share, and play on the go.' },
    { icon: '📚', title: 'Educational Tools', description: 'Build resources for educators to use GridGrove as a teaching tool for logic, strategy, and game design.' },
    { icon: '♟️', title: 'More Games', description: 'Add support for Shogi, Go, Duck Chess, Bughouse, Othello, and other grid-based board games.' },
    { icon: '🌍', title: 'Community Growth', description: 'Grow the GridGrove community worldwide with events, leaderboards, and creator spotlights.' },
  ];
  const [aboutMissionDraft, setAboutMissionDraft] = useState('');
  const [aboutTeamDraft, setAboutTeamDraft] = useState([]);
  const [aboutGoalsDraft, setAboutGoalsDraft] = useState(DEFAULT_ABOUT_GOALS);
  const [savingAboutMission, setSavingAboutMission] = useState(false);
  const [savingAboutTeam, setSavingAboutTeam] = useState(false);
  const [savingAboutGoals, setSavingAboutGoals] = useState(false);
  const [aboutTeamUploadingIdx, setAboutTeamUploadingIdx] = useState(null);

  // Initial-state scan tool: lists game types whose starting position is
  // already in a decided state (checkmate, stalemate, capture-condition met,
  // etc.). The Run Scan button validates every published game and updates
  // the persisted warning column.
  const [initialStateLoading, setInitialStateLoading] = useState(false);
  const [initialStateScanning, setInitialStateScanning] = useState(false);
  const [initialStateFlagged, setInitialStateFlagged] = useState([]);
  const [initialStateScanSummary, setInitialStateScanSummary] = useState(null);

  // Moderation queue state
  const [moderationQueue, setModerationQueue] = useState([]);
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationFilter, setModerationFilter] = useState('pending_review');

  // Name review queue state
  const [nameReviewQueue, setNameReviewQueue] = useState([]);
  const [nameReviewLoading, setNameReviewLoading] = useState(false);
  const [nameReviewFilter, setNameReviewFilter] = useState('pending_review');

  // Online players state
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [onlineLoading, setOnlineLoading] = useState(false);

  // Draft detail modal state
  const [viewingDraft, setViewingDraft] = useState(null);

  // Server stats state
  const [serverStats, setServerStats] = useState(null);
  const [serverStatsLoading, setServerStatsLoading] = useState(false);
  const [serverStatsError, setServerStatsError] = useState(null);

  // Storage stats state
  const [storageStats, setStorageStats] = useState(null);
  const [storageStatsLoading, setStorageStatsLoading] = useState(false);
  const [storageStatsError, setStorageStatsError] = useState(null);
  const [frontendStorageStats, setFrontendStorageStats] = useState(null);
  const [frontendStorageStatsError, setFrontendStorageStatsError] = useState(null);

  // AI Analysis Requests state
  const [aiAnalysisRequests, setAiAnalysisRequests] = useState([]);
  const [aiAnalysisRequestsLoading, setAiAnalysisRequestsLoading] = useState(false);
  const [aiAnalysisRequestsFilter, setAiAnalysisRequestsFilter] = useState('pending');
  const [aiAnalysisRequestsPagination, setAiAnalysisRequestsPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 });

  // Poll admin state
  const [polls, setPolls] = useState([]);
  const [pollsLoading, setPollsLoading] = useState(false);
  const [pollResults, setPollResults] = useState(null); // { poll, results, totalVotes }
  const [pollResultsLoading, setPollResultsLoading] = useState(false);
  const [pollForm, setPollForm] = useState({ question: '', options: ['', ''], is_visible: false, expires_at: '' });
  const [pollSaving, setPollSaving] = useState(false);
  const [editingPollId, setEditingPollId] = useState(null);

  // User growth state
  const [userGrowthData, setUserGrowthData] = useState(null);
  const [userGrowthView, setUserGrowthView] = useState('weekly');
  const [userGrowthLoading, setUserGrowthLoading] = useState(false);
  const [userGrowthError, setUserGrowthError] = useState(null);
  const [userGrowthHover, setUserGrowthHover] = useState(null);

  // Physical Board Requests state
  const [physicalBoardRequests, setPhysicalBoardRequests] = useState([]);
  const [physicalBoardRequestsLoading, setPhysicalBoardRequestsLoading] = useState(false);
  const [physicalBoardRequestsFilter, setPhysicalBoardRequestsFilter] = useState('pending');
  const [physicalBoardRequestsPagination, setPhysicalBoardRequestsPagination] = useState({ page: 1, limit: 25, total: 0, totalPages: 0 });

  // Feature TODO state
  const [featureTodoItems, setFeatureTodoItems] = useState([]);
  const [featureTodoLoading, setFeatureTodoLoading] = useState(false);
  const [featureTodoFilter, setFeatureTodoFilter] = useState('all');
  const [featureTodoForm, setFeatureTodoForm] = useState({ title: '', description: '' });
  const [featureTodoSaving, setFeatureTodoSaving] = useState(false);
  const [featureTodoEditingId, setFeatureTodoEditingId] = useState(null);

  // Restriction modal state
  const [showRestrictModal, setShowRestrictModal] = useState(false);
  const [restrictTarget, setRestrictTarget] = useState(null);
  const [restrictReason, setRestrictReason] = useState('');
  const [savingRestrict, setSavingRestrict] = useState(false);

  // Auto-hide alert after 2 seconds
  useEffect(() => {
    let timer;
    if (showAlert) {
      timer = setTimeout(() => {
        setShowAlert(false);
        setAlertMessage('');
        setAlertType("");
      }, 2000);
    }
    return () => clearTimeout(timer);
  }, [showAlert]);

  const fetchData = useCallback(async (tab, page = 1, sortOverride) => {
    setLoading(true);
    try {
      const limit = pagination?.limit || 10;
      const sort = sortOverride || userSort;
      const sortParams = tab === 'users' ? `&sortBy=${sort.sortBy}&sortOrder=${sort.sortOrder}` : '';
      const searchParam = tab === 'users' && userSearchRef.current
        ? `&search=${encodeURIComponent(userSearchRef.current)}`
        : '';
      const response = await axios.get(
        `${API_URL}admin/${tab}?page=${page}&limit=${limit}${sortParams}${searchParam}`,
        { headers: authHeader() }
      );
      setData(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error(`Error fetching ${tab}:`, error);
      
      // Handle expired token
      if (error.response?.status === 403 || error.response?.status === 401) {
        setAlertMessage('Session expired. Please log in again.');
        setAlertType('error');
        setShowAlert(true);
        setTimeout(() => {
          navigate('/login');
        }, 2000);
      } else {
        setAlertMessage(`Failed to load ${tab}`);
        setAlertType('error');
        setShowAlert(true);
      }
    } finally {
      setLoading(false);
    }
  }, [pagination?.limit, navigate, userSort]);

  useEffect(() => {
    if (activeTab === 'featured') {
      fetchFeaturedGames();
    } else if (activeTab === 'anonymous-games') {
      fetchAnonymousGames(1);
    } else if (activeTab === 'private-games') {
      fetchPrivateGames(1);
    } else if (activeTab === 'deleted-users') {
      fetchDeletedUsers(1);
    } else if (activeTab === 'settings') {
      fetchSiteSettings();
    } else if (activeTab === 'online') {
      fetchOnlinePlayers();
    } else if (activeTab === 'moderation') {
      fetchModerationQueue(moderationFilter);
    } else if (activeTab === 'name-reviews') {
      fetchNameReviewQueue(nameReviewFilter);
    } else if (activeTab === 'server-stats') {
      fetchServerStats();
    } else if (activeTab === 'ai-training') {
      // AiTrainingPanel manages its own data; nothing to do here.
      setLoading(false);
    } else if (activeTab === 'initial-state') {
      setLoading(false);
      fetchInitialStateFlagged();
    } else if (activeTab === 'ai-analysis-requests') {
      setLoading(false);
      fetchAiAnalysisRequests(1, aiAnalysisRequestsFilter);
    } else if (activeTab === 'user-growth') {
      setLoading(false);
      fetchUserGrowth(userGrowthView);
    } else if (activeTab === 'physical-board-requests') {
      setLoading(false);
      fetchPhysicalBoardRequests(1, physicalBoardRequestsFilter);
    } else if (activeTab === 'feature-todo') {
      setLoading(false);
      fetchFeatureTodoItems();
    } else if (activeTab === 'fairy-stockfish') {
      // FairyStockfishPanel manages its own data fetching; nothing to do here.
      setLoading(false);
    } else if (activeTab === 'traffic') {
      // TrafficPanel manages its own data fetching.
      setLoading(false);
    } else {
      fetchData(activeTab, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fetchData]);

  const fetchAnonymousGames = async (page = 1) => {
    setLoading(true);
    try {
      const limit = pagination?.limit || 10;
      const response = await axios.get(
        `${API_URL}admin/anonymous-games?page=${page}&limit=${limit}`,
        { headers: authHeader() }
      );
      setData(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error("Error fetching anonymous games:", error);
      setAlertMessage("Failed to load anonymous games");
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchPrivateGames = async (page = 1) => {
    setLoading(true);
    try {
      const limit = pagination?.limit || 25;
      const response = await axios.get(
        `${API_URL}admin/private-games?page=${page}&limit=${limit}`,
        { headers: authHeader() }
      );
      setData(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error("Error fetching private games:", error);
      setAlertMessage("Failed to load private games");
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeletedUsers = async (page = 1) => {
    setLoading(true);
    try {
      const limit = pagination?.limit || 25;
      const response = await axios.get(
        `${API_URL}admin/deleted-users?page=${page}&limit=${limit}`,
        { headers: authHeader() }
      );
      setData(response.data.data);
      setPagination(response.data.pagination);
    } catch (error) {
      console.error("Error fetching deleted users:", error);
      setAlertMessage("Failed to load deleted users");
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setLoading(false);
    }
  };

  const fetchSiteSettings = async () => {
    setSettingsLoading(true);
    try {
      const response = await axios.get(
        `${API_URL}admin/site-settings`,
        { headers: authHeader() }
      );
      const map = {};
      (response.data.settings || []).forEach(s => { map[s.setting_key] = s.setting_value; });
      setSiteSettings(map);
      // Seed the editable draft with the loaded value (only if not already dirty)
      if (map.forum_invite_text !== undefined) {
        setForumInviteDraft(map.forum_invite_text);
      }
      if (map.about_mission_text !== undefined) {
        setAboutMissionDraft(map.about_mission_text || '');
      }
      if (map.about_team_members !== undefined) {
        try {
          const parsed = JSON.parse(map.about_team_members);
          if (Array.isArray(parsed)) setAboutTeamDraft(parsed.slice(0, ABOUT_TEAM_MAX));
        } catch (_) { setAboutTeamDraft([]); }
      }
      if (map.about_future_goals !== undefined) {
        try {
          const parsed = JSON.parse(map.about_future_goals);
          if (Array.isArray(parsed) && parsed.length > 0) setAboutGoalsDraft(parsed.slice(0, ABOUT_GOALS_MAX));
        } catch (_) { /* keep defaults */ }
      }
    } catch (error) {
      console.error("Error fetching site settings:", error);
    } finally {
      setSettingsLoading(false);
    }
  };

  const fetchOnlinePlayers = async () => {
    setOnlineLoading(true);
    try {
      const response = await axios.get(
        `${API_URL}admin/online-players?_=${Date.now()}`,
        { headers: authHeader() }
      );
      setOnlinePlayers(response.data.data || []);
    } catch (error) {
      console.error("Error fetching online players:", error);
    } finally {
      setOnlineLoading(false);
    }
  };

  const fetchServerStats = async () => {
    setServerStatsLoading(true);
    setServerStatsError(null);
    const url = `${API_URL}admin/memory-stats`;
    try {
      const response = await axios.get(url, { headers: authHeader() });
      const data = response?.data;
      // Validate that the response is actually JSON from our endpoint.
      // If a dev proxy returns HTML, axios will hand us a string.
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        const preview = typeof data === 'string' ? data.slice(0, 200) : String(data);
        throw new Error(`Endpoint returned non-JSON. URL: ${url}. Response preview: ${preview}`);
      }
      if (data.uptimeSeconds == null && data.memory == null && data.activeGames == null) {
        // Likely a rate-limit (429 returned as JSON {message}) or other server message.
        // Surface the message directly so the user knows what happened.
        if (data.message) {
          throw new Error(`Server responded with: "${data.message}" (URL: ${url}). This is often the rate limiter — wait a few minutes and try again.`);
        }
        throw new Error(`Endpoint returned JSON without expected fields. URL: ${url}. Keys: ${Object.keys(data).join(', ') || '(none)'}`);
      }
      setServerStats({ ...data, _fetchedAt: Date.now() });
    } catch (error) {
      console.error("Error fetching server stats:", error);
      const status = error?.response?.status;
      const serverMsg = error?.response?.data?.message || error?.response?.data?.error || error?.message;
      let msg = `Failed to load server stats from ${url}`;
      if (status === 404) {
        msg = `Endpoint not found (404) at ${url}. Backend may need to be restarted to pick up the new /api/admin/memory-stats route.`;
      } else if (status === 401 || status === 403) {
        msg = `Unauthorized (${status}) at ${url}. You need to be logged in as admin/owner.`;
      } else if (status) {
        msg = `Failed to load server stats (HTTP ${status}) from ${url}${serverMsg ? `: ${serverMsg}` : ''}`;
      } else if (serverMsg) {
        msg = `Failed to load from ${url}: ${serverMsg}`;
      }
      setServerStatsError(msg);
    } finally {
      setServerStatsLoading(false);
    }
  };

  const fetchStorageStats = async () => {
    setStorageStatsLoading(true);
    setStorageStatsError(null);
    setFrontendStorageStats(null);
    setFrontendStorageStatsError(null);
    try {
      const [backendRes, frontendRes] = await Promise.allSettled([
        axios.get(`${API_URL}admin/storage-stats`, { headers: authHeader() }),
        axios.get(`${API_URL}admin/remote-storage-stats`, { headers: authHeader() }),
      ]);
      if (backendRes.status === 'fulfilled') {
        setStorageStats({ ...backendRes.value.data, _fetchedAt: Date.now() });
      } else {
        const err = backendRes.reason;
        const status = err?.response?.status;
        const msg = err?.response?.data?.error || err?.message;
        setStorageStatsError(`Failed to load backend stats${status ? ` (HTTP ${status})` : ''}${msg ? `: ${msg}` : ''}`);
      }
      if (frontendRes.status === 'fulfilled') {
        setFrontendStorageStats({ ...frontendRes.value.data, _fetchedAt: Date.now() });
      } else {
        const err = frontendRes.reason;
        const status = err?.response?.status;
        const msg = err?.response?.data?.error || err?.message;
        setFrontendStorageStatsError(
          status === 503
            ? 'Set FRONTEND_EC2_URL in backend .env to enable cross-instance stats'
            : `Could not reach frontend EC2${status ? ` (HTTP ${status})` : ''}${msg ? `: ${msg}` : ''}`
        );
      }
    } finally {
      setStorageStatsLoading(false);
    }
  };

  const fetchModerationQueue = async (status = 'pending_review') => {
    setModerationLoading(true);
    try {
      const response = await axios.get(
        `${API_URL}admin/moderation-queue?status=${status}`,
        { headers: authHeader() }
      );
      setModerationQueue(response.data.items || []);
    } catch (error) {
      console.error("Error fetching moderation queue:", error);
    } finally {
      setModerationLoading(false);
    }
  };

  const handleModerationApprove = async (itemId) => {
    try {
      await axios.post(
        `${API_URL}admin/moderation-queue/${itemId}/approve`,
        {},
        { headers: authHeader() }
      );
      setAlertMessage("Image approved");
      setAlertType("success");
      setShowAlert(true);
      fetchModerationQueue(moderationFilter);
    } catch (error) {
      console.error("Error approving item:", error);
      setAlertMessage("Failed to approve image");
      setAlertType("error");
      setShowAlert(true);
    }
  };

  const handleModerationReject = async (itemId) => {
    try {
      await axios.post(
        `${API_URL}admin/moderation-queue/${itemId}/reject`,
        {},
        { headers: authHeader() }
      );
      setAlertMessage("Image rejected and removed");
      setAlertType("success");
      setShowAlert(true);
      fetchModerationQueue(moderationFilter);
    } catch (error) {
      console.error("Error rejecting item:", error);
      setAlertMessage("Failed to reject image");
      setAlertType("error");
      setShowAlert(true);
    }
  };

  const handleApproveAllForPiece = async (pieceId) => {
    try {
      const itemsForPiece = moderationQueue.filter(q => q.piece_id === pieceId);
      for (const item of itemsForPiece) {
        await axios.post(
          `${API_URL}admin/moderation-queue/${item.id}/approve`,
          {},
          { headers: authHeader() }
        );
      }
      setAlertMessage("All images for piece approved");
      setAlertType("success");
      setShowAlert(true);
      fetchModerationQueue(moderationFilter);
    } catch (error) {
      console.error("Error approving piece:", error);
      setAlertMessage("Failed to approve piece images");
      setAlertType("error");
      setShowAlert(true);
    }
  };

  const fetchNameReviewQueue = async (status = 'pending_review') => {
    setNameReviewLoading(true);
    try {
      const response = await axios.get(
        `${API_URL}admin/name-review-queue?status=${status}`,
        { headers: authHeader() }
      );
      setNameReviewQueue(response.data.items || []);
    } catch (error) {
      console.error("Error fetching name review queue:", error);
    } finally {
      setNameReviewLoading(false);
    }
  };

  const handleNameReviewApprove = async (itemId) => {
    try {
      await axios.post(
        `${API_URL}admin/name-review-queue/${itemId}/approve`,
        {},
        { headers: authHeader() }
      );
      setAlertMessage("Name approved — item is now publicly visible");
      setAlertType("success");
      setShowAlert(true);
      fetchNameReviewQueue(nameReviewFilter);
    } catch (error) {
      console.error("Error approving name:", error);
      setAlertMessage("Failed to approve name");
      setAlertType("error");
      setShowAlert(true);
    }
  };

  const handleNameReviewReject = async (itemId) => {
    try {
      await axios.post(
        `${API_URL}admin/name-review-queue/${itemId}/reject`,
        {},
        { headers: authHeader() }
      );
      setAlertMessage("Name rejected — creator has been notified to rename");
      setAlertType("success");
      setShowAlert(true);
      fetchNameReviewQueue(nameReviewFilter);
    } catch (error) {
      console.error("Error rejecting name:", error);
      setAlertMessage("Failed to reject name");
      setAlertType("error");
      setShowAlert(true);
    }
  };

  const updateSiteSetting = async (key, value) => {
    const stringValue = String(value);
    const previousSettings = { ...siteSettings };
    // Optimistic update: apply immediately so UI responds to the click
    setSiteSettings(prev => ({ ...prev, [key]: stringValue }));
    try {
      await axios.put(
        `${API_URL}admin/site-settings/${key}`,
        { value: stringValue },
        { headers: authHeader() }
      );
      setAlertMessage(`Setting "${key}" updated`);
      setAlertType('success');
      setShowAlert(true);
    } catch (error) {
      console.error("Error updating site setting:", error);
      // Revert on failure
      setSiteSettings(previousSettings);
      setAlertMessage("Failed to update setting");
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const fetchFeaturedGames = async () => {
    setFeaturedLoading(true);
    try {
      const response = await axios.get(
        `${API_URL}admin/featured-games`,
        { headers: authHeader() }
      );
      const { featured, allGames } = response.data;
      
      // Build the 9 slots array
      const slots = Array(9).fill(null);
      featured.forEach(game => {
        if (game.featured_order >= 1 && game.featured_order <= 9) {
          slots[game.featured_order - 1] = game;
        }
      });
      
      setFeaturedGames(slots);
      setAvailableGames(allGames);
    } catch (error) {
      console.error("Error fetching featured games:", error);
      setAlertMessage("Failed to load featured games");
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setFeaturedLoading(false);
    }
  };

  const handleFeaturedGameChange = (slotIndex, gameId) => {
    const newFeatured = [...featuredGames];
    if (gameId === '') {
      newFeatured[slotIndex] = null;
    } else {
      const game = availableGames.find(g => g.id === parseInt(gameId));
      newFeatured[slotIndex] = game || null;
    }
    setFeaturedGames(newFeatured);
  };

  const saveFeaturedGames = async () => {
    try {
      const featuredGameIds = featuredGames.map(g => g?.id || null);
      await axios.put(
        `${API_URL}admin/featured-games`,
        { featuredGameIds },
        { headers: authHeader() }
      );
      setAlertMessage("Featured games saved successfully");
      setAlertType('success');
      setShowAlert(true);
    } catch (error) {
      console.error("Error saving featured games:", error);
      setAlertMessage("Failed to save featured games");
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    // Clear stale data and pagination so tabs that fail to load don't show
    // leftovers from the previously-viewed tab.
    setData([]);
    setPagination({ page: 1, limit: 10, total: 0, totalPages: 0 });
    // Pre-emptively show the loading spinner for any tab that drives itself
    // through the shared fetchData / fetchAnonymousGames / etc. path. Without
    // this there is a one-render flash of "No X found" between the tab click
    // and the moment the fetch sets loading = true.
    const loadingTabs = new Set([
      'users', 'pieces', 'games', 'drafts', 'forums', 'news',
      'anonymous-games', 'private-games', 'deleted-users',
    ]);
    if (loadingTabs.has(tab)) setLoading(true);
    if (tab === 'poll') fetchPolls();
    if (tab === 'streams') fetchAdminUserStreams();
  };

  const handlePageChange = (newPage) => {
    if (activeTab === 'anonymous-games') {
      fetchAnonymousGames(newPage);
    } else if (activeTab === 'private-games') {
      fetchPrivateGames(newPage);
    } else if (activeTab === 'deleted-users') {
      fetchDeletedUsers(newPage);
    } else {
      fetchData(activeTab, newPage);
    }
  };

  const handleEdit = (item) => {
    setEditingItem(item);
    setEditFormData({ ...item });
    setShowEditModal(true);
  };

  const handleInputChange = (field, value) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    try {
      const endpoint = `${API_URL}admin/${activeTab}/${editingItem.id}`;
      await axios.put(endpoint, editFormData, { headers: authHeader() });
      
      setAlertMessage(`${activeTab.slice(0, -1)} updated successfully`);
      setAlertType('success');
      setShowAlert(true);
      setShowEditModal(false);
      setEditingItem(null);
      fetchData(activeTab, pagination.page);
    } catch (error) {
      console.error("Error updating item:", error);
      setAlertMessage("Failed to update: " + (error.response?.data?.message || error.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const handleCreateNews = () => {
    navigate('/news/new');
  };

  const handleDeleteItem = async (item, type) => {
    const name = type === 'pieces' ? item.piece_name : item.game_name;
    if (!window.confirm(`Are you sure you want to delete "${name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await axios.delete(
        `${API_URL}${type}/${item.id}`,
        { headers: authHeader() }
      );

      setAlertMessage(`${type === 'pieces' ? 'Piece' : 'Game'} "${name}" deleted successfully`);
      setAlertType('success');
      setShowAlert(true);
      fetchData(activeTab, pagination.page);
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
      setAlertMessage(`Failed to delete: ${error.response?.data?.message || error.message}`);
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const handleDeleteForum = async (forum) => {
    let message = `Are you sure you want to delete the forum "${forum.title}"?`;
    if (forum.game_name) {
      message += `\n\nWarning: This forum is associated with the game "${forum.game_name}" which still exists.`;
    }
    message += '\n\nThis action cannot be undone.';
    if (!window.confirm(message)) return;

    try {
      await axios.post(
        `${API_URL}forums/delete`,
        { id: forum.id },
        { headers: authHeader() }
      );
      setAlertMessage(`Forum "${forum.title}" deleted successfully`);
      setAlertType('success');
      setShowAlert(true);
      fetchData(activeTab, pagination.page);
    } catch (error) {
      console.error('Error deleting forum:', error);
      setAlertMessage(`Failed to delete forum: ${error.response?.data?.message || error.message}`);
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const handleDeleteNews = async (newsItem) => {
    if (!window.confirm(`Are you sure you want to delete the news article "${newsItem.title}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await axios.delete(
        `${API_URL}news/${newsItem.id}`,
        { headers: authHeader() }
      );
      setAlertMessage(`News article "${newsItem.title}" deleted successfully`);
      setAlertType('success');
      setShowAlert(true);
      fetchData(activeTab, pagination.page);
    } catch (error) {
      console.error('Error deleting news:', error);
      setAlertMessage(`Failed to delete news: ${error.response?.data?.message || error.message}`);
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const renderPagination = () => {
    if (!pagination || !pagination.totalPages) {
      return null;
    }

    const pages = [];
    for (let i = 1; i <= pagination.totalPages; i++) {
      pages.push(
        <button
          key={i}
          className={`${styles["page-button"]} ${pagination.page === i ? styles["active"] : ""}`}
          onClick={() => handlePageChange(i)}
          disabled={loading}
        >
          {i}
        </button>
      );
    }

    return (
      <div className={styles["pagination"]}>
        <button
          className={styles["page-button"]}
          onClick={() => handlePageChange(pagination.page - 1)}
          disabled={pagination.page === 1 || loading}
        >
          ← Previous
        </button>
        {pages}
        <button
          className={styles["page-button"]}
          onClick={() => handlePageChange(pagination.page + 1)}
          disabled={pagination.page === pagination.totalPages || loading}
        >
          Next →
        </button>
        <span className={styles["page-info"]}>
          Showing {data.length} of {pagination.total} items
        </span>
      </div>
    );
  };

  // User management functions
  const handleBanClick = (user) => {
    setBanningUser(user);
    setBanReason("");
    setBanExpiration("");
    setIsPermanentBan(true);
    setShowBanModal(true);
  };

  const handleBanSubmit = async () => {
    if (!banReason.trim()) {
      setAlertType("error");
      setAlertMessage("Ban reason is required");
      setShowAlert(true);
      return;
    }

    try {
      await axios.post(
        `${API_URL}admin/users/${banningUser.id}/ban`,
        {
          reason: banReason,
          expiresAt: isPermanentBan ? null : banExpiration
        },
        { headers: authHeader() }
      );

      setAlertType("success");
      setAlertMessage(`User ${banningUser.username} has been banned`);
      setShowAlert(true);
      setShowBanModal(false);
      fetchData(activeTab, pagination.page);
    } catch (err) {
      setAlertType("error");
      setAlertMessage(err.response?.data?.message || "Failed to ban user");
      setShowAlert(true);
    }
  };

  const handleUnban = async (user) => {
    if (!window.confirm(`Are you sure you want to unban ${user.username}?`)) {
      return;
    }

    try {
      await axios.post(
        `${API_URL}admin/users/${user.id}/unban`,
        {},
        { headers: authHeader() }
      );

      setAlertType("success");
      setAlertMessage(`User ${user.username} has been unbanned`);
      setShowAlert(true);
      fetchData(activeTab, pagination.page);
    } catch (err) {
      setAlertType("error");
      setAlertMessage(err.response?.data?.message || "Failed to unban user");
      setShowAlert(true);
    }
  };

  const handlePromote = (user) => {
    setPromoteTarget(user);
    setPromoteLevel(1);
    setShowPromoteModal(true);
  };

  const handlePromoteConfirm = async () => {
    if (!promoteTarget) return;
    setShowPromoteModal(false);
    try {
      await axios.post(
        `${API_URL}admin/users/${promoteTarget.id}/promote`,
        { admin_level: promoteLevel },
        { headers: authHeader() }
      );

      setAlertType("success");
      setAlertMessage(`User ${promoteTarget.username} has been promoted to Admin ${promoteLevel}`);
      setShowAlert(true);
      setPromoteTarget(null);
      fetchData(activeTab, pagination.page);
    } catch (err) {
      setAlertType("error");
      setAlertMessage(err.response?.data?.message || "Failed to promote user");
      setShowAlert(true);
      setPromoteTarget(null);
    }
  };

  const handleDemote = async (user) => {
    if (!window.confirm(`Are you sure you want to demote ${user.username} to regular user?`)) {
      return;
    }

    try {
      await axios.post(
        `${API_URL}admin/users/${user.id}/demote`,
        {},
        { headers: authHeader() }
      );

      setAlertType("success");
      setAlertMessage(`Admin ${user.username} has been demoted to user`);
      setShowAlert(true);
      fetchData(activeTab, pagination.page);
    } catch (err) {
      setAlertType("error");
      setAlertMessage(err.response?.data?.message || "Failed to demote admin");
      setShowAlert(true);
    }
  };

  const handleDonorClick = (user) => {
    setDonorUser(user);
    setDonorAmount(user.total_donations != null ? String(user.total_donations) : '');
    setDonorHideBadge(user.hide_donation_badge === 1 || user.hide_donation_badge === true);
    setShowDonorModal(true);
  };

  const handleDonorSubmit = async () => {
    const amount = parseFloat(donorAmount);
    if (isNaN(amount) || amount < 0) {
      setAlertType('error');
      setAlertMessage('Please enter a valid amount (0 to remove badge)');
      setShowAlert(true);
      return;
    }
    try {
      await axios.post(
        `${API_URL}admin/users/${donorUser.id}/set-donations`,
        { amount, hide_donation_badge: donorHideBadge },
        { headers: authHeader() }
      );
      setAlertType('success');
      const tier = amount >= 50 ? '⭐ Gold' : amount >= 5 ? '❖ Silver' : 'removed';
      setAlertMessage(`Donor badge ${tier} for ${donorUser.username}`);
      setShowAlert(true);
      setShowDonorModal(false);
      fetchData(activeTab, pagination.page);
    } catch (err) {
      setAlertType('error');
      setAlertMessage(err.response?.data?.message || 'Failed to update donor badge');
      setShowAlert(true);
    }
  };

  const handleDeleteUser = (user) => {
    setPendingDeleteUser(user);
    setShowDeleteConfirm(true);
  };

  const handleDeleteUserConfirmed = async () => {
    const user = pendingDeleteUser;
    setShowDeleteConfirm(false);
    setPendingDeleteUser(null);
    if (!user) return;
    try {
      await axios.post(
        `${API_URL}delete`,
        { username: user.username, admin_id: currentUser.id },
        { headers: authHeader() }
      );
      setAlertType("success");
      setAlertMessage(`User "${user.username}" has been permanently deleted`);
      setShowAlert(true);
      fetchData(activeTab, pagination.page);
    } catch (err) {
      setAlertType("error");
      setAlertMessage(err.response?.data?.message || "Failed to delete user");
      setShowAlert(true);
    }
  };

  // Format last_active_at timestamp into MM/DD/YYYY h:mm am/pm in admin's local timezone
  const formatLastActive = (raw) => {
    try {
      const d = parseServerDate(raw);
      if (!d || isNaN(d.getTime())) return 'Never';
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      return `${month}/${day}/${year} ${hours}:${minutes}${ampm}`;
    } catch {
      return 'Never';
    }
  };

  const handleUserSort = (field) => {
    const newSort = userSort.sortBy === field
      ? { sortBy: field, sortOrder: userSort.sortOrder === 'ASC' ? 'DESC' : 'ASC' }
      : { sortBy: field, sortOrder: field === 'username' ? 'ASC' : 'DESC' };
    setUserSort(newSort);
    fetchData('users', 1, newSort);
  };

  const sortArrow = (field) => {
    if (userSort.sortBy !== field) return <span style={{ opacity: 0.3, fontSize: '0.75em' }}> ↕</span>;
    return <span style={{ fontSize: '0.75em' }}> {userSort.sortOrder === 'ASC' ? '↑' : '↓'}</span>;
  };

  const handleUserSearchSubmit = (e) => {
    if (e) e.preventDefault();
    userSearchRef.current = userSearch.trim();
    fetchData('users', 1);
  };

  const handleUserSearchClear = () => {
    setUserSearch('');
    userSearchRef.current = '';
    fetchData('users', 1);
  };

  const renderUsersTable = () => (
    <div className={styles["table-container"]}>
      <form
        onSubmit={handleUserSearchSubmit}
        style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          type="text"
          value={userSearch}
          onChange={(e) => setUserSearch(e.target.value)}
          placeholder="Search by username or email..."
          style={{
            flex: '1 1 240px',
            minWidth: '200px',
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-color, #444)',
            background: 'var(--bg-input, #1e1e1e)',
            color: 'var(--text-light, #eee)'
          }}
        />
        <button type="submit" className={styles["promote-btn"]}>Search</button>
        {userSearchRef.current ? (
          <button type="button" className={styles["cancel-btn"]} onClick={handleUserSearchClear}>Clear</button>
        ) : null}
      </form>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th
              onClick={() => handleUserSort('id')}
              style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              title="Sort by ID"
            >ID{sortArrow('id')}</th>
            <th
              onClick={() => handleUserSort('username')}
              style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              title="Sort by username"
            >Username{sortArrow('username')}</th>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>ELO</th>
            <th
              onClick={() => handleUserSort('last_active_at')}
              style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
              title="Sort by last active"
            >Last Active{sortArrow('last_active_at')}</th>
            <th>Donor</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No users found'}
              </td>
            </tr>
          ) : (
            data.map(user => (
            <tr key={user.id}>
              <td>{user.id}</td>
              <td><Link to={`/profile/${user.username}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{user.username}</Link></td>
              <td>{user.email || 'N/A'}</td>
              <td>{`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'N/A'}</td>
              <td>
                <span className={styles[`role-${user.role?.toLowerCase() || 'user'}`]}>
                  {user.role?.toUpperCase() || 'USER'}
                </span>
              </td>
              <td>
                {user.banned ? (
                  <span className={styles["status-banned"]}>
                    BANNED
                    {user.ban_expires_at && (
                      <span style={{ fontSize: '0.8em', display: 'block' }}>
                        Until {parseServerDate(user.ban_expires_at).toLocaleDateString()}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className={styles["status-active"]}>ACTIVE</span>
                )}
              </td>
              <td>{user.elo || 1000}</td>
              <td style={{ whiteSpace: 'nowrap', fontSize: '0.85em', color: 'var(--text-light-gray)' }}>
                {user.last_active_at ? formatLastActive(user.last_active_at) : 'Never'}
              </td>
              <td style={{ whiteSpace: 'nowrap', fontSize: '0.85em' }}>
                <div>
                  {Number(user.total_donations) >= 50
                    ? '⭐ Gold'
                    : Number(user.total_donations) >= 5
                      ? '✦ Silver'
                      : 'None'}
                  {Number(user.total_donations) > 0 && (
                    <span style={{ color: 'var(--text-dim)' }}> (${Number(user.total_donations).toFixed(2)})</span>
                  )}
                </div>
                {(user.hide_donation_badge === 1 || user.hide_donation_badge === true) && (
                  <div style={{ color: '#e0a93b', fontSize: '0.9em' }} title="This user donated anonymously, so their badge is hidden on their profile.">
                    Anonymous (badge hidden)
                  </div>
                )}
              </td>
              <td>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button className={styles["edit-btn"]} onClick={() => handleEdit(user)}>
                    Edit
                  </button>
                  
                  {user.banned ? (
                    <button 
                      className={styles["unban-btn"]} 
                      onClick={() => handleUnban(user)}
                      title={`Banned: ${user.ban_reason}`}
                    >
                      Unban
                    </button>
                  ) : (
                    <button 
                      className={styles["ban-btn"]} 
                      onClick={() => handleBanClick(user)}
                      disabled={user.role === 'owner'}
                    >
                      Ban
                    </button>
                  )}
                  
                  {currentUser?.role === 'owner' && user.role !== 'owner' && (
                    <>
                      {user.role === 'admin' ? (
                        <button 
                          className={styles["demote-btn"]} 
                          onClick={() => handleDemote(user)}
                        >
                          Demote
                        </button>
                      ) : (
                        <button 
                          className={styles["promote-btn"]} 
                          onClick={() => handlePromote(user)}
                        >
                          Promote
                        </button>
                      )}
                    </>
                  )}

                  {user.role !== 'owner' && !isAdmin2 && (
                    <button
                      className={styles["delete-btn"]}
                      onClick={() => handleDeleteUser(user)}
                      title="Permanently delete this user"
                    >
                      Delete
                    </button>
                  )}

                  <button
                    className={styles["donor-btn"]}
                    onClick={() => handleDonorClick(user)}
                    title={`Donor: $${user.total_donations || 0} total`}
                  >
                    {Number(user.total_donations) >= 50 ? '⭐ Gold' : Number(user.total_donations) >= 5 ? '❖ Silver' : 'Badge'}
                  </button>
                </div>
              </td>
            </tr>
          ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderPiecesTable = () => (
    <div className={styles["table-container"]}>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Category</th>
            <th>Creator</th>
            <th>Movement</th>
            <th>Can Capture</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No pieces found'}
              </td>
            </tr>
          ) : (
            data.map(piece => (
            <tr key={piece.id}>
              <td>{piece.id}</td>
              <td><Link to={`/pieces/${piece.id}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{piece.piece_name}</Link></td>
              <td>{piece.piece_category || 'N/A'}</td>
              <td>{piece.creator_name ? (piece.real_creator_name ? <Link to={`/profile/${piece.real_creator_name}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{piece.creator_name}</Link> : <span>{piece.creator_name}</span>) : 'N/A'}</td>
              <td>
                {piece.movement_directional ? 'Directional' : piece.movement_ratio ? 'Ratio' : 'Step-by-step'}
              </td>
              <td>
                {piece.can_capture ? 'Yes' : 'No'}
              </td>
              <td>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button className={styles["edit-btn"]} onClick={() => handleEdit(piece)}>Edit</button>
                  {!isAdmin2 && <button className={styles["ban-btn"]} onClick={() => handleDeleteItem(piece, 'pieces')}>Delete</button>}
                </div>
              </td>
            </tr>
          ))
          )}
        </tbody>
      </table>
    </div>
  );

  const handleRestrictGame = (game) => {
    setRestrictTarget(game);
    setRestrictReason(game.restriction_reason || '');
    setShowRestrictModal(true);
  };

  const RESTRICT_PRESETS = [
    'Unbalanced gameplay',
    'Broken starting position',
    'Duplicate of existing game',
    'Causes significant lag',
    'Intentionally disruptive design',
  ];

  const handleSaveRestriction = async () => {
    if (!restrictTarget) return;
    setSavingRestrict(true);
    try {
      await axios.put(
        `${API_URL}admin/games/${restrictTarget.id}/restrict`,
        { restricted: true, reason: restrictReason.trim() || null },
        { headers: authHeader() }
      );
      setAlertMessage(`"${restrictTarget.game_name}" has been restricted`);
      setAlertType('success');
      setShowAlert(true);
      setShowRestrictModal(false);
      fetchData('games', pagination.page);
    } catch (err) {
      console.error('Error restricting game:', err);
      setAlertMessage(`Failed to restrict game: ${err.response?.data?.message || err.message}`);
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setSavingRestrict(false);
    }
  };

  const handleUnrestrictGame = async (game) => {
    if (!window.confirm(`Remove restriction from "${game.game_name}"? It will become publicly playable again.`)) return;
    try {
      await axios.put(
        `${API_URL}admin/games/${game.id}/restrict`,
        { restricted: false },
        { headers: authHeader() }
      );
      setAlertMessage(`"${game.game_name}" restriction removed`);
      setAlertType('success');
      setShowAlert(true);
      fetchData('games', pagination.page);
    } catch (err) {
      console.error('Error unrestricting game:', err);
      setAlertMessage(`Failed to unrestrict game: ${err.response?.data?.message || err.message}`);
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const renderGamesTable = () => (
    <div className={styles["table-container"]}>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Creator</th>
            <th>Board Size</th>
            <th>Players</th>
            <th>Play Count</th>
            <th>Last Played</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No games found'}
              </td>
            </tr>
          ) : (
            data.map(game => (
            <tr key={game.id}>
              <td>{game.id}</td>
              <td><Link to={`/games/${game.id}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{game.game_name}</Link>{game.is_restricted ? <span style={{ marginLeft: 6, fontSize: '0.75rem', background: 'rgba(255,150,0,0.2)', color: '#ffb347', border: '1px solid rgba(255,150,0,0.4)', borderRadius: 4, padding: '1px 5px' }}>Restricted</span> : null}</td>
              <td>{game.creator_name ? (game.real_creator_name ? <Link to={`/profile/${game.real_creator_name}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{game.creator_name}</Link> : <span>{game.creator_name}</span>) : 'N/A'}</td>
              <td>{game.board_width}x{game.board_height}</td>
              <td>{game.player_count || 2}</td>
              <td>{game.play_count || 0}</td>
              <td>{game.last_played_at ? formatDateTime(game.last_played_at) : 'Never'}</td>
              <td>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button className={styles["edit-btn"]} onClick={() => handleEdit(game)}>Edit</button>
                  {game.is_restricted
                    ? <button style={{ background: 'rgba(255,150,0,0.15)', color: '#ffb347', border: '1px solid rgba(255,150,0,0.4)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: '0.82rem' }} onClick={() => handleUnrestrictGame(game)}>Unrestrict</button>
                    : <button style={{ background: 'rgba(255,150,0,0.1)', color: '#ffd699', border: '1px solid rgba(255,150,0,0.3)', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: '0.82rem' }} onClick={() => handleRestrictGame(game)}>Restrict</button>
                  }
                  {!isAdmin2 && <button className={styles["ban-btn"]} onClick={() => handleDeleteItem(game, 'games')}>Delete</button>}
                </div>
              </td>
            </tr>
          ))
          )}
        </tbody>
      </table>
    </div>
  );

  // ---- Drafts (unfinished game wizard sessions) ----
  const handleDeleteDraft = async (draft) => {
    const name = draft.game_name || `(Untitled draft #${draft.id})`;
    if (!window.confirm(`Delete draft "${name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API_URL}admin/drafts/${draft.id}`, { headers: authHeader() });
      setAlertMessage(`Draft "${name}" deleted`);
      setAlertType('success');
      setShowAlert(true);
      fetchData('drafts', pagination.page);
    } catch (error) {
      console.error('Error deleting draft:', error);
      setAlertMessage(`Failed to delete draft: ${error.response?.data?.message || error.message}`);
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const handleViewDraft = async (draft) => {
    try {
      const res = await axios.get(`${API_URL}admin/drafts/${draft.id}`, { headers: authHeader() });
      setViewingDraft(res.data.data);
    } catch (error) {
      console.error('Error fetching draft detail:', error);
      setAlertMessage('Failed to load draft details');
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const renderDraftsTable = () => (
    <div className={styles["table-container"]}>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Creator</th>
            <th>Board</th>
            <th>Last Step</th>
            <th>Last Saved</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No drafts found'}
              </td>
            </tr>
          ) : (
            data.map(draft => (
              <tr key={draft.id}>
                <td>{draft.id}</td>
                <td>{draft.game_name || <span style={{ opacity: 0.6 }}>(Untitled)</span>}</td>
                <td>
                  {draft.creator_name ? (
                    <Link to={`/profile/${draft.creator_name}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
                      {draft.creator_name}
                    </Link>
                  ) : 'N/A'}
                </td>
                <td>{draft.board_width}x{draft.board_height}</td>
                <td>{draft.draft_saved_step ?? 0}</td>
                <td>{draft.updated_at ? formatDateTime(draft.updated_at) : '—'}</td>
                <td>
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                    <button className={styles["edit-btn"]} onClick={() => handleViewDraft(draft)}>View</button>
                    <button className={styles["edit-btn"]} onClick={() => navigate(`/create/game/edit/${draft.id}`)}>Open in Wizard</button>
                    <button className={styles["ban-btn"]} onClick={() => handleDeleteDraft(draft)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderDraftDetailModal = () => {
    if (!viewingDraft) return null;
    return (
      <div className={styles["modal-overlay"]} onClick={() => setViewingDraft(null)}>
        <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '700px' }}>
          <div className={styles["modal-header"]}>
            <h2>Draft #{viewingDraft.id} {viewingDraft.game_name ? `— ${viewingDraft.game_name}` : ''}</h2>
            <button className={styles["close-btn"]} onClick={() => setViewingDraft(null)}>×</button>
          </div>
          <div className={styles["modal-body"]}>
            <div style={{ marginBottom: 12 }}>
              <strong>Creator:</strong> {viewingDraft.creator_name || 'N/A'}<br />
              <strong>Board:</strong> {viewingDraft.board_width} x {viewingDraft.board_height}<br />
              <strong>Players:</strong> {viewingDraft.player_count || 2}<br />
              <strong>Last saved at step:</strong> {viewingDraft.draft_saved_step ?? 0}<br />
              <strong>Created:</strong> {viewingDraft.created_at ? formatDateTime(viewingDraft.created_at) : '—'}<br />
              <strong>Last updated:</strong> {viewingDraft.updated_at ? formatDateTime(viewingDraft.updated_at) : '—'}
            </div>
            {viewingDraft.descript && (
              <div style={{ marginBottom: 12 }}>
                <strong>Description:</strong>
                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{viewingDraft.descript}</div>
              </div>
            )}
            <details>
              <summary style={{ cursor: 'pointer', marginBottom: 8 }}>Raw draft data</summary>
              <pre style={{ maxHeight: 400, overflow: 'auto', background: 'var(--bg-secondary, #222)', padding: 12, fontSize: 12 }}>
                {JSON.stringify(viewingDraft, null, 2)}
              </pre>
            </details>
          </div>
          <div className={styles["modal-footer"]} style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: 16 }}>
            <button className={styles["edit-btn"]} onClick={() => { const id = viewingDraft.id; setViewingDraft(null); navigate(`/create/game/edit/${id}`); }}>Open in Wizard</button>
            <button className={styles["ban-btn"]} onClick={() => { handleDeleteDraft(viewingDraft); setViewingDraft(null); }}>Delete</button>
          </div>
        </div>
      </div>
    );
  };

  const renderAnonymousGamesTable = () => {
    const statusLabel = (status) => {
      switch (status) {
        case 'waiting': return 'Waiting for players';
        case 'ready': return 'Ready (starting)';
        case 'active': return 'In progress';
        case 'completed': return 'Completed';
        case 'abandoned': return 'Abandoned';
        default: return status || 'Unknown';
      }
    };
    return (
    <div className={styles["table-container"]}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button
          className={styles["edit-btn"]}
          onClick={() => fetchAnonymousGames(pagination?.page || 1)}
        >
          ↻ Refresh
        </button>
      </div>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Game Name</th>
            <th>Players</th>
            <th>Status</th>
            <th>Invite Code</th>
            <th>Time Control</th>
            <th>Moves</th>
            <th>Created</th>
            <th>Started</th>
            <th>Ended</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="11" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No anonymous games found'}
              </td>
            </tr>
          ) : (
            data.map(game => {
              const started = game.status === 'active' || game.status === 'ready' || game.status === 'completed';
              const ended = game.status === 'completed' || game.status === 'abandoned';
              return (
              <tr key={game.id}>
                <td>{game.id}</td>
                <td>{game.game_name || 'Unnamed'}</td>
                <td style={{ textAlign: 'center' }}>{game.player_count ?? 0}/2</td>
                <td>{statusLabel(game.status)}</td>
                <td style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>{game.invite_code}</td>
                <td>{game.turn_length ? `${game.turn_length}+${game.increment || 0}` : 'No limit'}</td>
                <td>{game.move_count ?? 0}</td>
                <td>{game.created_at ? formatDateTime(game.created_at) : 'N/A'}</td>
                <td>{started ? (game.start_time ? formatDateTime(game.start_time) : '—') : '—'}</td>
                <td>{ended ? (game.end_time ? formatDateTime(game.end_time) : '—') : '—'}</td>
                <td>
                  {ended ? (
                    <Link
                      to={`/play/${game.id}?anonSpectate=1`}
                      className={styles["edit-btn"]}
                      style={{ textDecoration: 'none' }}
                    >
                      View
                    </Link>
                  ) : (
                    <Link
                      to={`/play/${game.id}?anonSpectate=1`}
                      className={styles["edit-btn"]}
                      style={{ textDecoration: 'none' }}
                    >
                      Spectate
                    </Link>
                  )}
                </td>
              </tr>
            );})
          )}
        </tbody>
      </table>
    </div>
    );
  };

  const renderPrivateGamesTable = () => {
    const statusLabel = (status) => {
      switch (status) {
        case 'waiting': return 'Waiting for players';
        case 'ready': return 'Ready';
        case 'active': return 'In progress';
        default: return status || 'Unknown';
      }
    };
    const formatTC = (g) => {
      if (g.is_correspondence) {
        return g.correspondence_days ? `${g.correspondence_days}d/move` : 'Correspondence';
      }
      if (g.turn_length) {
        return `${g.turn_length}+${g.increment || 0}`;
      }
      return 'No limit';
    };
    return (
      <div className={styles["table-container"]}>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', margin: '0 0 12px 0' }}>
          Active games where the host disabled spectating. Read-only — admins cannot watch these per the host's choice.
        </p>
        <table className={styles["data-table"]}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Game Name</th>
              <th>Host</th>
              <th>Players</th>
              <th>Status</th>
              <th>Time Control</th>
              <th>Moves</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {!data || data.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                  {!data ? 'Loading...' : 'No active private games right now'}
                </td>
              </tr>
            ) : (
              data.map(game => (
                <tr key={game.id}>
                  <td>{game.id}</td>
                  <td>
                    {game.game_type_id ? (
                      <Link to={`/games/${game.game_type_id}`} style={{ color: 'var(--link-color, #4a9eff)' }}>
                        {game.game_name || 'Unnamed'}
                      </Link>
                    ) : (game.game_name || 'Unnamed')}
                  </td>
                  <td>
                    {game.host_username ? (
                      <Link to={`/profile/${game.host_username}`} style={{ color: 'var(--link-color, #4a9eff)' }}>
                        {game.host_username}
                      </Link>
                    ) : (game.host_id ? `User #${game.host_id}` : '—')}
                  </td>
                  <td>{game.player_names || '—'}</td>
                  <td>{statusLabel(game.status)}</td>
                  <td>{formatTC(game)}</td>
                  <td>{game.move_count ?? 0}</td>
                  <td>{game.created_at ? formatDateTime(game.created_at) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    );
  };

  const renderDeletedUsersTable = () => (
    <div className={styles["table-container"]}>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>Original User ID</th>
            <th>Previous Username</th>
            <th>Deleted At</th>
            <th>Deletion Type</th>
            <th>Deleted By</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No deleted users on record'}
              </td>
            </tr>
          ) : (
            data.map(row => (
              <tr key={row.id}>
                <td>{row.original_user_id}</td>
                <td>{row.previous_username || '—'}</td>
                <td>{row.deleted_at ? formatDateTime(row.deleted_at) : '—'}</td>
                <td>{row.deletion_type || '—'}</td>
                <td>
                  {row.deletion_type === 'self'
                    ? <em>self-delete</em>
                    : (row.deleted_by_username || (row.deleted_by_user_id ? `User #${row.deleted_by_user_id}` : '—'))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderForumsTable = () => (
    <div className={styles["table-container"]}>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Author</th>
            <th>Game</th>
            <th>Genre</th>
            <th>Public</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No forum posts found'}
              </td>
            </tr>
          ) : (
            data.map(forum => (
            <tr key={forum.id}>
              <td>{forum.id}</td>
              <td><Link to={`/forums/${forum.id}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{forum.title}</Link></td>
              <td>{forum.author_name && forum.author_name !== 'Anonymous' && forum.author_name !== 'User Deleted' ? <Link to={`/profile/${forum.author_name}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{forum.author_name}</Link> : <span>{forum.author_name || 'N/A'}</span>}</td>
              <td>{forum.game_name || 'N/A'}</td>
              <td>{forum.genre}</td>
              <td>{forum.public ? 'Yes' : 'No'}</td>
              <td>{formatDateTime(forum.created_at)}</td>
              <td>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button className={styles["edit-btn"]} onClick={() => handleEdit(forum)}>Edit</button>
                  {!isAdmin2 && <button className={styles["ban-btn"]} onClick={() => handleDeleteForum(forum)}>Delete</button>}
                </div>
              </td>
            </tr>
          ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderNewsTable = () => (
    <div className={styles["table-container"]}>
      <div className={styles["table-header"]} style={{ marginBottom: '15px' }}>
        <StandardButton onClick={handleCreateNews} buttonText="Create News Article" />
      </div>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Author</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No news articles found'}
              </td>
            </tr>
          ) : (
            data.map(news => (
            <tr key={news.id}>
              <td>{news.id}</td>
              <td><Link to={`/news/edit/${news.id}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{news.title}</Link></td>
              <td>{news.author_name ? <Link to={`/profile/${news.author_name}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{news.author_name}</Link> : 'N/A'}</td>
              <td>{formatDateTime(news.created_at)}</td>
              <td>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button className={styles["edit-btn"]} onClick={() => handleEdit(news)}>Edit</button>
                  {!isAdmin2 && <button className={styles["ban-btn"]} onClick={() => handleDeleteNews(news)}>Delete</button>}
                </div>
              </td>
            </tr>
          ))
          )}
        </tbody>
      </table>
    </div>
  );

  const renderFeaturedTab = () => (
    <div className={styles["featured-container"]}>
      <h2 style={{ marginBottom: '20px', color: 'var(--accent-primary)' }}>Featured Games on Homepage</h2>
      <p style={{ marginBottom: '30px', color: 'var(--text-dim)' }}>
        Select up to 9 games to feature on the homepage. These games will be displayed in the "Explore the Grove" section above the popular games.
        Leave a slot empty to fall back to popular games. Slots are shown in a 3&times;3 grid on the home page.
      </p>
      
      <div className={styles["featured-slots"]}>
        {Array.from({length: 9}, (_, i) => i).map(slotIndex => (
          <div key={slotIndex} className={styles["featured-slot"]}>
            <label>Slot {slotIndex + 1}</label>
            <select
              value={featuredGames[slotIndex]?.id || ''}
              onChange={(e) => handleFeaturedGameChange(slotIndex, e.target.value)}
              className={styles["featured-select"]}
            >
              <option value="">-- None (use popular) --</option>
              {availableGames.map(game => (
                <option 
                  key={game.id} 
                  value={game.id}
                  disabled={featuredGames.some((fg, i) => i !== slotIndex && fg?.id === game.id)}
                >
                  {game.game_name} ({game.board_width}x{game.board_height}) - {game.play_count || 0} plays
                </option>
              ))}
            </select>
            {featuredGames[slotIndex] && (
              <div className={styles["featured-preview"]}>
                <strong>{featuredGames[slotIndex].game_name}</strong>
                <span>by {featuredGames[slotIndex].creator_name || 'Unknown'}</span>
                <span>{featuredGames[slotIndex].board_width}x{featuredGames[slotIndex].board_height} board</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ marginTop: '30px' }}>
        <StandardButton onClick={saveFeaturedGames} buttonText="Save Featured Games" />
      </div>
    </div>
  );

  const fetchAdminUserStreams = async () => {
    setAdminUserStreamsLoading(true);
    try {
      const res = await axios.get(`${API_URL}user-streams`);
      setAdminUserStreams(res.data || []);
    } catch (err) {
      console.error('Error fetching community streams:', err);
    } finally {
      setAdminUserStreamsLoading(false);
    }
  };

  const handleRemoveUserTwitchChannel = async (userId, username) => {
    if (!window.confirm(`Remove Twitch channel link for ${username}? They can re-add it from their profile settings.`)) return;
    try {
      await axios.delete(`${API_URL}admin/user-twitch-channel/${userId}`, { headers: authHeader() });
      setAdminUserStreams(prev => prev.filter(u => u.user_id !== userId));
      setAlertMessage(`Twitch channel removed for ${username}`);
      setAlertType('success');
      setShowAlert(true);
    } catch (err) {
      setAlertMessage('Failed to remove channel: ' + (err.response?.data?.message || err.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  // ----- Initial-position scan tool ---------------------------------------
  const fetchInitialStateFlagged = useCallback(async () => {
    setInitialStateLoading(true);
    try {
      const res = await axios.get(`${API_URL}admin/initial-state/flagged`, {
        headers: authHeader(),
      });
      setInitialStateFlagged(res.data?.data || []);
    } catch (err) {
      console.error('fetchInitialStateFlagged failed', err);
      setAlertMessage('Failed to load flagged game types: ' + (err?.response?.data?.message || err.message));
      setShowAlert(true);
    } finally {
      setInitialStateLoading(false);
    }
  }, []);

  const runInitialStateScan = async () => {
    if (!window.confirm('Run a fresh scan of every published game type? This may take a few seconds for large libraries.')) return;
    setInitialStateScanning(true);
    setInitialStateScanSummary(null);
    try {
      const res = await axios.post(`${API_URL}admin/initial-state/scan`, {}, {
        headers: authHeader(),
      });
      setInitialStateScanSummary(res.data || null);
      await fetchInitialStateFlagged();
    } catch (err) {
      console.error('runInitialStateScan failed', err);
      setAlertMessage('Scan failed: ' + (err?.response?.data?.message || err.message));
      setShowAlert(true);
    } finally {
      setInitialStateScanning(false);
    }
  };

  const clearInitialStateWarning = async (gameTypeId) => {
    try {
      await axios.post(`${API_URL}admin/initial-state/${gameTypeId}/clear`, {}, {
        headers: authHeader(),
      });
      setInitialStateFlagged((prev) => prev.filter((g) => g.id !== gameTypeId));
    } catch (err) {
      console.error('clearInitialStateWarning failed', err);
      setAlertMessage('Failed to clear warning: ' + (err?.response?.data?.message || err.message));
      setShowAlert(true);
    }
  };

  // ----------------------- AI Analysis Requests ---------------------------
  const fetchAiAnalysisRequests = useCallback(async (page = 1, statusFilter = aiAnalysisRequestsFilter) => {
    setAiAnalysisRequestsLoading(true);
    try {
      const limit = aiAnalysisRequestsPagination?.limit || 25;
      const statusQs = statusFilter && statusFilter !== 'all' ? `&status=${encodeURIComponent(statusFilter)}` : '';
      const res = await axios.get(
        `${API_URL}admin/ai-analysis-requests?page=${page}&limit=${limit}${statusQs}`,
        { headers: authHeader() }
      );
      setAiAnalysisRequests(res.data?.data || []);
      setAiAnalysisRequestsPagination(res.data?.pagination || { page, limit, total: 0, totalPages: 0 });
    } catch (err) {
      console.error('fetchAiAnalysisRequests failed', err);
      setAlertMessage('Failed to load analysis requests: ' + (err?.response?.data?.message || err.message));
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setAiAnalysisRequestsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAnalysisRequestsFilter, aiAnalysisRequestsPagination?.limit]);

  const setAiAnalysisRequestStatus = async (id, newStatus) => {
    try {
      await axios.patch(
        `${API_URL}admin/ai-analysis-requests/${id}`,
        { status: newStatus },
        { headers: authHeader() }
      );
      await fetchAiAnalysisRequests(aiAnalysisRequestsPagination.page, aiAnalysisRequestsFilter);
    } catch (err) {
      console.error('setAiAnalysisRequestStatus failed', err);
      setAlertMessage('Failed to update request: ' + (err?.response?.data?.message || err.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const deleteAiAnalysisRequest = async (id) => {
    if (!window.confirm('Delete this analysis request? This cannot be undone.')) return;
    try {
      await axios.delete(`${API_URL}admin/ai-analysis-requests/${id}`, {
        headers: authHeader(),
      });
      setAiAnalysisRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('deleteAiAnalysisRequest failed', err);
      setAlertMessage('Failed to delete request: ' + (err?.response?.data?.message || err.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  // ── Physical Board Requests helpers ──────────────────────────────────────
  const fetchPhysicalBoardRequests = useCallback(async (page = 1, statusFilter = physicalBoardRequestsFilter) => {
    setPhysicalBoardRequestsLoading(true);
    try {
      const limit = physicalBoardRequestsPagination?.limit || 25;
      const statusQs = statusFilter && statusFilter !== 'all' ? `&status=${encodeURIComponent(statusFilter)}` : '';
      const res = await axios.get(
        `${API_URL}admin/physical-board-requests?page=${page}&limit=${limit}${statusQs}`,
        { headers: authHeader() }
      );
      setPhysicalBoardRequests(res.data?.data || []);
      setPhysicalBoardRequestsPagination(res.data?.pagination || { page, limit, total: 0, totalPages: 0 });
    } catch (err) {
      console.error('fetchPhysicalBoardRequests failed', err);
      setAlertMessage('Failed to load requests: ' + (err?.response?.data?.message || err.message));
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setPhysicalBoardRequestsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [physicalBoardRequestsFilter, physicalBoardRequestsPagination?.limit]);

  const setPhysicalBoardRequestStatus = async (id, newStatus) => {
    try {
      await axios.patch(
        `${API_URL}admin/physical-board-requests/${id}`,
        { status: newStatus },
        { headers: authHeader() }
      );
      await fetchPhysicalBoardRequests(physicalBoardRequestsPagination.page, physicalBoardRequestsFilter);
    } catch (err) {
      console.error('setPhysicalBoardRequestStatus failed', err);
      setAlertMessage('Failed to update status: ' + (err?.response?.data?.message || err.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const deletePhysicalBoardRequest = async (id) => {
    if (!window.confirm('Delete this request record? This cannot be undone.')) return;
    try {
      await axios.delete(`${API_URL}admin/physical-board-requests/${id}`, { headers: authHeader() });
      setPhysicalBoardRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error('deletePhysicalBoardRequest failed', err);
      setAlertMessage('Failed to delete: ' + (err?.response?.data?.message || err.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  // ── Feature TODO helpers ─────────────────────────────────────────────────
  const fetchFeatureTodoItems = async (statusFilter) => {
    const filter = statusFilter !== undefined ? statusFilter : featureTodoFilter;
    setFeatureTodoLoading(true);
    try {
      const qs = filter && filter !== 'all' ? `?status=${encodeURIComponent(filter)}` : '';
      const res = await axios.get(`${API_URL}admin/feature-todo${qs}`, { headers: authHeader() });
      setFeatureTodoItems(res.data?.data || []);
    } catch (err) {
      console.error('fetchFeatureTodoItems failed', err);
      setAlertMessage('Failed to load feature todos: ' + (err?.response?.data?.error || err.message));
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setFeatureTodoLoading(false);
    }
  };

  const saveFeatureTodoItem = async () => {
    if (!featureTodoForm.title.trim()) return;
    setFeatureTodoSaving(true);
    try {
      if (featureTodoEditingId) {
        await axios.patch(
          `${API_URL}admin/feature-todo/${featureTodoEditingId}`,
          { title: featureTodoForm.title, description: featureTodoForm.description },
          { headers: authHeader() }
        );
      } else {
        await axios.post(
          `${API_URL}admin/feature-todo`,
          { title: featureTodoForm.title, description: featureTodoForm.description },
          { headers: authHeader() }
        );
      }
      setFeatureTodoForm({ title: '', description: '' });
      setFeatureTodoEditingId(null);
      await fetchFeatureTodoItems(featureTodoFilter);
    } catch (err) {
      console.error('saveFeatureTodoItem failed', err);
      setAlertMessage('Failed to save: ' + (err?.response?.data?.error || err.message));
      setAlertType('error');
      setShowAlert(true);
    } finally {
      setFeatureTodoSaving(false);
    }
  };

  const updateFeatureTodoStatus = async (id, newStatus) => {
    try {
      await axios.patch(
        `${API_URL}admin/feature-todo/${id}`,
        { status: newStatus },
        { headers: authHeader() }
      );
      setFeatureTodoItems(prev =>
        prev.map(item => item.id === id ? { ...item, status: newStatus } : item)
      );
    } catch (err) {
      console.error('updateFeatureTodoStatus failed', err);
      setAlertMessage('Failed to update status: ' + (err?.response?.data?.error || err.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const deleteFeatureTodoItem = async (id) => {
    if (!window.confirm('Delete this feature item? This cannot be undone.')) return;
    try {
      await axios.delete(`${API_URL}admin/feature-todo/${id}`, { headers: authHeader() });
      setFeatureTodoItems(prev => prev.filter(item => item.id !== id));
    } catch (err) {
      console.error('deleteFeatureTodoItem failed', err);
      setAlertMessage('Failed to delete: ' + (err?.response?.data?.error || err.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const startEditFeatureTodo = (item) => {
    setFeatureTodoEditingId(item.id);
    setFeatureTodoForm({ title: item.title, description: item.description || '' });
  };

  // ── Poll admin helpers ────────────────────────────────────────────────────
  const fetchPolls = async () => {
    setPollsLoading(true);
    try {
      const res = await axios.get(`${API_URL}admin/poll`, { headers: authHeader() });
      setPolls(res.data || []);
    } catch (err) {
      console.error('fetchPolls failed', err);
    } finally {
      setPollsLoading(false);
    }
  };

  const fetchPollResults = async (pollId) => {
    setPollResultsLoading(true);
    try {
      const res = await axios.get(`${API_URL}admin/poll/${pollId}/results`, { headers: authHeader() });
      setPollResults(res.data);
    } catch (err) {
      console.error('fetchPollResults failed', err);
    } finally {
      setPollResultsLoading(false);
    }
  };

  const savePoll = async () => {
    if (!pollForm.question.trim()) return;
    const cleanOpts = pollForm.options.map(o => o.trim()).filter(Boolean);
    if (cleanOpts.length < 2) { alert('Need at least 2 non-empty options'); return; }
    setPollSaving(true);
    try {
      const payload = {
        question: pollForm.question.trim(),
        options: cleanOpts,
        is_visible: pollForm.is_visible,
        expires_at: pollForm.expires_at || null,
      };
      if (editingPollId) {
        await axios.put(`${API_URL}admin/poll/${editingPollId}`, payload, { headers: authHeader() });
      } else {
        await axios.post(`${API_URL}admin/poll`, payload, { headers: authHeader() });
      }
      setPollForm({ question: '', options: ['', ''], is_visible: false, expires_at: '' });
      setEditingPollId(null);
      await fetchPolls();
    } catch (err) {
      console.error('savePoll failed', err);
      alert('Failed to save poll: ' + (err?.response?.data?.message || err.message));
    } finally {
      setPollSaving(false);
    }
  };

  const deletePoll = async (id) => {
    if (!window.confirm('Delete this poll and all its votes?')) return;
    try {
      await axios.delete(`${API_URL}admin/poll/${id}`, { headers: authHeader() });
      setPolls(prev => prev.filter(p => p.id !== id));
      if (pollResults?.poll?.id === id) setPollResults(null);
    } catch (err) {
      console.error('deletePoll failed', err);
    }
  };

  const startEditPoll = (poll) => {
    setEditingPollId(poll.id);
    const expiresAtLocal = poll.expires_at
      ? new Date(poll.expires_at).toISOString().slice(0, 16)
      : '';
    setPollForm({
      question: poll.question,
      options: poll.options.length ? [...poll.options] : ['', ''],
      is_visible: !!poll.is_visible,
      expires_at: expiresAtLocal,
    });
    setPollResults(null);
  };

  const renderPollTab = () => (
    <div className={styles["table-container"]}>
      {/* ── Form ── */}
      <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '16px' }}>
        <div style={{ fontWeight: 600, marginBottom: '12px' }}>
          {editingPollId ? `Editing Poll #${editingPollId}` : 'New Poll'}
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '0.85em', color: 'var(--text-dim)', marginBottom: '4px' }}>Question</label>
          <input
            type="text"
            value={pollForm.question}
            onChange={e => setPollForm(f => ({ ...f, question: e.target.value }))}
            placeholder="Enter poll question…"
            style={{ width: '100%', background: 'var(--input-bg, #1a1a2e)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px 10px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', fontSize: '0.85em', color: 'var(--text-dim)', marginBottom: '4px' }}>Options</label>
          {pollForm.options.map((opt, i) => (
            <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <input
                type="text"
                value={opt}
                onChange={e => setPollForm(f => { const opts = [...f.options]; opts[i] = e.target.value; return { ...f, options: opts }; })}
                placeholder={`Option ${i + 1}`}
                style={{ flex: 1, background: 'var(--input-bg, #1a1a2e)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '7px 10px' }}
              />
              {pollForm.options.length > 2 && (
                <StandardButton buttonText="✕" onClick={() => setPollForm(f => { const opts = f.options.filter((_, idx) => idx !== i); return { ...f, options: opts }; })} />
              )}
            </div>
          ))}
          <StandardButton buttonText="+ Add Option" onClick={() => setPollForm(f => ({ ...f, options: [...f.options, ''] }))} />
        </div>
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '10px', alignItems: 'center' }}>
          <ToggleSwitch checked={pollForm.is_visible} onChange={v => setPollForm(f => ({ ...f, is_visible: v }))} label="Visible on home page" />
          <div>
            <label style={{ display: 'block', fontSize: '0.85em', color: 'var(--text-dim)', marginBottom: '2px' }}>Expires at (optional)</label>
            <input
              type="datetime-local"
              value={pollForm.expires_at}
              onChange={e => setPollForm(f => ({ ...f, expires_at: e.target.value }))}
              style={{ background: 'var(--input-bg, #1a1a2e)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '6px 8px' }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <StandardButton buttonText={pollSaving ? 'Saving…' : (editingPollId ? 'Save Changes' : 'Create Poll')} onClick={savePoll} disabled={pollSaving} />
          {editingPollId && (
            <StandardButton buttonText="Cancel" onClick={() => { setEditingPollId(null); setPollForm({ question: '', options: ['', ''], is_visible: false, expires_at: '' }); }} />
          )}
        </div>
      </div>

      {/* ── Existing polls ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ fontWeight: 600 }}>All Polls</div>
        <StandardButton buttonText="Refresh" onClick={fetchPolls} disabled={pollsLoading} />
      </div>
      {pollsLoading ? (
        <div className={styles["loading"]}>Loading…</div>
      ) : polls.length === 0 ? (
        <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '20px 0' }}>No polls yet.</p>
      ) : (
        <table className={styles["table"]}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Question</th>
              <th>Options</th>
              <th>Visible</th>
              <th>Expires</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {polls.map(p => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.question}</td>
                <td style={{ fontSize: '0.8em', color: 'var(--text-dim)' }}>{(p.options || []).join(', ')}</td>
                <td>{p.is_visible ? '✅' : '—'}</td>
                <td style={{ fontSize: '0.8em' }}>{p.expires_at ? new Date(p.expires_at).toLocaleString() : '—'}</td>
                <td style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <StandardButton buttonText="Results" onClick={() => fetchPollResults(p.id)} />
                  <StandardButton buttonText="Edit" onClick={() => startEditPoll(p)} />
                  <StandardButton buttonText="Delete" onClick={() => deletePoll(p.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Results panel ── */}
      {pollResults && (
        <div style={{ marginTop: '24px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ fontWeight: 600 }}>Results: "{pollResults.poll.question}"</div>
            <div style={{ fontSize: '0.85em', color: 'var(--text-dim)' }}>{pollResults.totalVotes} total votes</div>
          </div>
          {pollResultsLoading ? (
            <div className={styles["loading"]}>Loading…</div>
          ) : (
            pollResults.results.map((r) => {
              const pct = pollResults.totalVotes > 0 ? Math.round((r.voters.length / pollResults.totalVotes) * 100) : 0;
              return (
                <div key={r.optionIndex} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 500 }}>{r.option}</span>
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>{r.voters.length} votes ({pct}%)</span>
                  </div>
                  <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', marginBottom: '4px' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent, #7289da)', borderRadius: '3px' }} />
                  </div>
                  {r.voters.length > 0 && (
                    <div style={{ fontSize: '0.78em', color: 'var(--text-dim)', display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {r.voters.map(v => (
                        <a key={v.user_id} href={`/profile/${v.username}`} target="_blank" rel="noreferrer"
                           style={{ color: 'var(--link-color, #aac4ff)', textDecoration: 'none' }}>
                          {v.username}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <StandardButton buttonText="Close" onClick={() => setPollResults(null)} />
        </div>
      )}
    </div>
  );

  const renderInitialStateTab = () => (
    <div className={styles["table-container"]}>
      <div className={styles["table-header"]} style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Initial Position Scan</div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginTop: '4px' }}>
            Detects published game types whose starting position is already won, lost, or drawn before any moves.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <StandardButton onClick={fetchInitialStateFlagged} buttonText="Refresh List" disabled={initialStateLoading || initialStateScanning} />
          <StandardButton onClick={runInitialStateScan} buttonText={initialStateScanning ? 'Scanning…' : 'Run Scan'} disabled={initialStateScanning} />
        </div>
      </div>
      {initialStateScanSummary && (
        <div style={{ background: 'rgba(255,200,50,0.08)', border: '1px solid rgba(255,200,50,0.3)', padding: '10px 14px', borderRadius: '6px', marginBottom: '12px', fontSize: '0.9em' }}>
          Scan complete — <strong>{initialStateScanSummary.scanned}</strong> game types checked,{' '}
          <strong>{initialStateScanSummary.flagged}</strong> flagged,{' '}
          <strong>{initialStateScanSummary.cleared}</strong> cleared,{' '}
          <strong>{initialStateScanSummary.errored}</strong> errored.
        </div>
      )}
      {initialStateLoading ? (
        <div className={styles["loading"]}>Loading…</div>
      ) : initialStateFlagged.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '30px 0' }}>
          No flagged game types. Click <strong>Run Scan</strong> to check the entire library.
        </p>
      ) : (
        <table className={styles["table"]}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Game Name</th>
              <th>Creator</th>
              <th>Warning</th>
              <th>Last Checked</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {initialStateFlagged.map((g) => (
              <tr key={g.id}>
                <td>{g.id}</td>
                <td>
                  <a href={`/games/${g.id}`} target="_blank" rel="noreferrer">{g.game_name}</a>
                </td>
                <td>{g.creator_name || '—'}</td>
                <td style={{ color: '#ffb0b0', fontSize: '0.85em' }}>{g.initial_state_warning}</td>
                <td style={{ fontSize: '0.8em' }}>{g.initial_state_checked_at ? new Date(g.initial_state_checked_at).toLocaleString() : '—'}</td>
                <td>
                  <StandardButton buttonText="Clear" onClick={() => clearInitialStateWarning(g.id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderAiAnalysisRequestsTab = () => {
    const statusBadge = (status) => {
      const colorMap = {
        pending:    { bg: 'rgba(255, 200, 50, 0.15)',  border: 'rgba(255, 200, 50, 0.4)',  text: '#ffc832' },
        fulfilled:  { bg: 'rgba(80, 200, 120, 0.15)',  border: 'rgba(80, 200, 120, 0.4)',  text: '#50c878' },
        dismissed:  { bg: 'rgba(150, 150, 150, 0.15)', border: 'rgba(150, 150, 150, 0.4)', text: '#aaa' },
      };
      const c = colorMap[status] || colorMap.dismissed;
      return (
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
          background: c.bg, border: `1px solid ${c.border}`, color: c.text,
          fontSize: '0.75em', fontWeight: 600, textTransform: 'uppercase',
        }}>{status}</span>
      );
    };

    return (
      <div className={styles["table-container"]}>
        <div className={styles["table-header"]} style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontWeight: 600 }}>AI Analysis Requests</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginTop: '4px' }}>
              Persistent log of every AI analysis request a creator has submitted. Mark fulfilled when training is complete or dismissed if rejected.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '0.85em', color: 'var(--text-dim)' }}>Status:</label>
            <select
              value={aiAnalysisRequestsFilter}
              onChange={(e) => {
                setAiAnalysisRequestsFilter(e.target.value);
                fetchAiAnalysisRequests(1, e.target.value);
              }}
              style={{ padding: '4px 8px' }}
            >
              <option value="pending">Pending</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
            <StandardButton
              onClick={() => fetchAiAnalysisRequests(aiAnalysisRequestsPagination.page, aiAnalysisRequestsFilter)}
              buttonText="Refresh"
              disabled={aiAnalysisRequestsLoading}
            />
          </div>
        </div>
        {aiAnalysisRequestsLoading ? (
          <div className={styles["loading"]}>Loading…</div>
        ) : aiAnalysisRequests.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '30px 0' }}>
            No analysis requests in this view.
          </p>
        ) : (
          <table className={styles["table"]}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Game</th>
                <th>Requester</th>
                <th>Requested</th>
                <th>Count</th>
                <th>Fulfilled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {aiAnalysisRequests.map((r) => (
                <tr key={r.id}>
                  <td>{statusBadge(r.status)}</td>
                  <td>
                    {r.game_name ? (
                      <a href={`/games/${r.game_type_id}`} target="_blank" rel="noreferrer">{r.game_name}</a>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>(deleted) #{r.game_type_id}</span>
                    )}
                  </td>
                  <td>
                    {r.requester_current_username ? (
                      <Link to={`/profile/id/${r.requester_user_id}`}>{r.requester_current_username}</Link>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>{r.requester_username || '(deleted user)'}</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.85em' }}>{r.created_at ? formatDateTime(parseServerDate(r.created_at)) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{r.request_count || 1}</td>
                  <td style={{ fontSize: '0.85em' }}>
                    {r.fulfilled_at
                      ? <>{formatDateTime(parseServerDate(r.fulfilled_at))}{r.fulfilled_by_username ? ` by ${r.fulfilled_by_username}` : ''}</>
                      : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <StandardButton
                        buttonText="Open in AI Training"
                        onClick={() => navigate(`/admin?tab=ai-training&gameTypeId=${r.game_type_id}`)}
                      />
                      {r.status !== 'fulfilled' && (
                        <StandardButton
                          buttonText="Mark Fulfilled"
                          onClick={() => setAiAnalysisRequestStatus(r.id, 'fulfilled')}
                        />
                      )}
                      {r.status !== 'dismissed' && r.status !== 'fulfilled' && (
                        <StandardButton
                          buttonText="Dismiss"
                          onClick={() => setAiAnalysisRequestStatus(r.id, 'dismissed')}
                        />
                      )}
                      {r.status !== 'pending' && (
                        <StandardButton
                          buttonText="Reopen"
                          onClick={() => setAiAnalysisRequestStatus(r.id, 'pending')}
                        />
                      )}
                      <StandardButton
                        buttonText="Delete"
                        onClick={() => deleteAiAnalysisRequest(r.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {aiAnalysisRequestsPagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', padding: '15px 0' }}>
            <StandardButton
              buttonText="Previous"
              onClick={() => fetchAiAnalysisRequests(aiAnalysisRequestsPagination.page - 1, aiAnalysisRequestsFilter)}
              disabled={aiAnalysisRequestsPagination.page <= 1}
            />
            <span style={{ fontSize: '0.9em' }}>
              Page {aiAnalysisRequestsPagination.page} of {aiAnalysisRequestsPagination.totalPages}
            </span>
            <StandardButton
              buttonText="Next"
              onClick={() => fetchAiAnalysisRequests(aiAnalysisRequestsPagination.page + 1, aiAnalysisRequestsFilter)}
              disabled={aiAnalysisRequestsPagination.page >= aiAnalysisRequestsPagination.totalPages}
            />
          </div>
        )}
      </div>
    );
  };

  const fetchUserGrowth = async (view) => {
    setUserGrowthLoading(true);
    setUserGrowthError(null);
    try {
      const resp = await axios.get(`${API_URL}admin/user-growth?view=${view}`, { headers: authHeader() });
      setUserGrowthData(resp.data);
    } catch (err) {
      setUserGrowthError(err?.response?.data?.message || err.message || 'Failed to load user growth data');
    } finally {
      setUserGrowthLoading(false);
    }
  };

  const renderFeatureTodoTab = () => {
    const STATUS_META = {
      unstarted:   { label: 'Unstarted',    bg: 'rgba(150,150,150,0.15)', border: 'rgba(150,150,150,0.4)',  text: '#aaa' },
      in_progress: { label: 'In Progress',  bg: 'rgba(100,160,255,0.15)', border: 'rgba(100,160,255,0.4)',  text: '#64a0ff' },
      completed:   { label: 'Completed',    bg: 'rgba(80,200,120,0.15)',  border: 'rgba(80,200,120,0.4)',   text: '#50c878' },
      abandoned:   { label: 'Abandoned',    bg: 'rgba(255,80,80,0.15)',   border: 'rgba(255,80,80,0.4)',    text: '#ff5050' },
    };

    const statusBadge = (status) => {
      const m = STATUS_META[status] || STATUS_META.unstarted;
      return (
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
          background: m.bg, border: `1px solid ${m.border}`, color: m.text,
          fontSize: '0.78em', fontWeight: 600, whiteSpace: 'nowrap',
        }}>
          {m.label}
        </span>
      );
    };

    const STATUSES = ['unstarted', 'in_progress', 'completed', 'abandoned'];
    const FILTER_OPTIONS = [{ value: 'all', label: 'All' }, ...STATUSES.map(s => ({ value: s, label: STATUS_META[s].label }))];

    return (
      <div className={styles["table-container"]}>
        {/* ── Form ── */}
        <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '16px' }}>
          <div style={{ fontWeight: 600, marginBottom: '12px' }}>
            {featureTodoEditingId ? `Editing Feature #${featureTodoEditingId}` : 'Add New Feature Idea'}
          </div>
          <div style={{ marginBottom: '10px' }}>
            <label style={{ display: 'block', fontSize: '0.85em', color: 'var(--text-dim)', marginBottom: '4px' }}>Title *</label>
            <input
              type="text"
              value={featureTodoForm.title}
              onChange={e => setFeatureTodoForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Feature title…"
              maxLength={255}
              style={{ width: '100%', background: 'var(--input-bg, #1a1a2e)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px 10px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '0.85em', color: 'var(--text-dim)', marginBottom: '4px' }}>Description (optional)</label>
            <textarea
              value={featureTodoForm.description}
              onChange={e => setFeatureTodoForm(f => ({ ...f, description: e.target.value }))}
              placeholder="More details about this feature…"
              rows={3}
              style={{ width: '100%', background: 'var(--input-bg, #1a1a2e)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '8px 10px', boxSizing: 'border-box', resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <StandardButton
              buttonText={featureTodoSaving ? 'Saving…' : (featureTodoEditingId ? 'Save Changes' : 'Add Feature')}
              onClick={saveFeatureTodoItem}
              disabled={featureTodoSaving || !featureTodoForm.title.trim()}
            />
            {featureTodoEditingId && (
              <StandardButton
                buttonText="Cancel"
                onClick={() => { setFeatureTodoEditingId(null); setFeatureTodoForm({ title: '', description: '' }); }}
              />
            )}
          </div>
        </div>

        {/* ── Filter + header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => {
                  setFeatureTodoFilter(opt.value);
                  fetchFeatureTodoItems(opt.value);
                }}
                style={{
                  padding: '4px 12px', borderRadius: '4px', border: '1px solid var(--border)',
                  background: featureTodoFilter === opt.value ? 'var(--accent, #7289da)' : 'transparent',
                  color: featureTodoFilter === opt.value ? '#fff' : 'var(--text-dim)',
                  cursor: 'pointer', fontSize: '0.85em',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <StandardButton buttonText="Refresh" onClick={() => fetchFeatureTodoItems(featureTodoFilter)} disabled={featureTodoLoading} />
        </div>

        {/* ── List ── */}
        {featureTodoLoading ? (
          <div className={styles["loading"]}>Loading…</div>
        ) : featureTodoItems.length === 0 ? (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '24px 0' }}>No feature ideas yet. Add one above!</p>
        ) : (
          <table className={styles["table"]}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Description</th>
                <th>Status</th>
                <th>Added by</th>
                <th>Date</th>
                <th>Move to</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {featureTodoItems.map(item => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td style={{ fontWeight: 500, maxWidth: '200px' }}>{item.title}</td>
                  <td style={{ fontSize: '0.82em', color: 'var(--text-dim)', maxWidth: '260px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {item.description || <span style={{ opacity: 0.4 }}>—</span>}
                  </td>
                  <td>{statusBadge(item.status)}</td>
                  <td style={{ fontSize: '0.82em' }}>{item.created_by_username || '—'}</td>
                  <td style={{ fontSize: '0.78em', whiteSpace: 'nowrap' }}>{new Date(item.created_at).toLocaleDateString()}</td>
                  <td>
                    <select
                      value={item.status}
                      onChange={e => updateFeatureTodoStatus(item.id, e.target.value)}
                      style={{ background: 'var(--input-bg, #1a1a2e)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 6px', fontSize: '0.82em' }}
                    >
                      {STATUSES.map(s => (
                        <option key={s} value={s}>{STATUS_META[s].label}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <StandardButton buttonText="Edit" onClick={() => startEditFeatureTodo(item)} />
                    <StandardButton buttonText="Delete" onClick={() => deleteFeatureTodoItem(item.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  const renderPhysicalBoardRequestsTab = () => {
    const statusBadge = (status) => {
      const colorMap = {
        pending:   { bg: 'rgba(255, 200, 50, 0.15)',  border: 'rgba(255, 200, 50, 0.4)',  text: '#ffc832' },
        fulfilled: { bg: 'rgba(80, 200, 120, 0.15)',  border: 'rgba(80, 200, 120, 0.4)',  text: '#50c878' },
        dismissed: { bg: 'rgba(150, 150, 150, 0.15)', border: 'rgba(150, 150, 150, 0.4)', text: '#aaa' },
      };
      const c = colorMap[status] || colorMap.dismissed;
      return (
        <span style={{
          display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
          background: c.bg, border: `1px solid ${c.border}`, color: c.text,
          fontSize: '0.75em', fontWeight: 600, textTransform: 'uppercase',
        }}>{status}</span>
      );
    };

    return (
      <div className={styles["table-container"]}>
        <div className={styles["table-header"]} style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <div style={{ fontWeight: 600 }}>Physical Board Requests</div>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginTop: '4px' }}>
              Requests submitted from the game detail page asking for a custom handcrafted physical board.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <label style={{ fontSize: '0.85em', color: 'var(--text-dim)' }}>Status:</label>
            <select
              value={physicalBoardRequestsFilter}
              onChange={(e) => {
                setPhysicalBoardRequestsFilter(e.target.value);
                fetchPhysicalBoardRequests(1, e.target.value);
              }}
              style={{ padding: '4px 8px' }}
            >
              <option value="pending">Pending</option>
              <option value="fulfilled">Fulfilled</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All</option>
            </select>
            <StandardButton
              onClick={() => fetchPhysicalBoardRequests(physicalBoardRequestsPagination.page, physicalBoardRequestsFilter)}
              buttonText="Refresh"
              disabled={physicalBoardRequestsLoading}
            />
          </div>
        </div>
        {physicalBoardRequestsLoading ? (
          <div className={styles["loading"]}>Loading…</div>
        ) : physicalBoardRequests.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '30px 0' }}>
            No physical board requests in this view.
          </p>
        ) : (
          <table className={styles["table"]}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Requester</th>
                <th>Game</th>
                <th>Grid</th>
                <th>Dimensions</th>
                <th>Wood</th>
                <th>Submitted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {physicalBoardRequests.map((r) => (
                <tr key={r.id}>
                  <td>{statusBadge(r.status)}</td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{r.name}</div>
                    <div style={{ fontSize: '0.8em', color: 'var(--text-dim)' }}>{r.email}</div>
                  </td>
                  <td>
                    {r.game_name ? (
                      <a href={`/games/${r.game_id}`} target="_blank" rel="noreferrer">{r.game_name}</a>
                    ) : (
                      <span style={{ color: 'var(--text-dim)' }}>{r.game_id ? `Game #${r.game_id}` : '—'}</span>
                    )}
                  </td>
                  <td style={{ fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                    {r.board_grid_width && r.board_grid_height ? `${r.board_grid_width}×${r.board_grid_height}` : '—'}
                  </td>
                  <td style={{ fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                    {r.board_length_dim && r.board_width_dim
                      ? `${r.board_length_dim}×${r.board_width_dim} ${r.dimension_unit || ''}`
                      : '—'}
                  </td>
                  <td style={{ fontSize: '0.8em' }}>
                    {[
                      r.border_wood && r.border_wood !== 'No preference' ? `Border: ${r.border_wood}` : null,
                      r.light_square_wood && r.light_square_wood !== 'No preference' ? `Light: ${r.light_square_wood}` : null,
                      r.dark_square_wood && r.dark_square_wood !== 'No preference' ? `Dark: ${r.dark_square_wood}` : null,
                    ].filter(Boolean).join(' / ') || '—'}
                  </td>
                  <td style={{ fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                    {r.created_at ? formatDateTime(parseServerDate(r.created_at)) : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {r.status !== 'fulfilled' && (
                        <StandardButton buttonText="Mark Fulfilled" onClick={() => setPhysicalBoardRequestStatus(r.id, 'fulfilled')} />
                      )}
                      {r.status !== 'dismissed' && r.status !== 'fulfilled' && (
                        <StandardButton buttonText="Dismiss" onClick={() => setPhysicalBoardRequestStatus(r.id, 'dismissed')} />
                      )}
                      {r.status !== 'pending' && (
                        <StandardButton buttonText="Reopen" onClick={() => setPhysicalBoardRequestStatus(r.id, 'pending')} />
                      )}
                      <StandardButton buttonText="Delete" onClick={() => deletePhysicalBoardRequest(r.id)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {physicalBoardRequestsPagination.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', padding: '15px 0' }}>
            <StandardButton
              buttonText="Previous"
              onClick={() => fetchPhysicalBoardRequests(physicalBoardRequestsPagination.page - 1, physicalBoardRequestsFilter)}
              disabled={physicalBoardRequestsPagination.page <= 1}
            />
            <span style={{ fontSize: '0.9em' }}>
              Page {physicalBoardRequestsPagination.page} of {physicalBoardRequestsPagination.totalPages}
            </span>
            <StandardButton
              buttonText="Next"
              onClick={() => fetchPhysicalBoardRequests(physicalBoardRequestsPagination.page + 1, physicalBoardRequestsFilter)}
              disabled={physicalBoardRequestsPagination.page >= physicalBoardRequestsPagination.totalPages}
            />
          </div>
        )}
      </div>
    );
  };

  const renderUserGrowthTab = () => {
    const switchView = (v) => {
      if (v === userGrowthView) return;
      setUserGrowthView(v);
      fetchUserGrowth(v);
    };
    const pts = userGrowthData?.data || [];
    // Chart dimensions
    const W = 700, H = 220, PL = 52, PR = 20, PT = 16, PB = 36;
    const cW = W - PL - PR;
    const cH = H - PT - PB;
    const minTotal = pts.length > 0 ? Math.min(...pts.map(p => p.total)) : 0;
    const maxTotal = pts.length > 0 ? Math.max(...pts.map(p => p.total)) : 1;
    const dataRange = maxTotal - minTotal || 1;
    // Add 10% padding so the line isn't flush against the edges
    const yMin = Math.max(0, minTotal - Math.ceil(dataRange * 0.1));
    const yMax = maxTotal + Math.ceil(dataRange * 0.1);
    const yRange = yMax - yMin || 1;
    const toX = (i) => PL + (pts.length > 1 ? (i / (pts.length - 1)) * cW : cW / 2);
    const toY = (v) => PT + cH - ((v - yMin) / yRange) * cH;
    // Build SVG path
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.total).toFixed(1)}`).join(' ');
    const areaPath = pts.length > 0
      ? `${linePath} L${toX(pts.length - 1).toFixed(1)},${(PT + cH).toFixed(1)} L${toX(0).toFixed(1)},${(PT + cH).toFixed(1)} Z`
      : '';
    // Y-axis tick labels (4–5 ticks)
    const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => yMin + Math.round(f * yRange));
    // X-axis label spacing — show at most ~8 labels
    const xStep = Math.max(1, Math.ceil(pts.length / 8));
    const hoveredPt = userGrowthHover !== null ? pts[userGrowthHover] : null;
    return (
      <div className={styles["table-container"]}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: '1.1em' }}>User Account Growth</span>
            <span style={{ marginLeft: '10px', color: 'var(--text-dim)', fontSize: '0.85em' }}>Total registered accounts over time</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {userGrowthLoading && <span style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>Loading…</span>}
            {(['daily', 'weekly', 'monthly']).map(v => (
              <button
                key={v}
                onClick={() => switchView(v)}
                style={{ padding: '6px 16px', borderRadius: '4px', border: '1px solid var(--border-color, #444)', background: userGrowthView === v ? 'var(--accent-primary, #6c63ff)' : 'transparent', color: userGrowthView === v ? '#fff' : 'var(--text)', cursor: 'pointer', fontSize: '0.85em', fontWeight: userGrowthView === v ? 600 : 400 }}
              >{v.charAt(0).toUpperCase() + v.slice(1)}</button>
            ))}
            <StandardButton onClick={() => fetchUserGrowth(userGrowthView)} buttonText="Refresh" disabled={userGrowthLoading} />
          </div>
        </div>
        {userGrowthError && <p style={{ color: 'var(--text-danger, #e55)', marginBottom: '12px' }}>{userGrowthError}</p>}
        {pts.length === 0 && !userGrowthLoading && !userGrowthError && (
          <p style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0' }}>No user data found.</p>
        )}
        {pts.length > 0 && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                style={{ width: '100%', maxWidth: `${W}px`, height: 'auto', display: 'block', fontFamily: 'inherit', userSelect: 'none' }}
                onMouseLeave={() => setUserGrowthHover(null)}
              >
                <defs>
                  <linearGradient id="ugAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6c63ff" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#6c63ff" stopOpacity="0.03" />
                  </linearGradient>
                </defs>
                {/* Y-axis grid + labels */}
                {yTicks.map((v, i) => (
                  <g key={i}>
                    <line x1={PL} y1={toY(v)} x2={PL + cW} y2={toY(v)} stroke="rgba(255,255,255,0.07)" strokeDasharray="3,3" />
                    <text x={PL - 6} y={toY(v) + 4} textAnchor="end" fontSize="10" fill="rgba(255,255,255,0.45)">{v}</text>
                  </g>
                ))}
                {/* Area fill */}
                {areaPath && <path d={areaPath} fill="url(#ugAreaGrad)" />}
                {/* Line */}
                {linePath && <path d={linePath} fill="none" stroke="#6c63ff" strokeWidth="2" strokeLinejoin="round" />}
                {/* X-axis labels */}
                {pts.map((p, i) => (
                  i % xStep === 0 && (
                    <text key={i} x={toX(i)} y={PT + cH + 16} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.45)">
                      {p.label}
                    </text>
                  )
                ))}
                {/* Hover hit zones */}
                {pts.map((p, i) => (
                  <rect
                    key={i}
                    x={toX(i) - (cW / (pts.length * 2))}
                    y={PT}
                    width={cW / pts.length}
                    height={cH}
                    fill="transparent"
                    style={{ cursor: 'crosshair' }}
                    onMouseEnter={() => setUserGrowthHover(i)}
                  />
                ))}
                {/* Hover indicator */}
                {hoveredPt !== null && userGrowthHover !== null && (
                  <g>
                    <line
                      x1={toX(userGrowthHover)} y1={PT}
                      x2={toX(userGrowthHover)} y2={PT + cH}
                      stroke="rgba(255,255,255,0.25)" strokeDasharray="3,3"
                    />
                    <circle cx={toX(userGrowthHover)} cy={toY(hoveredPt.total)} r={4} fill="#6c63ff" stroke="#fff" strokeWidth="1.5" />
                    <rect
                      x={Math.min(toX(userGrowthHover) + 8, W - 110)}
                      y={Math.max(PT, toY(hoveredPt.total) - 28)}
                      width={100} height={40} rx={4}
                      fill="var(--bg-card, #1a1a2e)" stroke="rgba(255,255,255,0.15)" strokeWidth={1}
                    />
                    <text
                      x={Math.min(toX(userGrowthHover) + 58, W - 60)}
                      y={Math.max(PT, toY(hoveredPt.total) - 28) + 14}
                      textAnchor="middle" fontSize="9.5" fill="rgba(255,255,255,0.65)"
                    >{hoveredPt.label}</text>
                    <text
                      x={Math.min(toX(userGrowthHover) + 58, W - 60)}
                      y={Math.max(PT, toY(hoveredPt.total) - 28) + 29}
                      textAnchor="middle" fontSize="11" fontWeight="600" fill="#fff"
                    >{hoveredPt.total.toLocaleString()} users (+{hoveredPt.signups})</text>
                  </g>
                )}
              </svg>
            </div>
            <div style={{ marginTop: '16px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              <div style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '8px', padding: '12px 18px', border: '1px solid var(--border-color, #333)' }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Total Accounts</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700 }}>{(pts[pts.length - 1]?.total || 0).toLocaleString()}</div>
              </div>
              <div style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '8px', padding: '12px 18px', border: '1px solid var(--border-color, #333)' }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Periods Tracked</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700 }}>{pts.length}</div>
              </div>
              <div style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '8px', padding: '12px 18px', border: '1px solid var(--border-color, #333)' }}>
                <div style={{ fontSize: '0.75em', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Peak {userGrowthView === 'weekly' ? 'Week' : userGrowthView === 'daily' ? 'Day' : 'Month'}</div>
                <div style={{ fontSize: '1.4em', fontWeight: 700 }}>
                  {pts.reduce((best, p) => p.signups > best.signups ? p : best, pts[0])?.label || '—'}
                  {' '}
                  <span style={{ fontSize: '0.65em', color: 'var(--text-dim)' }}>
                    ({Math.max(...pts.map(p => p.signups))} signups)
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderServerStatsTab = () => (
    <div className={styles["table-container"]}>
      <div className={styles["table-header"]} style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600 }}>Live Server Diagnostics</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {serverStatsLoading && <span style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>Refreshing…</span>}
          <StandardButton onClick={fetchServerStats} buttonText="Refresh" disabled={serverStatsLoading} />
        </div>
      </div>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.75em', margin: '0 0 10px 0' }}>
        Endpoint: <code>{`${API_URL}admin/memory-stats`}</code>
      </p>
      {serverStatsError && (
        <p style={{ textAlign: 'center', color: 'var(--text-danger, red)', padding: '30px 0', wordBreak: 'break-word' }}>{serverStatsError}</p>
      )}
      {!serverStats && !serverStatsLoading && !serverStatsError && (
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '30px 0' }}>No data loaded yet.</p>
      )}
      {serverStats && (() => {
        const num = (v) => (v == null ? '—' : String(v));
        const mb = (v) => (v == null ? '—' : `${v} MB`);
        const s = serverStats.uptimeSeconds ?? 0;
        const uptime = `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
        const fetchedAt = serverStats._fetchedAt ? new Date(serverStats._fetchedAt).toLocaleTimeString() : null;
        return (
          <>
            {fetchedAt && (
              <p style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginBottom: '12px' }}>
                Last refreshed: {fetchedAt}
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', padding: '4px 0' }}>
              {[
                { label: 'Uptime', value: uptime },
                { label: 'Active Games', value: num(serverStats.activeGames) },
                { label: 'Game Timers', value: num(serverStats.gameTimers) },
                { label: 'Disconnect Timeouts', value: num(serverStats.disconnectTimeouts) },
                { label: 'Online Users', value: num(serverStats.onlineUsers) },
                { label: '429s (since restart)', value: num(serverStats.rateLimitHits) },
                { label: 'DB Conn Limit', value: num(serverStats.dbPool?.limit) },
                { label: 'DB Connections (opened)', value: num(serverStats.dbPool?.total) },
                { label: 'DB Connections (active)', value: num(serverStats.dbPool?.active) },
                { label: 'DB Connections (idle)', value: num(serverStats.dbPool?.free) },
                { label: 'DB Queue Depth', value: num(serverStats.dbPool?.queued) },
                { label: 'RSS Memory (now)', value: mb(serverStats.memory?.rssMB) },
                { label: 'Peak RSS (since restart)', value: mb(serverStats.memory?.peakRssMB), highlight: (serverStats.memory?.peakRssMB ?? 0) > 800 },
                { label: 'Heap Used', value: mb(serverStats.memory?.heapUsedMB) },
                { label: 'Heap Total', value: mb(serverStats.memory?.heapTotalMB) },
                { label: 'External', value: mb(serverStats.memory?.externalMB) },
                { label: 'Array Buffers', value: mb(serverStats.memory?.arrayBuffersMB) },
                { label: 'Node Version', value: serverStats.nodeVersion || '—' },
              ].map(({ label, value, highlight }) => (
                <div key={label} style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '8px', padding: '14px 16px', border: `1px solid ${highlight ? 'var(--text-danger, #e55)' : 'var(--border-color, #333)'}` }}>
                  <div style={{ fontSize: '0.75em', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{label}</div>
                  <div style={{ fontSize: '1.25em', fontWeight: 700, color: highlight ? 'var(--text-danger, #e55)' : 'var(--text-primary, #fff)' }}>{value}</div>
                </div>
              ))}
            </div>
            {serverStats.memoryHistory && serverStats.memoryHistory.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <div style={{ fontWeight: 600, marginBottom: '10px', fontSize: '0.9em' }}>
                  Memory History (last {serverStats.memoryHistory.length} min)
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8em' }}>
                    <thead>
                      <tr style={{ color: 'var(--text-dim)', borderBottom: '1px solid var(--border-color, #333)' }}>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Time</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>RSS</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Heap Used</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>External</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Active Games</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Online Users</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...serverStats.memoryHistory].reverse().map((snap, i) => {
                        const highRss = snap.rss > 800;
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border-color, #222)', background: highRss ? 'rgba(220,60,60,0.08)' : 'transparent' }}>
                            <td style={{ padding: '4px 8px', color: 'var(--text-dim)' }}>{new Date(snap.t).toLocaleTimeString()}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', color: highRss ? 'var(--text-danger, #e55)' : 'inherit', fontWeight: highRss ? 700 : 400 }}>{snap.rss} MB</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{snap.heapUsed} MB</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{snap.external} MB</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{snap.activeGames}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right' }}>{snap.onlineUsers}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {(!serverStats.memoryHistory || serverStats.memoryHistory.length === 0) && (
              <p style={{ marginTop: '16px', color: 'var(--text-dim)', fontSize: '0.85em' }}>
                Memory history not yet available — snapshots are recorded every 60 seconds. Check back in a minute.
              </p>
            )}
          </>
        );
      })()}

      {/* Storage & Disk Metrics */}
      <div style={{ marginTop: '32px', borderTop: '1px solid var(--border-color, #333)', paddingTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontWeight: 600 }}>Storage &amp; Disk Metrics</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {storageStatsLoading && <span style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>Loading…</span>}
            <StandardButton onClick={fetchStorageStats} buttonText="Load storage metrics" disabled={storageStatsLoading} />
          </div>
        </div>
        {storageStatsError && (
          <p style={{ color: 'var(--text-danger, red)', fontSize: '0.85em', wordBreak: 'break-word' }}>{storageStatsError}</p>
        )}
        {!storageStats && !storageStatsLoading && !storageStatsError && (
          <p style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>Click "Load storage metrics" to fetch disk and table stats. This may take a few seconds on large directories.</p>
        )}
        {storageStats && (() => {
          const fmtBytes = (b) => {
            if (b == null) return '—';
            if (b >= 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
            if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
            return `${(b / 1024).toFixed(0)} KB`;
          };
          const fetchedAt = storageStats._fetchedAt ? new Date(storageStats._fetchedAt).toLocaleTimeString() : null;

          const renderDiskBar = (disk) => {
            if (!disk) return <p style={{ color: 'var(--text-dim)', fontSize: '0.78em', marginBottom: '8px' }}>Disk info unavailable.</p>;
            const pct = Math.round(disk.usedBytes / disk.totalBytes * 100);
            const hi = pct > 85;
            return (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '0.78em', color: 'var(--text-dim)', marginBottom: '5px' }}>Disk: {pct}% used</div>
                <div style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden', marginBottom: '5px', maxWidth: '400px' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: hi ? 'var(--text-danger, #e55)' : 'var(--accent, #7289da)', borderRadius: '4px' }} />
                </div>
                <div style={{ fontSize: '0.78em', color: 'var(--text-dim)' }}>
                  Used: <strong style={{ color: hi ? 'var(--text-danger, #e55)' : 'inherit' }}>{fmtBytes(disk.usedBytes)}</strong>
                  {' / Total: '}<strong>{fmtBytes(disk.totalBytes)}</strong>
                  {' / Free: '}<strong>{fmtBytes(disk.freeBytes)}</strong>
                </div>
              </div>
            );
          };

          const renderCardGroup = (cards) => (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '10px', marginBottom: '16px' }}>
              {cards.map(({ label, value }) => (
                <div key={label} style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '8px', padding: '12px 14px', border: '1px solid var(--border-color, #333)' }}>
                  <div style={{ fontSize: '0.7em', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{label}</div>
                  <div style={{ fontSize: '1.1em', fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
          );

          const sectionLabel = (title, subtitle) => (
            <div style={{ marginBottom: '10px', marginTop: '18px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ fontSize: '0.82em', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{title}</span>
              {subtitle && <span style={{ fontSize: '0.75em', color: 'var(--text-dim)' }}>{subtitle}</span>}
            </div>
          );

          // --- Backend cards ---
          const bdirs = storageStats.folderSizes || {};
          const bMeasured = Object.values(bdirs).reduce((a, b) => a + (b || 0), 0) + (storageStats.dbSizeBytes || 0);
          const bUnaccounted = storageStats.diskSpace ? Math.max(0, storageStats.diskSpace.usedBytes - bMeasured) : null;
          const backendCards = [
            { label: 'MySQL database', value: fmtBytes(storageStats.dbSizeBytes) },
            { label: 'uploads/ (total)', value: fmtBytes(bdirs.uploads) },
            { label: 'pieces/', value: `${fmtBytes(bdirs.pieces)} (${storageStats.fileCounts?.pieces ?? '?'} files)` },
            { label: 'profile-pictures/', value: `${fmtBytes(bdirs.profilePictures)} (${storageStats.fileCounts?.profilePictures ?? '?'} files)` },
            { label: 'dm-images/', value: fmtBytes(bdirs.dmImages) },
            { label: 'PM2 logs/', value: fmtBytes(bdirs.logs) },
            { label: 'node_modules/ (server)', value: fmtBytes(bdirs.nodeModules) },
            { label: 'ai-engine-rs/target/', value: fmtBytes(bdirs.rustTarget) },
            { label: '.git/ history', value: fmtBytes(bdirs.gitDir) },
            { label: 'OS & system (est.)', value: fmtBytes(bUnaccounted) },
          ];

          // --- Frontend cards (live from the frontend EC2 via proxy endpoint) ---
          const fdirs = frontendStorageStats?.folderSizes || {};
          const fMeasured = Object.values(fdirs).reduce((a, b) => a + (b || 0), 0);
          const fUnaccounted = frontendStorageStats?.diskSpace
            ? Math.max(0, frontendStorageStats.diskSpace.usedBytes - fMeasured) : null;
          const frontendCards = [
            { label: 'ai-training/', value: fmtBytes(fdirs.aiTraining) },
            { label: 'node_modules/ (server)', value: fmtBytes(fdirs.nodeModules) },
            { label: 'node_modules/ (frontend)', value: fmtBytes(fdirs.frontendNodeModules) },
            { label: 'frontend build/', value: fmtBytes(fdirs.frontendBuild) },
            { label: 'PM2 logs/', value: fmtBytes(fdirs.logs) },
            { label: 'uploads/', value: fmtBytes(fdirs.uploads) },
            ...(fUnaccounted != null ? [{ label: 'OS & system (est.)', value: fmtBytes(fUnaccounted) }] : []),
          ];

          return (
            <>
              {fetchedAt && <p style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginBottom: '8px' }}>Last fetched: {fetchedAt}</p>}

              {sectionLabel('Backend EC2 (t3.small)', '— database, uploads, server')}
              {renderDiskBar(storageStats.diskSpace)}
              {renderCardGroup(backendCards)}

              {sectionLabel('Frontend EC2 (t3.medium)', '— AI training, React app')}
              {frontendStorageStatsError
                ? <p style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginBottom: '12px', fontStyle: 'italic' }}>{frontendStorageStatsError}</p>
                : frontendStorageStats
                  ? <>{renderDiskBar(frontendStorageStats.diskSpace)}{renderCardGroup(frontendCards)}</>
                  : <p style={{ color: 'var(--text-dim)', fontSize: '0.8em', marginBottom: '12px' }}>Frontend EC2 stats not loaded.</p>
              }

              {storageStats.rowCounts && (
                <div style={{ marginTop: '18px' }}>
                  <div style={{ fontSize: '0.8em', color: 'var(--text-dim)', marginBottom: '8px' }}>DB Table Row Counts</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {Object.entries(storageStats.rowCounts).map(([table, count]) => (
                      <div key={table} style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '6px', padding: '8px 12px', border: '1px solid var(--border-color, #333)', fontSize: '0.85em' }}>
                        <span style={{ color: 'var(--text-dim)' }}>{table}: </span>
                        <strong>{count != null ? count.toLocaleString() : '—'}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );

  const renderOnlinePlayersTab = () => (
    <div className={styles["table-container"]}>
      <div className={styles["table-header"]} style={{ marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className={styles["online-count"]}>{onlinePlayers.length} player{onlinePlayers.length !== 1 ? 's' : ''} online</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {onlineLoading && <span style={{ color: 'var(--text-dim)', fontSize: '0.85em' }}>Refreshing…</span>}
          <StandardButton onClick={fetchOnlinePlayers} buttonText="Refresh" disabled={onlineLoading} />
        </div>
      </div>
      {onlinePlayers.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', padding: '30px 0' }}>
          No players currently online.
        </p>
      ) : (
        <table className={styles["data-table"]}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Role</th>
              <th>ELO</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {onlinePlayers.map((user) => {
              const IDLE_MS = 10 * 60 * 1000;
              const lastActive = user.last_active_at ? new Date(user.last_active_at).getTime() : null;
              const isIdle = !lastActive || (Date.now() - lastActive) >= IDLE_MS;
              return (
              <tr key={user.id}>
                <td>{user.id}</td>
                <td>
                  <Link to={`/profile/${user.username}`} style={{ color: 'var(--text-info)', textDecoration: 'none' }}>
                    {user.username}
                  </Link>
                </td>
                <td>
                  <span className={styles[`role-${user.role}`]}>{user.role}</span>
                </td>
                <td>{user.elo}</td>
                <td>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    fontSize: '0.8em',
                    fontWeight: 600,
                    background: isIdle ? 'rgba(180,120,0,0.18)' : 'rgba(40,180,80,0.18)',
                    color: isIdle ? '#e6a817' : '#4caf50',
                    border: `1px solid ${isIdle ? '#e6a81755' : '#4caf5055'}`,
                  }}>
                    {isIdle ? 'Idle' : 'Active'}
                  </span>
                </td>
                <td>
                  <Link to={`/profile/${user.username}`} className={styles["edit-btn"]}>View</Link>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

  const renderModerationTab = () => (
    <div className={styles["table-container"]}>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold' }}>Filter:</span>
        {['pending_review', 'approved', 'rejected'].map(status => (
          <button
            key={status}
            className={`${styles["tab"]} ${moderationFilter === status ? styles["active"] : ""}`}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => { setModerationFilter(status); fetchModerationQueue(status); }}
          >
            {status === 'pending_review' ? 'Pending' : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>
      {moderationLoading ? (
        <div className={styles["loading"]}>Loading...</div>
      ) : moderationQueue.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No {moderationFilter === 'pending_review' ? 'pending' : moderationFilter} items in the moderation queue.
        </div>
      ) : (
        <table className={styles["data-table"]}>
          <thead>
            <tr>
              <th>Image</th>
              <th>Piece</th>
              <th>Uploader</th>
              <th>Reason</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {moderationQueue.map(item => (
              <tr key={item.id}>
                <td>
                  <img
                    src={`${ASSET_URL}${item.image_path}`}
                    alt="Pending"
                    style={{ width: 60, height: 60, objectFit: 'contain', background: '#222', borderRadius: 4 }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                </td>
                <td>
                  {item.piece_name || `Piece #${item.piece_id}`}
                </td>
                <td>{item.uploader_username || 'Unknown'}</td>
                <td style={{ fontSize: '0.85rem', maxWidth: 250, wordBreak: 'break-word' }}>
                  {item.auto_reason || 'N/A'}
                </td>
                <td style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                  {item.created_at ? formatDateTime(parseServerDate(item.created_at)) : 'N/A'}
                </td>
                <td>
                  {moderationFilter === 'pending_review' && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <StandardButton
                        buttonText="Approve"
                        onClick={() => handleModerationApprove(item.id)}
                        style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                      />
                      <StandardButton
                        buttonText="Reject"
                        onClick={() => handleModerationReject(item.id)}
                        style={{ fontSize: '0.8rem', padding: '4px 10px', background: '#c0392b' }}
                      />
                      <StandardButton
                        buttonText="Approve All for Piece"
                        onClick={() => handleApproveAllForPiece(item.piece_id)}
                        style={{ fontSize: '0.8rem', padding: '4px 10px', background: '#27ae60' }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderNameReviewTab = () => (
    <div className={styles["table-container"]}>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '15px', alignItems: 'center' }}>
        <span style={{ fontWeight: 'bold' }}>Filter:</span>
        {['pending_review', 'approved', 'rejected'].map(status => (
          <button
            key={status}
            className={`${styles["tab"]} ${nameReviewFilter === status ? styles["active"] : ""}`}
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => { setNameReviewFilter(status); fetchNameReviewQueue(status); }}
          >
            {status === 'pending_review' ? 'Pending' : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>
      {nameReviewLoading ? (
        <div className={styles["loading"]}>Loading...</div>
      ) : nameReviewQueue.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          No {nameReviewFilter === 'pending_review' ? 'pending' : nameReviewFilter} items in the name review queue.
        </div>
      ) : (
        <table className={styles["data-table"]}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Flagged Name</th>
              <th>Triggered Words</th>
              <th>Submitter</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {nameReviewQueue.map(item => (
              <tr key={item.id}>
                <td style={{ textTransform: 'capitalize', fontWeight: 'bold' }}>{item.item_type}</td>
                <td style={{ maxWidth: 200, wordBreak: 'break-word' }}>{item.flagged_name}</td>
                <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', maxWidth: 200, wordBreak: 'break-word' }}>
                  {item.triggered_words || 'N/A'}
                </td>
                <td>{item.submitter_username || 'Unknown'}</td>
                <td style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                  {item.created_at ? formatDateTime(parseServerDate(item.created_at)) : 'N/A'}
                </td>
                <td>
                  {nameReviewFilter === 'pending_review' && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      <StandardButton
                        buttonText="Approve"
                        onClick={() => handleNameReviewApprove(item.id)}
                        style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                      />
                      <StandardButton
                        buttonText="Reject"
                        onClick={() => handleNameReviewReject(item.id)}
                        style={{ fontSize: '0.8rem', padding: '4px 10px', background: '#c0392b' }}
                      />
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  const renderStreamsTab = () => (
    <div className={styles["table-container"]}>
      <div className={styles["table-header"]} style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Users manage their own Twitch channel from their profile settings. This view shows all registered channels and their current live status.
        </span>
        <button
          className={styles["edit-btn"]}
          style={{ whiteSpace: 'nowrap' }}
          onClick={fetchAdminUserStreams}
          disabled={adminUserStreamsLoading}
        >
          {adminUserStreamsLoading ? 'Refreshing...' : 'Refresh Status'}
        </button>
      </div>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>User</th>
            <th>Twitch Channel</th>
            <th>Status</th>
            <th>Viewers</th>
            <th>Category</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {adminUserStreamsLoading ? (
            <tr><td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>Loading...</td></tr>
          ) : adminUserStreams.length === 0 ? (
            <tr>
              <td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                No users have linked a Twitch channel yet. Users add their channel from{' '}
                <strong>Profile &rarr; Edit Account &rarr; Connected Accounts</strong>.
              </td>
            </tr>
          ) : (
            adminUserStreams.map(u => (
              <tr key={u.user_id}>
                <td>
                  <a href={`/profile/${u.username}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--link-color)' }}>
                    {u.username}
                  </a>
                </td>
                <td>
                  <a href={`https://twitch.tv/${u.twitch_channel}`} target="_blank" rel="noopener noreferrer" style={{ color: '#6441a5' }}>
                    {u.twitch_channel}
                  </a>
                </td>
                <td>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '4px 10px', borderRadius: '12px', fontSize: '0.85rem', fontWeight: '600',
                    background: u.is_live ? '#22c55e' : '#64748b', color: '#fff'
                  }}>
                    {u.is_live ? '\u25CF LIVE' : 'Offline'}
                  </span>
                </td>
                <td>{u.is_live ? (u.viewer_count || 0) : '—'}</td>
                <td>{u.is_live ? (u.game_name || '—') : '—'}</td>
                <td>
                  <button
                    className={styles["ban-btn"]}
                    onClick={() => handleRemoveUserTwitchChannel(u.user_id, u.username)}
                  >
                    Remove Channel
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );


  const renderEditModal = () => {
    if (!showEditModal || !editingItem) return null;

    const getEditableFields = () => {
      switch (activeTab) {
        case 'users':
          return [
            { key: 'username', label: 'Username', type: 'text' },
            { key: 'email', label: 'Email', type: 'email' },
            { key: 'first_name', label: 'First Name', type: 'text' },
            { key: 'last_name', label: 'Last Name', type: 'text' },
            { key: 'bio', label: 'Bio', type: 'textarea' },
            { key: 'role', label: 'Role', type: 'select', options: ['User', 'Admin', 'Moderator'] },
            { key: 'timezone', label: 'Timezone', type: 'text' },
            { key: 'lang', label: 'Language', type: 'text' },
            { key: 'country', label: 'Country', type: 'text' },
          ];
        case 'pieces':
          return [
            { key: 'piece_name', label: 'Name', type: 'text' },
            { key: 'piece_category', label: 'Category', type: 'text' },
            { key: 'piece_description', label: 'Description', type: 'textarea' },
          ];
        case 'games':
          return [
            { key: 'game_name', label: 'Game Name', type: 'text' },
            { key: 'game_type', label: 'Game Type', type: 'text' },
            { key: 'description', label: 'Description', type: 'textarea' },
            { key: 'board_width', label: 'Board Width', type: 'number' },
            { key: 'board_height', label: 'Board Height', type: 'number' },
          ];
        case 'forums':
          return [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'descript', label: 'Description', type: 'textarea' },
            { key: 'content', label: 'Content', type: 'textarea' },
            { key: 'genre', label: 'Genre', type: 'text' },
            { key: 'public', label: 'Public', type: 'checkbox' },
          ];
        case 'news':
          return [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'content', label: 'Content', type: 'textarea' },
          ];
        case 'streams':
          return [
            { key: 'title', label: 'Title', type: 'text' },
            { key: 'streamer_name', label: 'Streamer Name', type: 'text' },
            { key: 'stream_url', label: 'Stream URL', type: 'text' },
            { key: 'thumbnail_url', label: 'Thumbnail URL', type: 'text' },
            { key: 'platform', label: 'Platform', type: 'select', options: ['twitch', 'youtube', 'kick', 'other'] },
            { key: 'category', label: 'Category', type: 'select', options: ['tournament', 'tutorial', 'casual', 'community', 'other'] },
            { key: 'game_name', label: 'Game Name', type: 'text' },
            { key: 'description', label: 'Description', type: 'textarea' },
            { key: 'viewer_count', label: 'Viewer Count', type: 'number' },
            { key: 'is_live', label: 'Live', type: 'checkbox' },
            { key: 'is_featured', label: 'Featured', type: 'checkbox' },
          ];
        default:
          return [];
      }
    };

    return (
      <div className={styles["modal-overlay"]} onClick={() => setShowEditModal(false)}>
        <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
          <div className={styles["modal-header"]}>
            <h2>Edit {activeTab.slice(0, -1).charAt(0).toUpperCase() + activeTab.slice(1, -1)}</h2>
            <button className={styles["close-btn"]} onClick={() => setShowEditModal(false)}>×</button>
          </div>
          <div className={styles["modal-body"]}>
            {getEditableFields().map(field => (
              <div key={field.key} className={styles["form-field"]}>
                <label>{field.label}</label>
                {field.type === 'textarea' ? (
                  <textarea
                    value={editFormData[field.key] || ''}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                    rows={4}
                  />
                ) : field.type === 'select' ? (
                  <select
                    value={editFormData[field.key] || ''}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                  >
                    {field.options.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={!!editFormData[field.key]}
                    onChange={(e) => handleInputChange(field.key, e.target.checked ? 1 : 0)}
                  />
                ) : (
                  <input
                    type={field.type}
                    value={editFormData[field.key] || ''}
                    onChange={(e) => handleInputChange(field.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
          <div className={styles["modal-footer"]}>
            <button className={styles["cancel-btn"]} onClick={() => setShowEditModal(false)}>Cancel</button>
            <button className={styles["save-btn"]} onClick={handleSaveEdit}>Save Changes</button>
          </div>
        </div>
      </div>
    );
  };

  const renderBanModal = () => {
    if (!showBanModal || !banningUser) return null;

    return (
      <div className={styles["modal-overlay"]} onClick={() => setShowBanModal(false)}>
        <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
          <h2>Ban User: {banningUser.username}</h2>
          
          <div className={styles["form-group"]}>
            <label>Ban Reason <span style={{ color: 'red' }}>*</span></label>
            <textarea
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
              placeholder="Enter reason for ban..."
              rows="4"
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
          </div>

          <div className={styles["form-group"]}>
            <ToggleSwitch checked={isPermanentBan} onChange={(v) => setIsPermanentBan(v)} label="Permanent Ban" />
          </div>

          {!isPermanentBan && (
            <div className={styles["form-group"]}>
              <label>Ban Expiration Date</label>
              <input
                type="datetime-local"
                value={banExpiration}
                onChange={(e) => setBanExpiration(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
              />
            </div>
          )}

          <div className={styles["modal-footer"]}>
            <button className={styles["cancel-btn"]} onClick={() => setShowBanModal(false)}>
              Cancel
            </button>
            <button 
              className={styles["ban-btn"]} 
              onClick={handleBanSubmit}
              disabled={!banReason.trim()}
            >
              Ban User
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderDonorModal = () => {
    if (!showDonorModal || !donorUser) return null;
    const current = Number(donorUser.total_donations) || 0;
    const currentTier = current >= 50 ? '⭐ Gold' : current >= 5 ? '✦ Silver' : 'No badge';
    return (
      <div
        className={styles["modal-overlay"]}
        onMouseDown={(e) => { donorOverlayMouseDown.current = e.target === e.currentTarget; }}
        onClick={(e) => { if (e.target === e.currentTarget && donorOverlayMouseDown.current) setShowDonorModal(false); }}
      >
        <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()}>
          <div className={styles["modal-header"]}>
            <h2>Donor Badge: {donorUser.username}</h2>
          </div>
          <div className={styles["modal-body"]}>
            <p style={{ color: 'var(--text-dim)', marginBottom: 20 }}>
              Current tier: <strong>{currentTier}</strong>{current > 0 ? ` ($${current.toFixed(2)})` : ''}
            </p>
            <div className={styles["form-field"]}>
              <label>Total Donations ($) <span style={{ color: '#888', fontWeight: 400 }}>(0 = remove badge)</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={donorAmount}
                onChange={(e) => setDonorAmount(e.target.value)}
                placeholder="e.g. 10.00"
              />
              <small style={{ color: 'var(--text-dim)', marginTop: 6, display: 'block' }}>
                Silver badge: $5–$49.99 &nbsp;·&nbsp; Gold badge: $50+
              </small>
            </div>
            <div className={styles["form-field"]} style={{ marginTop: 16 }}>
              <ToggleSwitch
                checked={donorHideBadge}
                onChange={(v) => setDonorHideBadge(v)}
                label="Anonymous donation (hide badge on profile)"
              />
              <small style={{ color: 'var(--text-dim)', marginTop: 6, display: 'block' }}>
                When on, this user chose to donate anonymously and no badge is shown on their profile, even if they have donations. Turn this off to make their badge visible.
              </small>
            </div>
            <div className={styles["modal-footer"]}>
              <button className={styles["cancel-btn"]} onClick={() => setShowDonorModal(false)}>
                Cancel
              </button>
              <button
                className={styles["save-btn"]}
                onClick={handleDonorSubmit}
              >
                Update Badge
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!currentUser) {
    return <Navigate to="/login" state={{ message: "Please log in with an admin account to access the admin dashboard." }} />;
  }

  const userRole = currentUser.role?.toLowerCase();
  if (userRole !== 'admin' && userRole !== 'owner') {
    return <Navigate to="/" state={{ message: "Admin access required" }} />;
  }

  return (
    <div className={styles["admin-dashboard"]}>
      {showAlert && (
        <div className={styles["alert-container"]}>
          <div className={`${styles["alert-style"]} ${styles[`alert-${alertType}`]}`}>
            {alertMessage}
          </div>
        </div>
      )}

      <div className={styles["dashboard-header"]}>
        <h1>Admin Dashboard</h1>
        <StandardButton buttonText="Back to Home" onClick={() => navigate("/")} />
      </div>

      <div className={styles["tabs"]}>
        <button
          className={`${styles["tab"]} ${activeTab === "users" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("users")}
        >
          Users
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "pieces" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("pieces")}
        >
          Pieces
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "games" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("games")}
        >
          Games
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "drafts" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("drafts")}
        >
          Drafts
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "forums" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("forums")}
        >
          Forums
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "news" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("news")}
        >
          News
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "featured" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("featured")}
        >
          Featured
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "streams" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("streams")}
        >
          Streams
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "online" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("online")}
        >
          Online Players
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "anonymous-games" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("anonymous-games")}
        >
          Anonymous Games
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "private-games" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("private-games")}
        >
          Private Games
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "deleted-users" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("deleted-users")}
        >
          Deleted Users
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "settings" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("settings")}
          style={isAdmin2 ? { display: 'none' } : undefined}
        >
          Settings
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "moderation" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("moderation")}
        >
          Moderation
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "name-reviews" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("name-reviews")}
        >
          Name Reviews
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "server-stats" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("server-stats")}
        >
          Server Stats
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "ai-training" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("ai-training")}
          style={isAdmin2 ? { display: 'none' } : undefined}
        >
          AI Training
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "fairy-stockfish" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("fairy-stockfish")}
          style={isAdmin2 ? { display: 'none' } : undefined}
        >
          Fairy Stockfish
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "ai-analysis-requests" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("ai-analysis-requests")}
        >
          AI Analysis Requests
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "initial-state" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("initial-state")}
        >
          Initial Position Scan
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "poll" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("poll")}
          style={isAdmin2 ? { display: 'none' } : undefined}
        >
          Poll
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "user-growth" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("user-growth")}
        >
          User Growth
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "physical-board-requests" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("physical-board-requests")}
        >
          Board Requests
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "feature-todo" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("feature-todo")}
        >
          Feature TODO
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "traffic" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("traffic")}
        >
          Traffic
        </button>
      </div>

      <div className={styles["content"]}>
        {(activeTab !== 'server-stats' && activeTab !== 'ai-training' && activeTab !== 'initial-state' && activeTab !== 'ai-analysis-requests' && activeTab !== 'poll' && activeTab !== 'user-growth' && activeTab !== 'physical-board-requests' && activeTab !== 'feature-todo' && activeTab !== 'fairy-stockfish' && activeTab !== 'traffic' && loading) || (activeTab === 'featured' && featuredLoading) || (activeTab === 'settings' && settingsLoading) ? (
          <div className={styles["loading"]}>Loading...</div>
        ) : (
          <>
            {activeTab === "users" && renderUsersTable()}
            {activeTab === "pieces" && renderPiecesTable()}
            {activeTab === "games" && renderGamesTable()}
            {activeTab === "drafts" && renderDraftsTable()}
            {activeTab === "forums" && renderForumsTable()}
            {activeTab === "news" && renderNewsTable()}
            {activeTab === "featured" && renderFeaturedTab()}
            {activeTab === "streams" && renderStreamsTab()}
            {activeTab === "online" && renderOnlinePlayersTab()}
            {activeTab === "anonymous-games" && renderAnonymousGamesTable()}
            {activeTab === "private-games" && renderPrivateGamesTable()}
            {activeTab === "deleted-users" && renderDeletedUsersTable()}
            {activeTab === "moderation" && renderModerationTab()}
            {activeTab === "name-reviews" && renderNameReviewTab()}
            {activeTab === "server-stats" && renderServerStatsTab()}
            {activeTab === "ai-training" && <AiTrainingPanel initialAnalysisGameTypeId={aiPanelInitialGameTypeId} />}
            {activeTab === "fairy-stockfish" && <FairyStockfishPanel />}
            {activeTab === "ai-analysis-requests" && renderAiAnalysisRequestsTab()}
            {activeTab === "initial-state" && renderInitialStateTab()}
            {activeTab === "poll" && renderPollTab()}
            {activeTab === "user-growth" && renderUserGrowthTab()}
            {activeTab === "physical-board-requests" && renderPhysicalBoardRequestsTab()}
            {activeTab === "feature-todo" && renderFeatureTodoTab()}
            {activeTab === "traffic" && <TrafficPanel />}
            {activeTab === "settings" && (
              <div className={styles["settings-section"]}>
                <h3>Site Settings</h3>
                <div className={styles["setting-row"]}>
                  <div className={styles["setting-info"]}>
                    <span className={styles["setting-label"]}>Show Changelog</span>
                    <span className={styles["setting-desc"]}>Show or hide the changelog link in navigation and footer</span>
                  </div>
                  <ToggleSwitch
                    checked={siteSettings.changelog_enabled !== "false"}
                    onChange={(v) => updateSiteSetting("changelog_enabled", v)}
                    label=""
                  />
                </div>
                <div className={styles["setting-row"]}>
                  <div className={styles["setting-info"]}>
                    <span className={styles["setting-label"]}>Show Forum Invite Banner</span>
                    <span className={styles["setting-desc"]}>Display the gold banner above "Explore the Grove" inviting players to the forums</span>
                  </div>
                  <ToggleSwitch
                    checked={siteSettings.forum_invite_enabled !== "false"}
                    onChange={(v) => updateSiteSetting("forum_invite_enabled", v)}
                    label=""
                  />
                </div>
                <div className={styles["setting-textarea-row"]}>
                  <div className={styles["setting-info"]}>
                    <span className={styles["setting-label"]}>Forum Invite Banner Text</span>
                    <span className={styles["setting-desc"]}>The message shown to visitors in the gold banner. Line breaks are preserved.</span>
                  </div>
                  <textarea
                    className={styles["setting-textarea"]}
                    value={forumInviteDraft}
                    onChange={(e) => setForumInviteDraft(e.target.value)}
                    placeholder="Enter the message shown in the home page forum invite banner..."
                    maxLength={2000}
                  />
                  <div className={styles["setting-textarea-actions"]}>
                    <button
                      className={styles["setting-save-button"]}
                      disabled={savingForumInvite || forumInviteDraft === (siteSettings.forum_invite_text || '')}
                      onClick={async () => {
                        setSavingForumInvite(true);
                        await updateSiteSetting('forum_invite_text', forumInviteDraft);
                        setSavingForumInvite(false);
                      }}
                    >
                      {savingForumInvite ? 'Saving...' : 'Save Banner Text'}
                    </button>
                  </div>
                </div>

                {currentUser?.role?.toLowerCase() === 'owner' && (
                  <>
                    <h3 style={{ marginTop: '2rem' }}>Twitch Integration</h3>
                    <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                      Enter your Twitch application credentials to enable live stream detection on the Streams page.
                      Get these from{' '}
                      <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noopener noreferrer">dev.twitch.tv/console/apps</a>.
                      Leave a field blank to keep the existing value.
                    </p>
                    <div className={styles["setting-textarea-row"]}>
                      <div className={styles["setting-info"]}>
                        <span className={styles["setting-label"]}>Client ID</span>
                        <span className={styles["setting-desc"]}>The Client ID from your Twitch developer application</span>
                      </div>
                      <input
                        type="password"
                        className={styles["setting-input"] || undefined}
                        style={{ width: '100%', padding: '0.5rem', background: 'var(--input-bg)', border: '1px solid var(--panel-card-border)', borderRadius: '4px', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                        value={twitchClientIdDraft}
                        onChange={(e) => { setTwitchClientIdDraft(e.target.value); setTwitchCredsSaved(false); setTwitchCredsError(''); }}
                        placeholder="Paste new Client ID (leave blank to keep current)"
                        autoComplete="off"
                        maxLength={100}
                      />
                    </div>
                    <div className={styles["setting-textarea-row"]} style={{ marginTop: '0.75rem' }}>
                      <div className={styles["setting-info"]}>
                        <span className={styles["setting-label"]}>Client Secret</span>
                        <span className={styles["setting-desc"]}>The Client Secret from your Twitch developer application</span>
                      </div>
                      <input
                        type="password"
                        className={styles["setting-input"] || undefined}
                        style={{ width: '100%', padding: '0.5rem', background: 'var(--input-bg)', border: '1px solid var(--panel-card-border)', borderRadius: '4px', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                        value={twitchClientSecretDraft}
                        onChange={(e) => { setTwitchClientSecretDraft(e.target.value); setTwitchCredsSaved(false); setTwitchCredsError(''); }}
                        placeholder="Paste new Client Secret (leave blank to keep current)"
                        autoComplete="off"
                        maxLength={100}
                      />
                    </div>
                    {twitchCredsError && (
                      <p style={{ color: 'var(--error-color, #e05c5c)', fontSize: '0.85rem', marginTop: '0.5rem' }}>{twitchCredsError}</p>
                    )}
                    {twitchCredsSaved && (
                      <p style={{ color: 'var(--success-color, #4caf50)', fontSize: '0.85rem', marginTop: '0.5rem' }}>Credentials saved. Cache cleared — live status will refresh on the next poll.</p>
                    )}
                    <div className={styles["setting-textarea-actions"]}>
                      <button
                        className={styles["setting-save-button"]}
                        disabled={savingTwitchCreds || (!twitchClientIdDraft.trim() && !twitchClientSecretDraft.trim())}
                        onClick={async () => {
                          setSavingTwitchCreds(true);
                          setTwitchCredsError('');
                          setTwitchCredsSaved(false);
                          try {
                            const payload = {};
                            if (twitchClientIdDraft.trim()) payload.client_id = twitchClientIdDraft.trim();
                            if (twitchClientSecretDraft.trim()) payload.client_secret = twitchClientSecretDraft.trim();
                            await axios.put(`${API_URL}admin/twitch-credentials`, payload, { headers: authHeader() });
                            setTwitchClientIdDraft('');
                            setTwitchClientSecretDraft('');
                            setTwitchCredsSaved(true);
                          } catch (err) {
                            setTwitchCredsError(err?.response?.data?.message || 'Failed to save credentials.');
                          } finally {
                            setSavingTwitchCreds(false);
                          }
                        }}
                      >
                        {savingTwitchCreds ? 'Saving...' : 'Save Twitch Credentials'}
                      </button>
                    </div>
                  </>
                )}

                <h3 style={{ marginTop: '2rem' }}>Game Session Limits</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                  Maximum simultaneous games per user. Users already over the limit when it is lowered can finish their existing games.
                </p>
                {[
                  { key: 'game_limit_live', label: 'Live games (logged-in users)', desc: 'Max active/ready live games a logged-in user may be in at once', defaultVal: 8 },
                  { key: 'game_limit_correspondence', label: 'Correspondence games (logged-in users)', desc: 'Max waiting/active correspondence games a logged-in user may be in at once', defaultVal: 24 },
                  { key: 'game_limit_open', label: 'Open matches (logged-in users)', desc: 'Max open (waiting for opponent) matches a logged-in user may have at once', defaultVal: 8 },
                  { key: 'game_limit_live_anon', label: 'Live games (anonymous users)', desc: 'Max live games an anonymous (not logged-in) user may be in per browser session', defaultVal: 4 },
                  { key: 'game_limit_correspondence_anon', label: 'Correspondence games (anonymous users)', desc: 'Not currently enforced (anonymous users cannot create correspondence games)', defaultVal: 12 },
                  { key: 'game_limit_open_anon', label: 'Open matches (anonymous users)', desc: 'Max open anonymous games a guest may have waiting per browser session', defaultVal: 4 },
                ].map(({ key, label, desc, defaultVal }) => (
                  <div key={key} className={styles["setting-row"]}>
                    <div className={styles["setting-info"]}>
                      <span className={styles["setting-label"]}>{label}</span>
                      <span className={styles["setting-desc"]}>{desc}</span>
                    </div>
                    <NumberInput
                      value={Number(siteSettings[key] ?? defaultVal)}
                      onChange={(val) => updateSiteSetting(key, val)}
                      options={{ min: 1, max: 200 }}
                    />
                  </div>
                ))}

                <h3 style={{ marginTop: '2rem' }}>About Us Page</h3>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                  Edit the public-facing /community/about page. The Mission section accepts plain text — separate paragraphs with a blank line. The Team list is capped at {ABOUT_TEAM_MAX} entries.
                </p>

                <div className={styles["setting-textarea-row"]}>
                  <div className={styles["setting-info"]}>
                    <span className={styles["setting-label"]}>Our Mission Body Text</span>
                    <span className={styles["setting-desc"]}>Shown in the "Our Mission" section on the About page. Leave blank to fall back to the built-in default.</span>
                  </div>
                  <textarea
                    className={styles["setting-textarea"]}
                    value={aboutMissionDraft}
                    onChange={(e) => setAboutMissionDraft(e.target.value)}
                    placeholder="Write the mission statement..."
                    rows={8}
                    maxLength={4000}
                  />
                  <div className={styles["setting-textarea-actions"]}>
                    <button
                      className={styles["setting-save-button"]}
                      disabled={savingAboutMission || aboutMissionDraft === (siteSettings.about_mission_text || '')}
                      onClick={async () => {
                        setSavingAboutMission(true);
                        await updateSiteSetting('about_mission_text', aboutMissionDraft);
                        setSavingAboutMission(false);
                      }}
                    >
                      {savingAboutMission ? 'Saving...' : 'Save Mission Text'}
                    </button>
                  </div>
                </div>

                <div className={styles["setting-info"]} style={{ marginTop: '1.5rem' }}>
                  <span className={styles["setting-label"]}>
                    Team Members ({aboutTeamDraft.length}/{ABOUT_TEAM_MAX})
                  </span>
                  <span className={styles["setting-desc"]}>
                    Each entry can include a username (display name), a link (relative path like <code>/profile/Nisticism</code> or a full URL), a role, a short contribution paragraph, and a picture.
                  </span>
                </div>

                {aboutTeamDraft.map((member, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '110px 1fr',
                      gap: 12,
                      padding: 12,
                      marginTop: 8,
                      border: '1px solid var(--panel-border)',
                      borderRadius: 6,
                      background: 'rgba(0,0,0,0.05)',
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      {member.picture_url ? (
                        <img
                          src={
                            /^https?:\/\//i.test(member.picture_url)
                              ? member.picture_url
                              : `${process.env.REACT_APP_ASSET_URL || 'http://localhost:3001'}${member.picture_url}`
                          }
                          alt={member.username || 'team member'}
                          style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: '50%', display: 'block', margin: '0 auto 6px' }}
                        />
                      ) : (
                        <div
                          style={{
                            width: 90, height: 90, borderRadius: '50%',
                            background: 'var(--accent-primary)',
                            color: '#fff', fontSize: 32, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            margin: '0 auto 6px',
                          }}
                        >
                          {(member.username || '?').charAt(0).toUpperCase() || '?'}
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        id={`about-team-pic-${idx}`}
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setAboutTeamUploadingIdx(idx);
                          try {
                            const fd = new FormData();
                            fd.append('picture', file);
                            const res = await axios.post(
                              `${API_URL}admin/about/upload-picture`,
                              fd,
                              {
                                headers: {
                                  ...authHeader(),
                                  'Content-Type': 'multipart/form-data',
                                },
                              }
                            );
                            const url = res.data?.url;
                            if (url) {
                              setAboutTeamDraft((prev) => prev.map((m, i) => i === idx ? { ...m, picture_url: url } : m));
                            }
                          } catch (err) {
                            alert(err?.response?.data?.message || err.message || 'Upload failed');
                          } finally {
                            setAboutTeamUploadingIdx(null);
                            e.target.value = '';
                          }
                        }}
                      />
                      <button
                        type="button"
                        className={styles["setting-save-button"]}
                        style={{ fontSize: 12, padding: '4px 8px' }}
                        disabled={aboutTeamUploadingIdx === idx}
                        onClick={() => document.getElementById(`about-team-pic-${idx}`)?.click()}
                      >
                        {aboutTeamUploadingIdx === idx ? 'Uploading...' : (member.picture_url ? 'Replace' : 'Upload')}
                      </button>
                      {member.picture_url && (
                        <button
                          type="button"
                          style={{ fontSize: 12, padding: '4px 8px', marginTop: 4, background: 'transparent', border: '1px solid var(--panel-border)', color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 4 }}
                          onClick={() => setAboutTeamDraft((prev) => prev.map((m, i) => i === idx ? { ...m, picture_url: '' } : m))}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <label style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Username / display name</span>
                        <input
                          type="text"
                          value={member.username || ''}
                          maxLength={60}
                          onChange={(e) => setAboutTeamDraft((prev) => prev.map((m, i) => i === idx ? { ...m, username: e.target.value } : m))}
                          placeholder="e.g. Nisticism"
                        />
                      </label>
                      <label style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Profile link (optional — defaults to <code>/profile/&lt;username&gt;</code>)</span>
                        <input
                          type="text"
                          value={member.profile_link || ''}
                          maxLength={300}
                          onChange={(e) => setAboutTeamDraft((prev) => prev.map((m, i) => i === idx ? { ...m, profile_link: e.target.value } : m))}
                          placeholder="/profile/Nisticism  or  https://example.com/somebody"
                        />
                      </label>
                      <label style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Role</span>
                        <input
                          type="text"
                          value={member.role || ''}
                          maxLength={120}
                          onChange={(e) => setAboutTeamDraft((prev) => prev.map((m, i) => i === idx ? { ...m, role: e.target.value } : m))}
                          placeholder="Founder & Lead Developer"
                        />
                      </label>
                      <label style={{ display: 'grid', gap: 2, fontSize: 13 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Contribution / bio</span>
                        <textarea
                          value={member.contribution || ''}
                          maxLength={1000}
                          rows={3}
                          onChange={(e) => setAboutTeamDraft((prev) => prev.map((m, i) => i === idx ? { ...m, contribution: e.target.value } : m))}
                          placeholder="What this person does for the project."
                        />
                      </label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => setAboutTeamDraft((prev) => {
                            if (idx === 0) return prev;
                            const next = [...prev];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            return next;
                          })}
                        >
                          ↑ Move Up
                        </button>
                        <button
                          type="button"
                          disabled={idx === aboutTeamDraft.length - 1}
                          onClick={() => setAboutTeamDraft((prev) => {
                            if (idx === prev.length - 1) return prev;
                            const next = [...prev];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            return next;
                          })}
                        >
                          ↓ Move Down
                        </button>
                        <button
                          type="button"
                          style={{ marginLeft: 'auto', color: '#c0392b' }}
                          onClick={() => {
                            if (!window.confirm(`Remove team member "${member.username || 'this entry'}"?`)) return;
                            setAboutTeamDraft((prev) => prev.filter((_, i) => i !== idx));
                          }}
                        >
                          ✕ Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={styles["setting-save-button"]}
                    disabled={aboutTeamDraft.length >= ABOUT_TEAM_MAX}
                    onClick={() => setAboutTeamDraft((prev) => [
                      ...prev,
                      { username: '', profile_link: '', role: '', contribution: '', picture_url: '' },
                    ])}
                  >
                    + Add Team Member
                  </button>
                  <button
                    type="button"
                    className={styles["setting-save-button"]}
                    disabled={savingAboutTeam || JSON.stringify(aboutTeamDraft) === (siteSettings.about_team_members || '[]')}
                    onClick={async () => {
                      // Strip empty rows (no username AND no role AND no contribution AND no picture)
                      const cleaned = aboutTeamDraft.filter((m) =>
                        (m.username && m.username.trim()) ||
                        (m.role && m.role.trim()) ||
                        (m.contribution && m.contribution.trim()) ||
                        (m.picture_url && m.picture_url.trim())
                      ).slice(0, ABOUT_TEAM_MAX);
                      setSavingAboutTeam(true);
                      await updateSiteSetting('about_team_members', JSON.stringify(cleaned));
                      setAboutTeamDraft(cleaned);
                      setSavingAboutTeam(false);
                    }}
                  >
                    {savingAboutTeam ? 'Saving...' : 'Save Team'}
                  </button>
                </div>

                {/* Future Goals editor */}
                <div className={styles["settings-section"]} style={{ marginTop: '32px' }}>
                  <h3>Future Goals</h3>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '16px', fontSize: '0.9rem' }}>
                    Edit up to {ABOUT_GOALS_MAX} goals shown on the About page. Choose an icon from the picker or type any emoji.
                  </p>
                  {aboutGoalsDraft.map((goal, idx) => (
                    <div key={idx} style={{ background: 'var(--bg-deep)', borderRadius: '8px', padding: '16px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'center' }}>
                        <label style={{ color: 'var(--text-dim)', fontSize: '0.85rem', minWidth: '40px' }}>Icon</label>
                        <select
                          value={goal.icon}
                          onChange={(e) => {
                            const updated = [...aboutGoalsDraft];
                            updated[idx] = { ...updated[idx], icon: e.target.value };
                            setAboutGoalsDraft(updated);
                          }}
                          style={{ padding: '4px 8px', borderRadius: '4px', background: 'var(--panel-bg)', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', fontSize: '1.1rem' }}
                        >
                          {['🏆','🤖','📱','📚','♟️','🌍','🎮','⚡','🏅','🎯','🔬','🤝','🏗️','💻','🧩','🌐'].map(em => (
                            <option key={em} value={em}>{em}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={goal.icon}
                          maxLength={4}
                          placeholder="or type emoji"
                          onChange={(e) => {
                            const updated = [...aboutGoalsDraft];
                            updated[idx] = { ...updated[idx], icon: e.target.value };
                            setAboutGoalsDraft(updated);
                          }}
                          style={{ width: '80px', padding: '4px 8px', borderRadius: '4px', background: 'var(--panel-bg)', color: 'var(--text-primary)', border: '1px solid var(--panel-border)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <input
                          type="text"
                          value={goal.title}
                          maxLength={60}
                          placeholder="Goal title"
                          onChange={(e) => {
                            const updated = [...aboutGoalsDraft];
                            updated[idx] = { ...updated[idx], title: e.target.value };
                            setAboutGoalsDraft(updated);
                          }}
                          style={{ padding: '6px 10px', borderRadius: '4px', background: 'var(--panel-bg)', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', fontWeight: '600' }}
                        />
                        <textarea
                          value={goal.description}
                          maxLength={300}
                          placeholder="Goal description"
                          rows={3}
                          onChange={(e) => {
                            const updated = [...aboutGoalsDraft];
                            updated[idx] = { ...updated[idx], description: e.target.value };
                            setAboutGoalsDraft(updated);
                          }}
                          style={{ padding: '6px 10px', borderRadius: '4px', background: 'var(--panel-bg)', color: 'var(--text-primary)', border: '1px solid var(--panel-border)', resize: 'vertical' }}
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    className={styles["setting-save-button"]}
                    disabled={savingAboutGoals}
                    onClick={async () => {
                      setSavingAboutGoals(true);
                      await updateSiteSetting('about_future_goals', JSON.stringify(aboutGoalsDraft));
                      setSavingAboutGoals(false);
                    }}
                  >
                    {savingAboutGoals ? 'Saving...' : 'Save Goals'}
                  </button>
                </div>
              </div>
            )}
            {activeTab !== "featured" && activeTab !== "streams" && activeTab !== "settings" && activeTab !== "online" && activeTab !== "server-stats" && activeTab !== "moderation" && activeTab !== "user-growth" && activeTab !== "traffic" && renderPagination()}
          </>
        )}
      </div>

      {renderEditModal()}
      {renderBanModal()}
      {renderDonorModal()}
      {renderDraftDetailModal()}
      {showDeleteConfirm && pendingDeleteUser && (
        <ConfirmDeleteModal
          message={`Are you sure you want to permanently delete the account for "${pendingDeleteUser.username}"? This cannot be undone.`}
          onConfirm={handleDeleteUserConfirmed}
          onCancel={() => { setShowDeleteConfirm(false); setPendingDeleteUser(null); }}
        />
      )}
      {showPromoteModal && promoteTarget && (
        <div className={styles["modal-overlay"]} onClick={() => setShowPromoteModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className={styles["modal-header"]}>
              <h2>Promote {promoteTarget.username} to Admin</h2>
              <button className={styles["close-btn"]} onClick={() => setShowPromoteModal(false)}>×</button>
            </div>
            <div className={styles["modal-body"]}>
              <p style={{ marginBottom: '16px' }}>Select the admin level for this user:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="adminLevel"
                    value={1}
                    checked={promoteLevel === 1}
                    onChange={() => setPromoteLevel(1)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    <strong>Admin 1</strong> — Full admin access (all dashboard tabs, all delete actions)
                  </span>
                </label>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="adminLevel"
                    value={2}
                    checked={promoteLevel === 2}
                    onChange={() => setPromoteLevel(2)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    <strong>Admin 2</strong> — Restricted access (cannot delete users, game types, news, forums, or pieces; no access to Poll, Site Settings, or AI Training)
                  </span>
                </label>
              </div>
              {promoteLevel === 1 && (
                <div style={{ background: 'var(--bg-secondary, #2a2a2a)', border: '1px solid var(--accent-warning, #e6a817)', borderRadius: '6px', padding: '10px 14px', fontSize: '0.9em', color: 'var(--accent-warning, #e6a817)' }}>
                  <strong>Note:</strong> Admin 1 has more power — they have full access including Poll management, Site Settings, AI Training, and all delete operations. Only grant this level to highly trusted users.
                </div>
              )}
            </div>
            <div className={styles["modal-footer"]} style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '16px' }}>
              <button className={styles["edit-btn"]} onClick={() => setShowPromoteModal(false)}>Cancel</button>
              <button className={styles["promote-btn"]} onClick={handlePromoteConfirm}>
                Promote to Admin {promoteLevel}
              </button>
            </div>
          </div>
        </div>
      )}
      {showRestrictModal && restrictTarget && (
        <div className={styles["modal-overlay"]} onClick={() => setShowRestrictModal(false)}>
          <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className={styles["modal-header"]}>
              <h2>Restrict Game</h2>
              <button className={styles["close-btn"]} onClick={() => setShowRestrictModal(false)}>×</button>
            </div>
            <div className={styles["modal-body"]}>
              <p style={{ marginBottom: '12px', color: 'var(--text-dim)', fontSize: '0.9rem' }}>
                Restricting <strong style={{ color: 'var(--text-primary)' }}>{restrictTarget.game_name}</strong> will prevent public matchmaking. Only the creator can play it against the computer.
              </p>
              <p style={{ marginBottom: '8px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Select a reason:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                {RESTRICT_PRESETS.map(preset => (
                  <button
                    key={preset}
                    onClick={() => setRestrictReason(preset)}
                    style={{
                      textAlign: 'left', padding: '7px 12px', borderRadius: 6, cursor: 'pointer',
                      background: restrictReason === preset ? 'rgba(255,150,0,0.18)' : 'var(--panel-bg)',
                      border: restrictReason === preset ? '1px solid rgba(255,150,0,0.55)' : '1px solid var(--panel-border)',
                      color: restrictReason === preset ? '#ffb347' : 'var(--text-primary)',
                      fontSize: '0.88rem', transition: 'background 0.15s',
                    }}
                  >{preset}</button>
                ))}
              </div>
              <p style={{ marginBottom: '4px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Or type a custom reason:</p>
              <textarea
                value={restrictReason}
                onChange={(e) => setRestrictReason(e.target.value)}
                maxLength={500}
                rows={2}
                placeholder="Enter restriction reason..."
                style={{ width: '100%', resize: 'vertical', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--panel-border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.875rem', boxSizing: 'border-box' }}
              />
            </div>
            <div className={styles["modal-footer"]} style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '16px' }}>
              <button className={styles["edit-btn"]} onClick={() => setShowRestrictModal(false)}>Cancel</button>
              <button
                disabled={savingRestrict || !restrictReason.trim()}
                onClick={handleSaveRestriction}
                style={{ background: 'rgba(255,150,0,0.2)', color: '#ffb347', border: '1px solid rgba(255,150,0,0.5)', borderRadius: 4, padding: '6px 16px', cursor: savingRestrict || !restrictReason.trim() ? 'not-allowed' : 'pointer', opacity: savingRestrict || !restrictReason.trim() ? 0.6 : 1 }}
              >
                {savingRestrict ? 'Saving...' : 'Restrict Game'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
