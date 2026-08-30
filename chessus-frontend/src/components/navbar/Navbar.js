import React, { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { RiMenu3Line, RiCloseLine } from 'react-icons/ri';
import { IoNotificationsOutline, IoChatbubbleOutline } from 'react-icons/io5';
import { useDispatch, useSelector } from "react-redux";
import { logout, removeUsers } from "../../actions/auth";
import { getUnreadCount } from "../../actions/notifications";
import { getUnreadDMCount } from "../../actions/messages";
import logo from '../../assets/logo-light.png';
import ThemeMenu from './ThemeMenu';
import './navbar.scss';

// Simplified user menu for tablet range (751-1000px)
const UserMenu = ({ currentUser, logOut }) => (
  <div className="user-menu-simple">
    {currentUser ? (
      <>
        <Link className="user-menu-item" to={"/profile/" + currentUser.username}>
          👤 {currentUser.username}
        </Link>
        {(currentUser.role?.toLowerCase() === 'admin' || currentUser.role?.toLowerCase() === 'owner') && (
          <Link className="user-menu-item admin-link" to="/admin/dashboard">
            ⚡ Admin
          </Link>
        )}
        <Link className="user-menu-item logout-link" to="/login" onClick={logOut}>
          🚪 Log Out
        </Link>
      </>
    ) : (
      <Link className="user-menu-item" to="/login">
        🔑 Sign In
      </Link>
    )}
  </div>
);

const Menu = ({ currentUser, logOut, unreadCount, showChangelog }) => {
  const [openSubmenu, setOpenSubmenu] = useState(null);

  const toggleSubmenu = (e, menuName) => {
    e.preventDefault();
    e.stopPropagation();
    setOpenSubmenu(openSubmenu === menuName ? null : menuName);
  };

  return (
  <div className="navbar-inner navbar">
    <div className="nav-item">
      <div className="nav-item-wrapper">
        <Link as="div" className="nav-item-inner" to="/play">Play</Link>
        <button className="submenu-toggle mobile-only" onClick={(e) => toggleSubmenu(e, 'play')} aria-label="Toggle Play submenu">
          <span className={`chevron ${openSubmenu === 'play' ? 'open' : ''}`}>{`\u25BC`}</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'play' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item" to="/play/games">
          <span className="inner-menu-icon">🎯</span>Browse Open Games
        </Link>
        <Link as="div" className="inner-menu-item" to="/play/tournaments">
          <span className="inner-menu-icon">🏆</span>Tournaments
        </Link>
        <Link as="div" className="inner-menu-item" to="/sandbox">
          <span className="inner-menu-icon">🧪</span>Sandbox
        </Link>
        <Link as="div" className="inner-menu-item" to="/create/games">
          <span className="inner-menu-icon">📋</span>Game Library
        </Link>
      </div>
    </div>
    {/*
    Join a game
    Create a game
    Join a random open game
    Browse open games
    Play with friends */}
    <div className="nav-item">
      <div className="nav-item-wrapper">
        <Link as="div" className="nav-item-inner" to="/create">Create</Link>
        <button className="submenu-toggle mobile-only" onClick={(e) => toggleSubmenu(e, 'create')} aria-label="Toggle Create submenu">
          <span className={`chevron ${openSubmenu === 'create' ? 'open' : ''}`}>{`\u25BC`}</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'create' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item" to="/create/game">
          <span className="inner-menu-icon">🎲</span>New Game
        </Link>
        <Link as="div" className="inner-menu-item" to="/create/piece">
          <span className="inner-menu-icon">♟️</span>New Piece
        </Link>
        <Link as="div" className="inner-menu-item" to="/create/games">
          <span className="inner-menu-icon">📋</span>Game Library
        </Link>
        <Link as="div" className="inner-menu-item" to="/create/pieces">
          <span className="inner-menu-icon">👁️</span>Piece Library
        </Link>
      </div>
    </div>

    
    {/* design a game, design a piece, browse games */}

    <div className="nav-item">
      <div className="nav-item-wrapper">
        <Link as="div" className="nav-item-inner" to="/community">Community</Link>
        <button className="submenu-toggle mobile-only" onClick={(e) => toggleSubmenu(e, 'community')} aria-label="Toggle Community submenu">
          <span className={`chevron ${openSubmenu === 'community' ? 'open' : ''}`}>{`\u25BC`}</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'community' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item" to="/community/players">
          <span className="inner-menu-icon">🧑‍🤝‍🧑</span>Players
        </Link>
        <Link as="div" className="inner-menu-item" to="/forums">
          <span className="inner-menu-icon">💬</span>Forums
        </Link>
        <Link as="div" className="inner-menu-item" to="/community/social">
          <span className="inner-menu-icon">🌐</span>Social Media
        </Link>
        <Link as="div" className="inner-menu-item" to="/community/streams">
          <span className="inner-menu-icon">📺</span>Streams
        </Link>
      </div>
    </div>

    <div className="nav-item">
      <div className="nav-item-wrapper">
        <Link as="div" className="nav-item-inner" to="/info">Info</Link>
        <button className="submenu-toggle mobile-only" onClick={(e) => toggleSubmenu(e, 'info')} aria-label="Toggle Info submenu">
          <span className={`chevron ${openSubmenu === 'info' ? 'open' : ''}`}>{`\u25BC`}</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'info' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item" to="/news">
          <span className="inner-menu-icon">📰</span>News
        </Link>
        <Link as="div" className="inner-menu-item" to="/faq">
          <span className="inner-menu-icon">❓</span>FAQ
        </Link>
        <Link as="div" className="inner-menu-item" to="/community/about">
          <span className="inner-menu-icon">ℹ️</span>About Us
        </Link>
        <Link as="div" className="inner-menu-item" to="/contact">
          <span className="inner-menu-icon">✉️</span>Contact
        </Link>
        <Link as="div" className="inner-menu-item" to="/donate">
          <span className="inner-menu-icon">💝</span>Support GridGrove
        </Link>
      </div>
    </div>

    {/* <div className="nav-item">
      <Link as="div" className="nav-item-inner" to="/chess">Plain Old Chess
      </Link>
    </div> */}
    
    {/* Mobile-only user menu items */}
    {currentUser && (
      <>
        <div className="nav-item mobile-only">
          <Link as="div" className="nav-item-inner" to={"/profile/" + currentUser.username}>
            👤 {currentUser.username}
          </Link>
        </div>
        {(currentUser.role?.toLowerCase() === 'admin' || currentUser.role?.toLowerCase() === 'owner') && (
          <div className="nav-item mobile-only">
            <Link as="div" className="nav-item-inner admin-link" to="/admin/dashboard">
              ⚡ Admin
            </Link>
          </div>
        )}
        <div className="nav-item mobile-only">
          <Link as="div" className="nav-item-inner logout-link" to="/login" onClick={logOut}>
            🚪 Log Out
          </Link>
        </div>
      </>
    )}
    {!currentUser && (
      <div className="nav-item mobile-only">
        <Link as="div" className="nav-item-inner" to="/login">
          🔑 Sign In
        </Link>
      </div>
    )}
  </div>
  );
};

const Navbar = () => {
  const [toggleMenu, setToggleMenu] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  const { user: currentUser } = useSelector((state) => state.authReducer);
  const { unreadCount } = useSelector((state) => state.notifications);
  const { unreadDMCount } = useSelector((state) => state.messages);
  const { changelogEnabled: showChangelog } = useSelector((state) => state.siteSettings);
  const dispatch = useDispatch();

  const logOut = () => {
    dispatch(removeUsers());
    dispatch(logout());
    navigate('/');
    setToggleMenu(false);
  };

  // Fetch unread notification count on mount and when user changes
  useEffect(() => {
    if (currentUser) {
      dispatch(getUnreadCount(currentUser.id));
      dispatch(getUnreadDMCount(currentUser.id));
    }
  }, [currentUser, dispatch]);

  // Poll for unread count every 60 seconds
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      dispatch(getUnreadCount(currentUser.id));
      dispatch(getUnreadDMCount(currentUser.id));
    }, 60000);
    return () => clearInterval(interval);
  }, [currentUser, dispatch]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setToggleMenu(false);
      }
    };

    if (toggleMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [toggleMenu]);

  return (
    <div>
      <div className="navbar" id="navbar">
        <div className="navbar-links">
          <div className="nav-container">
            <Link to="/" className="main-logo">
              <img src={logo} alt="GridGrove" className="logo-icon" />
              <span>GRIDGROVE</span>
            </Link>
            <div className="navbar-links-container">
              <Menu currentUser={currentUser} logOut={logOut} unreadCount={unreadCount} showChangelog={showChangelog} />
            </div>
          </div>
          {currentUser ? (
            <div className="user-info desktop-only">
              <ThemeMenu />
              <div className="nav-item notification-bell-item">
                <Link to="/inbox" className="notification-bell" title="Messages">
                  <IoChatbubbleOutline size={20} />
                  {unreadDMCount > 0 && (
                    <span className="notification-badge">
                      {unreadDMCount > 99 ? "99+" : unreadDMCount}
                    </span>
                  )}
                </Link>
              </div>
              <div className="nav-item notification-bell-item">
                <Link to="/notifications" className="notification-bell" title="Notifications">
                  <IoNotificationsOutline size={22} />
                  {unreadCount > 0 && (
                    <span className="notification-badge">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </Link>
              </div>
              <div className="nav-item">
                <Link to={"/profile/" + currentUser.username} className="nav-item-inner">
                  {currentUser.username}
                </Link>
              </div>
              {(currentUser.role?.toLowerCase() === 'admin' || currentUser.role?.toLowerCase() === 'owner') && (
                <div className="nav-item">
                  <Link to="/admin/dashboard" className="nav-item-inner admin-link">
                    Admin
                  </Link>
                </div>
              )}
              <div className="nav-item">
                <Link to="/login" className="nav-item-inner logout-link" onClick={logOut}>
                  Log Out
                </Link>
              </div>
            </div>
          ) : (
            <div className="navbar-nav ml-auto desktop-only">
              <ThemeMenu />
              <div className="nav-item">
                <Link to={"/login"} className="nav-item-inner">
                  Sign In
                </Link>
              </div>
              {/* <li className="nav-item">
                <Link to={"/register"} className="nav-link">
                  Sign Up
                </Link>
              </li> */}
            </div>
          )}
        </div>
        <div className="navbar-menu" ref={menuRef}>
          {currentUser && (
            <>
              <Link to="/inbox" className="notification-bell navbar-menu-bell" title="Messages" style={{ marginRight: '4px' }}>
                <IoChatbubbleOutline size={20} />
                {unreadDMCount > 0 && (
                  <span className="notification-badge">
                    {unreadDMCount > 99 ? "99+" : unreadDMCount}
                  </span>
                )}
              </Link>
              <Link to="/notifications" className="notification-bell navbar-menu-bell" title="Notifications">
                <IoNotificationsOutline size={22} />
                {unreadCount > 0 && (
                  <span className="notification-badge">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            </>
          )}
          <ThemeMenu />
          { toggleMenu 
            ? <RiCloseLine color="fff" size={27} onClick={() => setToggleMenu(false)} />
            : <RiMenu3Line color="fff" size={27} onClick={() => setToggleMenu(true)} />
          }
          { toggleMenu && (
            <div className="navbar-menu-container scale-up-center">
              <div className="navbar-menu-container-links">
                {/* UserMenu for tablet (751-1000px) - only user controls */}
                <div className="tablet-menu-only">
                  <UserMenu currentUser={currentUser} logOut={logOut} />
                </div>
                {/* Full Menu for mobile (≤750px) - all nav + user controls */}
                <div className="mobile-menu-only">
                  <Menu currentUser={currentUser} logOut={logOut} unreadCount={unreadCount} showChangelog={showChangelog} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="navbar-border"></div>
    </div>
  )
}
 
export default Navbar;