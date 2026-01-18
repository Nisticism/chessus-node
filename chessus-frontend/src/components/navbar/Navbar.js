import React, { useState, useEffect } from "react";
import { Link, useNavigate } from 'react-router-dom';
import { RiMenu3Line, RiCloseLine } from 'react-icons/ri';
import { useDispatch, useSelector } from "react-redux";
import { logout, removeUsers } from "../../actions/auth";
import { clearMessage } from "../../actions/general";
import { history } from "../../helpers/history";
import './navbar.scss';

const Menu = () => (
  <div className="navbar-inner navbar">
    <div className="nav-item">
      <Link as="div" className="nav-item-inner" to="/play">Play
      </Link>
      <div className="inner-menu">
        <Link as="div" className="inner-menu-item upper-right-corner" to="/home">
          New game
        </Link>
        <Link as="div" className="inner-menu-item" to="/home">
          Browse open games
        </Link>
        <Link as="div" className="inner-menu-item" to="/home">
          Sandbox
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
      <Link as="div" className="nav-item-inner" to="/create">Create
      </Link>
      <div className="inner-menu">
        <Link as="div" className="inner-menu-item upper-right-corner" to="/create/game">
          Design a game
        </Link>
        <Link as="div" className="inner-menu-item" to="/create/piece">
          Design a piece
        </Link>
        <Link as="div" className="inner-menu-item" to="/games">
          View games
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/community/pieces">
          View pieces
        </Link>
      </div>
    </div>

    
    {/* design a game, design a piece, browse games */}

    <div className="nav-item">
      <Link as="div" className="nav-item-inner" to="/media">Media
      </Link>
      <div className="inner-menu">
        <Link as="div" className="inner-menu-item upper-right-corner" to="/forums">
          General forums
        </Link>
        <Link as="div" className="inner-menu-item" to="/home">
          Game forums
        </Link>
        <Link as="div" className="inner-menu-item" to="/home">
          Social media
        </Link>
        <Link as="div" className="inner-menu-item" to="/home">
          Streams
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/home">
          News
        </Link>
      </div>
    </div>
    {/* general forums, new game forums, social media, contact, news */}
    <div className="nav-item">
      <Link as="div" className="nav-item-inner" to="/community">Community
      </Link>
      <div className="inner-menu">
        <Link as="div" className="inner-menu-item upper-right-corner" to="/community/players">
          Players
        </Link>
        <Link as="div" className="inner-menu-item" to="/home">
          Leaderboard
        </Link>
        <Link as="div" className="inner-menu-item lower-corner" to="/home">
          Donate
        </Link>
      </div>
    </div>

    {/* <div className="nav-item">
      <Link as="div" className="nav-item-inner" to="/chess">Plain Old Chess
      </Link>
    </div> */}
    
    {/* players, donate, leaderboard */}
  </div>
)

const Navbar = () => {
  const [toggleMenu, setToggleMenu] = useState(false);
  const navigate = useNavigate();

  const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();

  const logOut = () => {
    dispatch(removeUsers());
    dispatch(logout());
    navigate('/');
  };

  return (
    <div>
      <div className="navbar" id="navbar">
        <div className="navbar-links">
          <div className="nav-container">
            <Link to="/" className="main-logo">SQUARESTRAT</Link>
            <div className="navbar-links-container">
              <Menu />
            </div>
          </div>
          {currentUser ? (
            <div className="user-info">
              <div className="nav-item">
                <Link to={"/profile/" + currentUser.username} className="nav-item-inner">
                  {currentUser.username}
                </Link>
              </div>
              <div className="nav-item">
                <Link to="/login" className="nav-item-inner" onClick={logOut}>
                  Log Out
                </Link>
              </div>
            </div>
          ) : (
            <div className="navbar-nav ml-auto">
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
        <div className="navbar-menu">
          { toggleMenu 
            ? <RiCloseLine color="fff" size={27} onClick={() => setToggleMenu(false)} />
            : <RiMenu3Line color="fff" size={27} onClick={() => setToggleMenu(true)} />
          }
          { toggleMenu && (
            <div className="navbar-menu-container scale-up-center">
              <div className="navbar-menu-container-links">
                <Menu />
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