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

const AdminDashboard = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const navigate = useNavigate();
  const location = useLocation();

  // Read ?tab= and ?gameTypeId= from the URL so other pages can deep-link
  // into a specific tab (e.g. the "Request AI analysis" button on game pages).
  const urlParams = new URLSearchParams(location.search);
  const tabFromUrl = urlParams.get('tab');
  const gameTypeIdFromUrl = urlParams.get('gameTypeId');

  const [activeTab, setActiveTab] = useState(tabFromUrl || "users");
  const [aiPanelInitialGameTypeId] = useState(gameTypeIdFromUrl ? parseInt(gameTypeIdFromUrl, 10) : null);
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
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
  const donorOverlayMouseDown = useRef(false);
  
  // Featured games states
  const [featuredGames, setFeaturedGames] = useState([null, null, null]); // 3 slots
  const [availableGames, setAvailableGames] = useState([]);
  const [featuredLoading, setFeaturedLoading] = useState(false);

  // Stream creation states
  const [showStreamModal, setShowStreamModal] = useState(false);
  const [streamFormData, setStreamFormData] = useState({
    title: '',
    streamer_name: '',
    description: '',
    stream_url: '',
    thumbnail_url: '',
    category: 'other',
    platform: 'other',
    is_live: false,
    is_featured: false,
    viewer_count: 0,
    game_name: ''
  });

  // Site settings state
  const [siteSettings, setSiteSettings] = useState({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  // Draft state for the editable forum-invite text (so admins can type without saving on every keystroke)
  const [forumInviteDraft, setForumInviteDraft] = useState('');
  const [savingForumInvite, setSavingForumInvite] = useState(false);

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

  const fetchData = useCallback(async (tab, page = 1) => {
    setLoading(true);
    try {
      const limit = pagination?.limit || 10;
      const response = await axios.get(
        `${API_URL}admin/${tab}?page=${page}&limit=${limit}`,
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
  }, [pagination?.limit, navigate]);

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
      
      // Build the 3 slots array
      const slots = [null, null, null];
      featured.forEach(game => {
        if (game.featured_order >= 1 && game.featured_order <= 3) {
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
      'users', 'pieces', 'games', 'drafts', 'forums', 'news', 'streams',
      'anonymous-games', 'private-games', 'deleted-users',
    ]);
    if (loadingTabs.has(tab)) setLoading(true);
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

  const handlePromote = async (user) => {
    if (!window.confirm(`Are you sure you want to promote ${user.username} to admin?`)) {
      return;
    }

    try {
      await axios.post(
        `${API_URL}admin/users/${user.id}/promote`,
        {},
        { headers: authHeader() }
      );

      setAlertType("success");
      setAlertMessage(`User ${user.username} has been promoted to admin`);
      setShowAlert(true);
      fetchData(activeTab, pagination.page);
    } catch (err) {
      setAlertType("error");
      setAlertMessage(err.response?.data?.message || "Failed to promote user");
      setShowAlert(true);
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
        { amount },
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

  const handleDeleteUser = async (user) => {
    if (!window.confirm(`Are you sure you want to permanently delete the account for "${user.username}"? This cannot be undone.`)) {
      return;
    }

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

  const renderUsersTable = () => (
    <div className={styles["table-container"]}>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Username</th>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Status</th>
            <th>ELO</th>
            <th>Last Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
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

                  {user.role !== 'owner' && (
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
                  <button className={styles["ban-btn"]} onClick={() => handleDeleteItem(piece, 'pieces')}>Delete</button>
                </div>
              </td>
            </tr>
          ))
          )}
        </tbody>
      </table>
    </div>
  );

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
              <td><Link to={`/games/${game.id}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{game.game_name}</Link></td>
              <td>{game.creator_name ? (game.real_creator_name ? <Link to={`/profile/${game.real_creator_name}`} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>{game.creator_name}</Link> : <span>{game.creator_name}</span>) : 'N/A'}</td>
              <td>{game.board_width}x{game.board_height}</td>
              <td>{game.player_count || 2}</td>
              <td>{game.play_count || 0}</td>
              <td>{game.last_played_at ? formatDateTime(game.last_played_at) : 'Never'}</td>
              <td>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                  <button className={styles["edit-btn"]} onClick={() => handleEdit(game)}>Edit</button>
                  <button className={styles["ban-btn"]} onClick={() => handleDeleteItem(game, 'games')}>Delete</button>
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
              <td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No anonymous games found'}
              </td>
            </tr>
          ) : (
            data.map(game => {
              const started = game.status === 'active' || game.status === 'completed';
              const ended = game.status === 'completed' || game.status === 'abandoned';
              return (
              <tr key={game.id}>
                <td>{game.id}</td>
                <td>{game.game_name || 'Unnamed'}</td>
                <td>{statusLabel(game.status)}</td>
                <td style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>{game.invite_code}</td>
                <td>{game.turn_length ? `${game.turn_length}+${game.increment || 0}` : 'No limit'}</td>
                <td>{game.move_count ?? 0}</td>
                <td>{game.created_at ? formatDateTime(game.created_at) : 'N/A'}</td>
                <td>{started ? (game.start_time ? formatDateTime(game.start_time) : '—') : '—'}</td>
                <td>{ended ? (game.end_time ? formatDateTime(game.end_time) : '—') : '—'}</td>
                <td>
                  {!ended && (
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
                  <button className={styles["ban-btn"]} onClick={() => handleDeleteForum(forum)}>Delete</button>
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
                  <button className={styles["ban-btn"]} onClick={() => handleDeleteNews(news)}>Delete</button>
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
        Select up to 3 games to feature on the homepage. These games will be displayed in the "Explore the Grove" section.
        Leave a slot empty to fall back to popular games.
      </p>
      
      <div className={styles["featured-slots"]}>
        {[0, 1, 2].map(slotIndex => (
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

  const handleCreateStream = () => {
    setStreamFormData({
      title: '',
      streamer_name: '',
      description: '',
      stream_url: '',
      thumbnail_url: '',
      category: 'other',
      platform: 'other',
      is_live: false,
      is_featured: false,
      viewer_count: 0,
      game_name: ''
    });
    setShowStreamModal(true);
  };

  const handleStreamFormChange = (field, value) => {
    setStreamFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveStream = async () => {
    try {
      if (!streamFormData.title || !streamFormData.streamer_name || !streamFormData.stream_url) {
        setAlertMessage("Title, streamer name, and stream URL are required");
        setAlertType('error');
        setShowAlert(true);
        return;
      }

      await axios.post(
        `${API_URL}admin/streams`,
        streamFormData,
        { headers: authHeader() }
      );

      setAlertMessage("Stream created successfully");
      setAlertType('success');
      setShowAlert(true);
      setShowStreamModal(false);
      fetchData('streams', pagination.page);
    } catch (error) {
      console.error("Error creating stream:", error);
      setAlertMessage("Failed to create stream: " + (error.response?.data?.message || error.message));
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const handleToggleLive = async (stream) => {
    try {
      await axios.post(
        `${API_URL}admin/streams/${stream.id}/toggle-live`,
        {},
        { headers: authHeader() }
      );

      setAlertMessage(`Stream is now ${!stream.is_live ? 'live' : 'offline'}`);
      setAlertType('success');
      setShowAlert(true);
      fetchData('streams', pagination.page);
    } catch (error) {
      console.error("Error toggling stream status:", error);
      setAlertMessage("Failed to toggle stream status");
      setAlertType('error');
      setShowAlert(true);
    }
  };

  const handleDeleteStream = async (stream) => {
    if (!window.confirm(`Are you sure you want to delete the stream "${stream.title}"?`)) {
      return;
    }

    try {
      await axios.delete(
        `${API_URL}admin/streams/${stream.id}`,
        { headers: authHeader() }
      );

      setAlertMessage("Stream deleted successfully");
      setAlertType('success');
      setShowAlert(true);
      fetchData('streams', pagination.page);
    } catch (error) {
      console.error("Error deleting stream:", error);
      setAlertMessage("Failed to delete stream");
      setAlertType('error');
      setShowAlert(true);
    }
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
                { label: 'RSS Memory', value: mb(serverStats.memory?.rssMB) },
                { label: 'Heap Used', value: mb(serverStats.memory?.heapUsedMB) },
                { label: 'Heap Total', value: mb(serverStats.memory?.heapTotalMB) },
                { label: 'External', value: mb(serverStats.memory?.externalMB) },
                { label: 'Array Buffers', value: mb(serverStats.memory?.arrayBuffersMB) },
                { label: 'Node Version', value: serverStats.nodeVersion || '—' },
              ].map(({ label, value }) => (
                <div key={label} style={{ background: 'var(--bg-card, #1a1a2e)', borderRadius: '8px', padding: '14px 16px', border: '1px solid var(--border-color, #333)' }}>
                  <div style={{ fontSize: '0.75em', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>{label}</div>
                  <div style={{ fontSize: '1.25em', fontWeight: 700, color: 'var(--text-primary, #fff)' }}>{value}</div>
                </div>
              ))}
            </div>
          </>
        );
      })()}
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
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {onlinePlayers.map((user) => (
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
                  <Link to={`/profile/${user.username}`} className={styles["edit-btn"]}>View</Link>
                </td>
              </tr>
            ))}
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
      <div className={styles["table-header"]} style={{ marginBottom: '15px' }}>
        <StandardButton onClick={handleCreateStream} buttonText="Add New Stream" />
      </div>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Streamer</th>
            <th>Platform</th>
            <th>Category</th>
            <th>Status</th>
            <th>Viewers</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-dim)' }}>
                {!data ? 'Loading...' : 'No streams found. Click "Add New Stream" to create one.'}
              </td>
            </tr>
          ) : (
            data.map(stream => (
              <tr key={stream.id}>
                <td>{stream.id}</td>
                <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {stream.title}
                </td>
                <td>{stream.streamer_name}</td>
                <td style={{ textTransform: 'capitalize' }}>{stream.platform}</td>
                <td style={{ textTransform: 'capitalize' }}>{stream.category}</td>
                <td>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 10px',
                    borderRadius: '12px',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    background: stream.is_live ? '#22c55e' : '#64748b',
                    color: '#fff'
                  }}>
                    {stream.is_live ? '● LIVE' : 'Offline'}
                  </span>
                </td>
                <td>{stream.viewer_count || 0}</td>
                <td>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button className={styles["edit-btn"]} onClick={() => handleEdit(stream)}>Edit</button>
                    <button 
                      className={styles["edit-btn"]} 
                      style={{ background: stream.is_live ? '#64748b' : '#22c55e' }}
                      onClick={() => handleToggleLive(stream)}
                    >
                      {stream.is_live ? 'Go Offline' : 'Go Live'}
                    </button>
                    <button 
                      className={styles["ban-btn"]} 
                      onClick={() => handleDeleteStream(stream)}
                    >
                      Delete
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

  const renderStreamModal = () => {
    if (!showStreamModal) return null;

    return (
      <div className={styles["modal-overlay"]} onClick={() => setShowStreamModal(false)}>
        <div className={styles["modal-content"]} onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
          <h2>Add New Stream</h2>
          
          <div className={styles["form-group"]}>
            <label>Title <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={streamFormData.title}
              onChange={(e) => handleStreamFormChange('title', e.target.value)}
              placeholder="Stream title..."
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
          </div>

          <div className={styles["form-group"]}>
            <label>Streamer Name <span style={{ color: 'red' }}>*</span></label>
            <input
              type="text"
              value={streamFormData.streamer_name}
              onChange={(e) => handleStreamFormChange('streamer_name', e.target.value)}
              placeholder="Streamer name..."
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
          </div>

          <div className={styles["form-group"]}>
            <label>Stream URL <span style={{ color: 'red' }}>*</span></label>
            <input
              type="url"
              value={streamFormData.stream_url}
              onChange={(e) => handleStreamFormChange('stream_url', e.target.value)}
              placeholder="https://twitch.tv/username or YouTube URL..."
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
          </div>

          <div className={styles["form-group"]}>
            <label>Thumbnail URL</label>
            <input
              type="url"
              value={streamFormData.thumbnail_url}
              onChange={(e) => handleStreamFormChange('thumbnail_url', e.target.value)}
              placeholder="https://example.com/thumbnail.jpg"
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
            <div className={styles["form-group"]}>
              <label>Platform</label>
              <select
                value={streamFormData.platform}
                onChange={(e) => handleStreamFormChange('platform', e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
              >
                <option value="twitch">Twitch</option>
                <option value="youtube">YouTube</option>
                <option value="kick">Kick</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className={styles["form-group"]}>
              <label>Category</label>
              <select
                value={streamFormData.category}
                onChange={(e) => handleStreamFormChange('category', e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
              >
                <option value="tournament">Tournament</option>
                <option value="tutorial">Tutorial</option>
                <option value="casual">Casual</option>
                <option value="community">Community</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          <div className={styles["form-group"]}>
            <label>Game Name</label>
            <input
              type="text"
              value={streamFormData.game_name}
              onChange={(e) => handleStreamFormChange('game_name', e.target.value)}
              placeholder="Name of the game being played..."
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
          </div>

          <div className={styles["form-group"]}>
            <label>Description</label>
            <textarea
              value={streamFormData.description}
              onChange={(e) => handleStreamFormChange('description', e.target.value)}
              placeholder="Stream description..."
              rows="3"
              style={{ width: '100%', padding: '10px', borderRadius: '5px', border: '1px solid #ccc' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '20px', marginTop: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={streamFormData.is_live}
                onChange={(e) => handleStreamFormChange('is_live', e.target.checked)}
              />
              Start as Live
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={streamFormData.is_featured}
                onChange={(e) => handleStreamFormChange('is_featured', e.target.checked)}
              />
              Featured
            </label>
          </div>

          <div className={styles["modal-footer"]}>
            <button className={styles["cancel-btn"]} onClick={() => setShowStreamModal(false)}>
              Cancel
            </button>
            <button className={styles["save-btn"]} onClick={handleSaveStream}>
              Add Stream
            </button>
          </div>
        </div>
      </div>
    );
  };

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
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input
                type="checkbox"
                checked={isPermanentBan}
                onChange={(e) => setIsPermanentBan(e.target.checked)}
              />
              Permanent Ban
            </label>
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
        >
          AI Training
        </button>
      </div>

      <div className={styles["content"]}>
        {(activeTab !== 'server-stats' && activeTab !== 'ai-training' && loading) || (activeTab === 'featured' && featuredLoading) || (activeTab === 'settings' && settingsLoading) ? (
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
            {activeTab === "settings" && (
              <div className={styles["settings-section"]}>
                <h3>Site Settings</h3>
                <div className={styles["setting-row"]}>
                  <div className={styles["setting-info"]}>
                    <span className={styles["setting-label"]}>Show Changelog</span>
                    <span className={styles["setting-desc"]}>Show or hide the changelog link in navigation and footer</span>
                  </div>
                  <label className={styles["setting-toggle"]}>
                    <input
                      type="checkbox"
                      checked={siteSettings.changelog_enabled !== "false"}
                      onChange={(e) => updateSiteSetting("changelog_enabled", e.target.checked)}
                    />
                    <span className={styles["toggle-slider"]} />
                  </label>
                </div>
                <div className={styles["setting-row"]}>
                  <div className={styles["setting-info"]}>
                    <span className={styles["setting-label"]}>Show Forum Invite Banner</span>
                    <span className={styles["setting-desc"]}>Display the gold banner above "Explore the Grove" inviting players to the forums</span>
                  </div>
                  <label className={styles["setting-toggle"]}>
                    <input
                      type="checkbox"
                      checked={siteSettings.forum_invite_enabled !== "false"}
                      onChange={(e) => updateSiteSetting("forum_invite_enabled", e.target.checked)}
                    />
                    <span className={styles["toggle-slider"]} />
                  </label>
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
              </div>
            )}
            {activeTab !== "featured" && activeTab !== "streams" && activeTab !== "settings" && activeTab !== "online" && activeTab !== "server-stats" && activeTab !== "moderation" && renderPagination()}
            {activeTab === "streams" && renderPagination()}
          </>
        )}
      </div>

      {renderEditModal()}
      {renderBanModal()}
      {renderDonorModal()}
      {renderStreamModal()}
      {renderDraftDetailModal()}
    </div>
  );
};

export default AdminDashboard;
