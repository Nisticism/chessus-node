import React, { useEffect } from "react";
import { useDispatch } from "react-redux";
import { Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/navbar/Navbar';
import Footer from './components/footer/Footer';
import Home from './components/home/Home';
import Login from "./components/signin/Login";
import Register from "./components/register/Register";
import PlayerPage from "./components/playerpage/PlayerPage";
import Pieces from "./components/pieces/Pieces";
import GameCreate from "./containers/gamecreate/GameCreate";
import PieceCreate from "./containers/piececreate/PieceCreate";
import CreateHub from "./containers/createhub/CreateHub";
import PlayerList from "./components/playerlist/PlayerList";
import PieceList from "./components/piecelist/PieceList";
import GameList from "./components/gamelist/GameList";
import GameTypeView from "./components/gametypeview/GameTypeView";
import PieceView from "./components/pieceview/PieceView";
import Forums from "./containers/forums/Forums";
import GameForums from "./containers/gameforums/GameForums";
import ChessBoard from "./components/chess/ChessBoard";
import EditAccount from "./components/editaccount/EditAccount";
import Community from "./containers/community/Community";
import CommunityHub from "./containers/communityhub/CommunityHub";
import Leaderboard from "./components/leaderboard/Leaderboard";
import Play from "./containers/play/Play";
import LiveGame from "./components/livegame/LiveGame";
import MatchView from "./components/matchview/MatchView";
import Sandbox from "./containers/sandbox/Sandbox";

import CreateForum from "./components/forum/CreateForum";
import Forum from "./components/forum/Forum";
import EditForum from "./components/forum/EditForum";

import News from "./containers/news/News";
import CreateNews from "./containers/news/CreateNews";
import EditNews from "./containers/news/EditNews";
import MediaHub from "./containers/mediahub/MediaHub";
import SocialMedia from "./containers/socialmedia/SocialMedia";
import Streams from "./containers/streams/Streams";

import DeletedAccount from "./components/deletedaccount/DeletedAccount";
import Preferences from "./components/preferences/Preferences";
import Donate from "./components/donate/Donate";
import Contact from "./components/contact/Contact";
import PrivacyPolicy from "./components/privacypolicy/PrivacyPolicy";
import AdminDashboard from "./components/admindashboard/AdminDashboard";
import NotFound from './components/notfound/NotFound';

import { SocketProvider } from "./contexts/SocketContext";
import { clearMessage, resetEdit } from "./actions/general";
import { initGA, trackPageView } from "./analytics/GoogleAnalytics";
import "./App.css";
import Media from "./containers/media/Media";

function App() {

  const dispatch = useDispatch();
  const location = useLocation();

  // Initialize Google Analytics once on mount
  useEffect(() => {
    initGA();
  }, []);

  // Clean up localhost URLs in user data on app load (one-time migration)
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user'));
    if (user && user.profile_picture && user.profile_picture.includes('localhost')) {
      // Remove the localhost part, keeping just the relative path
      user.profile_picture = user.profile_picture.replace(/https?:\/\/localhost:\d+/, '');
      localStorage.setItem('user', JSON.stringify(user));
    }
  }, []);

  useEffect(() => {

    dispatch(clearMessage()); // clear message when changing location
    dispatch(resetEdit());    // set editSuccess = to false when changing locations (so that we can base things off of the edit Success state)

    // Track page view for analytics
    trackPageView(location.pathname + location.search, document.title);

    // Scroll to top on route change
    window.scrollTo(0, 0);

  }, [location, dispatch]);

  return (
    <SocketProvider>
      <div className="app">
        <div className="app-header">
          <Navbar />
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Home props={location}/>} />
            <Route path="/home" element={<Home />} />
            <Route exact path="/login" element={<Login />} />
            <Route exact path="/register" element={<Register />} />
            <Route exact path="/profile" element={<PlayerPage />} />
            <Route exact path="/create/game" element={<GameCreate />} />
            <Route exact path="/create/game/edit/:gameId" element={<GameCreate />} />
            <Route exact path="/create/piece" element={<PieceCreate />} />
            <Route exact path="/create/piece/edit/:pieceId" element={<PieceCreate />} />
            <Route exact path="/create" element={<CreateHub />} />
            <Route exact path="/create/pieces" element={<PieceList />} />
            <Route exact path="/create/games" element={<GameList />} />
            <Route exact path="/games/:gameId" element={<GameTypeView />} />
            <Route exact path="/pieces/:pieceId" element={<PieceView />} />
            <Route exact path="/community" element={<CommunityHub />} />
            <Route exact path="/community/players" element={<PlayerList />} />
            <Route exact path="/community/leaderboard" element={<Leaderboard />} />
            <Route exact path="/media" element={<MediaHub />} />
            <Route exact path="/media/forums" element={<Forums />} />
            <Route exact path="/media/social" element={<SocialMedia />} />
            <Route exact path="/media/streams" element={<Streams />} />
            <Route exact path="/create" element={<CreateHub />} />
            <Route exact path="/play" element={<Play />} />
            <Route exact path="/play/:gameId" element={<LiveGame />} />
            <Route exact path="/sandbox" element={<Sandbox />} />
            <Route exact path="/match/:gameId" element={<MatchView />} />
            <Route exact path="/chess" element={<ChessBoard />} />
            <Route exact path="/account-deleted" element={<DeletedAccount />} />
            <Route exact path="profile/edit" element={<EditAccount />}  />
            <Route exact path="profile/:username" element={<PlayerPage />} />
            <Route exact path="profile/:profileUsername/edit" element={<EditAccount />} />
            <Route exact path="/pieces" element={<Pieces />} />
            <Route exact path="/forums" element={<Forums />} />
            <Route exact path="/forums/game" element={<GameForums />} />
            <Route exact path="/forums/new" element={<CreateForum />} />
            <Route exact path="/forums/:forumId" element={<Forum />} />
            <Route exact path="/forums/:forumId/edit" element={<EditForum />} />
            <Route exact path="/news" element={<News />} />
            <Route exact path="/news/new" element={<CreateNews />} />
            <Route exact path="/news/edit/:newsId" element={<EditNews />} />
            <Route exact path="/preferences" element={<Preferences />} />
            <Route exact path="/donate" element={<Donate />} />
            <Route exact path="/contact" element={<Contact />} />
            <Route exact path="/privacy" element={<PrivacyPolicy />} />
            <Route exact path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/*" element={<NotFound />} />
          </Routes>
        </div>
        <Footer />
      </div>
    </SocketProvider>
  );
}

export default App;