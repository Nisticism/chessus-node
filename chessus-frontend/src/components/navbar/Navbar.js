import React, { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { RiMenu3Line, RiCloseLine } from 'react-icons/ri';
import { useDispatch, useSelector } from "react-redux";
import { logout, removeUsers } from "../../actions/auth";
import logo from '../../assets/logo.svg';
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
        <Link className="user-menu-item" to="/login" onClick={logOut}>
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

const Menu = ({ currentUser, logOut }) => {
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
          <span className={`chevron ${openSubmenu === 'play' ? 'open' : ''}`}>▼</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'play' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item upper-right-corner" to="/play">
          Browse open games
        </Link>
        <Link as="div" className="inner-menu-item" to="/sandbox">
          Sandbox
        </Link>
        <Link as="div" className="inner-menu-item" to="/create/games">
          View games
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/home">
          Play with friends
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
          <span className={`chevron ${openSubmenu === 'create' ? 'open' : ''}`}>▼</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'create' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item upper-right-corner" to="/create/game">
          Design a game
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/create/piece">
          Design a piece
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/create/pieces">
          View pieces
        </Link>
      </div>
    </div>

    
    {/* design a game, design a piece, browse games */}

    <div className="nav-item">
      <div className="nav-item-wrapper">
        <Link as="div" className="nav-item-inner" to="/media">Media</Link>
        <button className="submenu-toggle mobile-only" onClick={(e) => toggleSubmenu(e, 'media')} aria-label="Toggle Media submenu">
          <span className={`chevron ${openSubmenu === 'media' ? 'open' : ''}`}>▼</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'media' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item upper-right-corner" to="/forums">
          General forums
        </Link>
        <Link as="div" className="inner-menu-item" to="/forums/game">
          Game forums
        </Link>
        <Link as="div" className="inner-menu-item" to="/media/social">
          Social media
        </Link>
        <Link as="div" className="inner-menu-item" to="/media/streams">
          Streams
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/news">
          News
        </Link>
      </div>
    </div>
    {/* general forums, new game forums, social media, contact, news */}
    <div className="nav-item">
      <div className="nav-item-wrapper">
        <Link as="div" className="nav-item-inner" to="/community">Community</Link>
        <button className="submenu-toggle mobile-only" onClick={(e) => toggleSubmenu(e, 'community')} aria-label="Toggle Community submenu">
          <span className={`chevron ${openSubmenu === 'community' ? 'open' : ''}`}>▼</span>
        </button>
      </div>
      <div className={`inner-menu ${openSubmenu === 'community' ? 'mobile-open' : ''}`}>
        <Link as="div" className="inner-menu-item upper-right-corner" to="/community/players">
          Players
        </Link>
        <Link as="div" className="inner-menu-item" to="/community/leaderboard">
          Leaderboard
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/donate">
          Donate
        </Link>
      </div>
    </div>

    <div className="nav-item">
      <Link as="div" className="nav-item-inner" to="/contact">Contact
      </Link>
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
          <Link as="div" className="nav-item-inner" to="/login" onClick={logOut}>
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
  const dispatch = useDispatch();

  const logOut = () => {
    dispatch(removeUsers());
    dispatch(logout());
    navigate('/');
    setToggleMenu(false);
  };

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
              <img src={logo} alt="Squarestrat" className="logo-icon" />
              <span>SQUARESTRAT</span>
            </Link>
            <div className="navbar-links-container">
              <Menu currentUser={currentUser} logOut={logOut} />
            </div>
          </div>
          {currentUser ? (
            <div className="user-info desktop-only">
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
                <Link to="/login" className="nav-item-inner" onClick={logOut}>
                  Log Out
                </Link>
              </div>
            </div>
          ) : (
            <div className="navbar-nav ml-auto desktop-only">
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
                  <Menu currentUser={currentUser} logOut={logOut} />
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