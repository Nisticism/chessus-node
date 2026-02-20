import React, { useState, useEffect, useCallback } from "react";
import { Navigate, useNavigate } from 'react-router-dom';
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./admin-dashboard.module.scss";
import StandardButton from "../standardbutton/StandardButton";
import { formatDateTime } from "../../helpers/date-formatter";

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
    fetchData(activeTab, 1);
  }, [activeTab, fetchData]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handlePageChange = (newPage) => {
    fetchData(activeTab, newPage);
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
              <td>{user.username}</td>
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
                        Until {new Date(user.ban_expires_at).toLocaleDateString()}
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
              <td>{piece.piece_name}</td>
              <td>{piece.piece_category || 'N/A'}</td>
              <td>{piece.creator_name || 'N/A'}</td>
              <td>
                {piece.movement_directional ? 'Directional' : piece.movement_ratio ? 'Ratio' : 'Step-by-step'}
              </td>
              <td>
                {piece.can_capture ? 'Yes' : 'No'}
              </td>
              <td>
                <button className={styles["edit-btn"]} onClick={() => handleEdit(piece)}>Edit</button>
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
            <th>Last Played</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!data || data.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
                {!data ? 'Loading...' : 'No games found'}
              </td>
            </tr>
          ) : (
            data.map(game => (
            <tr key={game.id}>
              <td>{game.id}</td>
              <td>{game.game_name}</td>
              <td>{game.creator_name || 'N/A'}</td>
              <td>{game.board_width}x{game.board_height}</td>
              <td>{game.player_count || 2}</td>
              <td>{game.last_played_at ? formatDateTime(game.last_played_at) : 'Never'}</td>
              <td>
                <button className={styles["edit-btn"]} onClick={() => handleEdit(game)}>Edit</button>
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
              <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: '#6b8ba8' }}>
                {!data ? 'Loading...' : 'No forum posts found'}
              </td>
            </tr>
          ) : (
            data.map(forum => (
            <tr key={forum.id}>
              <td>{forum.id}</td>
              <td>{forum.title}</td>
              <td>{forum.author_name}</td>
              <td>{forum.game_name || 'N/A'}</td>
              <td>{forum.genre}</td>
              <td>{forum.public ? 'Yes' : 'No'}</td>
              <td>{formatDateTime(forum.created_at)}</td>
              <td>
                <button className={styles["edit-btn"]} onClick={() => handleEdit(forum)}>Edit</button>
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
              <td>{news.title}</td>
              <td>{news.author_name}</td>
              <td>{formatDateTime(news.created_at)}</td>
              <td>
                <button className={styles["edit-btn"]} onClick={() => handleEdit(news)}>Edit</button>
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
      </div>

      <div className={styles["content"]}>
        {loading ? (
          <div className={styles["loading"]}>Loading...</div>
        ) : (
          <>
            {activeTab === "users" && renderUsersTable()}
            {activeTab === "pieces" && renderPiecesTable()}
            {activeTab === "games" && renderGamesTable()}
            {activeTab === "forums" && renderForumsTable()}
            {activeTab === "news" && renderNewsTable()}
            {renderPagination()}
          </>
        )}
      </div>

      {renderEditModal()}
      {renderBanModal()}
    </div>
  );
};

export default AdminDashboard;
