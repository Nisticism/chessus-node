import React, { useState, useEffect, useCallback } from "react";
import { Navigate, useNavigate, Link } from 'react-router-dom';
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./admin-dashboard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import { formatDateTime, parseServerDate } from "../../helpers/date-formatter";

const AdminDashboard = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState("users");
  const [data, setData] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(false);
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
    } else if (activeTab === 'settings') {
      fetchSiteSettings();
    } else {
      fetchData(activeTab, 1);
    }
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
    } catch (error) {
      console.error("Error fetching site settings:", error);
    } finally {
      setSettingsLoading(false);
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
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (newPage) => {
    if (activeTab === 'anonymous-games') {
      fetchAnonymousGames(newPage);
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
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
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
              <td colSpan="7" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
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
              <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
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

  const renderAnonymousGamesTable = () => (
    <div className={styles["table-container"]}>
      <table className={styles["data-table"]}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Game Name</th>
            <th>Status</th>
            <th>Invite Code</th>
            <th>Time Control</th>
            <th>Created</th>
            <th>Started</th>
            <th>Ended</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
                {!data ? 'Loading...' : 'No anonymous games found'}
              </td>
            </tr>
          ) : (
            data.map(game => (
            <tr key={game.id}>
              <td>{game.id}</td>
              <td>{game.game_name || 'Unnamed'}</td>
              <td>{game.status}</td>
              <td style={{ fontFamily: 'monospace', letterSpacing: '2px' }}>{game.invite_code}</td>
              <td>{game.turn_length ? `${game.turn_length}+${game.increment || 0}` : 'No limit'}</td>
              <td>{game.created_at ? formatDateTime(game.created_at) : 'N/A'}</td>
              <td>{game.start_time ? formatDateTime(game.start_time) : 'Not started'}</td>
              <td>{game.end_time ? formatDateTime(game.end_time) : 'In progress'}</td>
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
              <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
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
              <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
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
      <h2 style={{ marginBottom: '20px', color: '#4a90e2' }}>Featured Games on Homepage</h2>
      <p style={{ marginBottom: '30px', color: '#6b8ba8' }}>
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
              <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
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
          className={`${styles["tab"]} ${activeTab === "anonymous-games" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("anonymous-games")}
        >
          Anonymous Games
        </button>
        <button
          className={`${styles["tab"]} ${activeTab === "settings" ? styles["active"] : ""}`}
          onClick={() => handleTabChange("settings")}
        >
          Settings
        </button>
      </div>

      <div className={styles["content"]}>
        {loading || (activeTab === 'featured' && featuredLoading) || (activeTab === 'settings' && settingsLoading) ? (
          <div className={styles["loading"]}>Loading...</div>
        ) : (
          <>
            {activeTab === "users" && renderUsersTable()}
            {activeTab === "pieces" && renderPiecesTable()}
            {activeTab === "games" && renderGamesTable()}
            {activeTab === "forums" && renderForumsTable()}
            {activeTab === "news" && renderNewsTable()}
            {activeTab === "featured" && renderFeaturedTab()}
            {activeTab === "streams" && renderStreamsTab()}
            {activeTab === "anonymous-games" && renderAnonymousGamesTable()}
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
              </div>
            )}
            {activeTab !== "featured" && activeTab !== "streams" && activeTab !== "settings" && renderPagination()}
            {activeTab === "streams" && renderPagination()}
          </>
        )}
      </div>

      {renderEditModal()}
      {renderBanModal()}
      {renderStreamModal()}
    </div>
  );
};

export default AdminDashboard;
