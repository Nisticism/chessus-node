import React, { useEffect, lazy, Suspense } from "react";
import { useDispatch } from "react-redux";
import { Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/navbar/Navbar';
import Footer from './components/footer/Footer';
import { SocketProvider } from "./contexts/SocketContext";
import { clearMessage, resetEdit } from "./actions/general";
import { initGA, trackPageView } from "./analytics/GoogleAnalytics";
import "./App.css";

// Lazy-loaded route components for code splitting
const Home = lazy(() => import('./components/home/Home'));
const Login = lazy(() => import("./components/signin/Login"));
const ForgotPassword = lazy(() => import("./components/signin/ForgotPassword"));
const ResetPassword = lazy(() => import("./components/signin/ResetPassword"));
const Register = lazy(() => import("./components/register/Register"));
const PlayerPage = lazy(() => import("./components/playerpage/PlayerPage"));
const Pieces = lazy(() => import("./components/pieces/Pieces"));
const GameCreate = lazy(() => import("./containers/gamecreate/GameCreate"));
const PieceCreate = lazy(() => import("./containers/piececreate/PieceCreate"));
const CreateHub = lazy(() => import("./containers/createhub/CreateHub"));
const PlayerList = lazy(() => import("./components/playerlist/PlayerList"));
const PieceList = lazy(() => import("./components/piecelist/PieceList"));
const GameList = lazy(() => import("./components/gamelist/GameList"));
const GameTypeView = lazy(() => import("./components/gametypeview/GameTypeView"));
const PieceView = lazy(() => import("./components/pieceview/PieceView"));
const Forums = lazy(() => import("./containers/forums/Forums"));
const GameForums = lazy(() => import("./containers/gameforums/GameForums"));
const ForumsHub = lazy(() => import("./containers/forumshub/ForumsHub"));
const ChessBoard = lazy(() => import("./components/chess/ChessBoard"));
const EditAccount = lazy(() => import("./components/editaccount/EditAccount"));
const CommunityHub = lazy(() => import("./containers/communityhub/CommunityHub"));
const Leaderboard = lazy(() => import("./components/leaderboard/Leaderboard"));
const Play = lazy(() => import("./containers/play/Play"));
const Tournaments = lazy(() => import("./containers/tournaments/Tournaments"));
const TournamentDetails = lazy(() => import("./containers/tournaments/TournamentDetails"));
const LiveGame = lazy(() => import("./components/livegame/LiveGame"));
const MatchView = lazy(() => import("./components/matchview/MatchView"));
const Sandbox = lazy(() => import("./containers/sandbox/Sandbox"));
const CreateForum = lazy(() => import("./components/forum/CreateForum"));
const Forum = lazy(() => import("./components/forum/Forum"));
const EditForum = lazy(() => import("./components/forum/EditForum"));
const News = lazy(() => import("./containers/news/News"));
const CreateNews = lazy(() => import("./containers/news/CreateNews"));
const EditNews = lazy(() => import("./containers/news/EditNews"));
const SocialMedia = lazy(() => import("./containers/socialmedia/SocialMedia"));
const Streams = lazy(() => import("./containers/streams/Streams"));
const Careers = lazy(() => import("./containers/careers/Careers"));
const CareerEditor = lazy(() => import("./components/careereditor/CareerEditor"));
const DeletedAccount = lazy(() => import("./components/deletedaccount/DeletedAccount"));
const Preferences = lazy(() => import("./components/preferences/Preferences"));
const Donate = lazy(() => import("./components/donate/Donate"));
const Contact = lazy(() => import("./components/contact/Contact"));
const PrivacyPolicy = lazy(() => import("./components/privacypolicy/PrivacyPolicy"));
const AdminDashboard = lazy(() => import("./components/admindashboard/AdminDashboard"));
const NotificationsPage = lazy(() => import("./components/notifications/NotificationsPage"));
const NotFound = lazy(() => import('./components/notfound/NotFound'));
const FAQ = lazy(() => import("./containers/faq/FAQ"));
const About = lazy(() => import("./containers/about/About"));
const Tutorial = lazy(() => import("./containers/tutorial/Tutorial"));

function App() {

  const dispatch = useDispatch();
  const location = useLocation();

  // Apply saved theme on mount (default: grove)
  useEffect(() => {
    const savedTheme = localStorage.getItem('siteTheme') || 'grove';
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

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

    // Dynamic page titles for SEO
    const routeTitles = {
      '/': 'GridGrove - Create and Play Strategy Games',
      '/home': 'GridGrove - Create and Play Strategy Games',
      '/login': 'Log In | GridGrove',
      '/forgot-password': 'Forgot Password | GridGrove',
      '/register': 'Register | GridGrove',
      '/profile': 'My Profile | GridGrove',
      '/create': 'Create Hub | GridGrove',
      '/create/game': 'Create a Game | GridGrove',
      '/create/piece': 'Create a Piece | GridGrove',
      '/create/pieces': 'Browse Pieces | GridGrove',
      '/create/games': 'Browse Games | GridGrove',
      '/play': 'Play Games | GridGrove',
      '/play/tournaments': 'Tournaments | GridGrove',
      '/sandbox': 'Sandbox | GridGrove',
      '/chess': 'Chess | GridGrove',
      '/pieces': 'Pieces | GridGrove',
      '/community': 'Community Hub | GridGrove',
      '/community/players': 'Players | GridGrove',
      '/community/leaderboard': 'Leaderboard | GridGrove',
      '/community/social': 'Social Media | GridGrove',
      '/community/streams': 'Streams | GridGrove',
      '/community/about': 'About | GridGrove',
      '/forums': 'Forums | GridGrove',
      '/forums/general': 'General Forums | GridGrove',
      '/forums/game': 'Game Forums | GridGrove',
      '/forums/new': 'New Post | GridGrove',
      '/news': 'News | GridGrove',
      '/news/new': 'Create News | GridGrove',
      '/careers': 'Careers | GridGrove',
      '/preferences': 'Preferences | GridGrove',
      '/donate': 'Donate | GridGrove',
      '/contact': 'Contact Us | GridGrove',
      '/privacy': 'Privacy Policy | GridGrove',
      '/notifications': 'Notifications | GridGrove',
      '/admin/dashboard': 'Admin Dashboard | GridGrove',
      '/faq': 'FAQ | GridGrove',
      '/tutorial/chess': 'Chess Tutorial | GridGrove',
    };
    const basePath = location.pathname.replace(/\/\d+/g, '').replace(/\/[a-zA-Z0-9_-]+\/edit$/, '/edit');
    document.title = routeTitles[basePath] || routeTitles[location.pathname] || 'GridGrove - Create and Play Strategy Games';

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
          <Suspense fallback={<div style={{minHeight: '60vh'}} />}>
          <Routes>
            <Route path="/" element={<Home props={location}/>} />
            <Route path="/home" element={<Home />} />
            <Route exact path="/login" element={<Login />} />
            <Route exact path="/forgot-password" element={<ForgotPassword />} />
            <Route exact path="/reset-password/:token" element={<ResetPassword />} />
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
            <Route exact path="/community/social" element={<SocialMedia />} />
            <Route exact path="/community/streams" element={<Streams />} />
            <Route exact path="/community/about" element={<About />} />
            <Route exact path="/faq" element={<FAQ />} />
            <Route exact path="/tutorial/chess" element={<Tutorial />} />
            <Route exact path="/play" element={<Play />} />
            <Route exact path="/play/tournaments" element={<Tournaments />} />
            <Route exact path="/play/tournaments/:tournamentId" element={<TournamentDetails />} />
            <Route exact path="/play/:gameId" element={<LiveGame />} />
            <Route exact path="/sandbox" element={<Sandbox />} />
            <Route exact path="/match/:gameId" element={<MatchView />} />
            <Route exact path="/chess" element={<ChessBoard />} />
            <Route exact path="/account-deleted" element={<DeletedAccount />} />
            <Route exact path="profile/edit" element={<EditAccount />}  />
            <Route exact path="profile/:username" element={<PlayerPage />} />
            <Route exact path="profile/:profileUsername/edit" element={<EditAccount />} />
            <Route exact path="/pieces" element={<Pieces />} />
            <Route exact path="/forums" element={<ForumsHub />} />
            <Route exact path="/forums/general" element={<Forums />} />
            <Route exact path="/forums/game" element={<GameForums />} />
            <Route exact path="/forums/new" element={<CreateForum />} />
            <Route exact path="/forums/:forumId" element={<Forum />} />
            <Route exact path="/forums/:forumId/edit" element={<EditForum />} />
            <Route exact path="/news" element={<News />} />
            <Route exact path="/news/new" element={<CreateNews />} />
            <Route exact path="/news/edit/:newsId" element={<EditNews />} />
            <Route exact path="/careers" element={<Careers />} />
            <Route exact path="/careers/create" element={<CareerEditor />} />
            <Route exact path="/careers/edit/:jobId" element={<CareerEditor />} />
            <Route exact path="/preferences" element={<Preferences />} />
            <Route exact path="/donate" element={<Donate />} />
            <Route exact path="/contact" element={<Contact />} />
            <Route exact path="/privacy" element={<PrivacyPolicy />} />
            <Route exact path="/notifications" element={<NotificationsPage />} />
            <Route exact path="/admin/dashboard" element={<AdminDashboard />} />
            <Route path="/*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </div>
        <Footer />
      </div>
    </SocketProvider>
  );
}

export default App;