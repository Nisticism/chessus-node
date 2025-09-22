import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Navbar from './components/navbar/Navbar';
import Home from './components/home/Home';
// import SignUp from './components/signup/SignUp';
import Login from "./components/signin/Login";
import Register from "./components/signup/Register";
import Profile from "./components/profile/Profile";
import PlayerPage from "./components/playerpage/PlayerPage";
import Pieces from "./components/pieces/Pieces";
import GameCreate from "./containers/gamecreate/GameCreate";
import CreateHub from "./containers/createhub/CreateHub";
import PlayerList from "./components/playerlist/PlayerList";
import Forums from "./containers/forums/Forums";
import ChessBoard from "./components/chess/ChessBoard";
import EditAccount from "./components/editaccount/EditAccount";
import Community from "./containers/community/Community";
import Play from "./containers/play/Play";

import CreateForum from "./components/forum/CreateForum";
import Forum from "./components/forum/Forum";
import EditForum from "./components/forum/EditForum";

import News from "./containers/news/News";

import DeletedAccount from "./components/deletedaccount/DeletedAccount";
import NotFound from './components/notfound/NotFound';

import { logout } from "./actions/auth";
import { clearMessage } from "./actions/message";
import { history } from "./helpers/history";
import "./App.css";
import Media from "./containers/media/Media";

function App() {

  // const [showModeratorBoard, setShowModeratorBoard] = useState(false);
  // const [showAdminBoard, setShowAdminBoard] = useState(false);
  // const { user: currentUser } = useSelector((state) => state.authReducer);
  const dispatch = useDispatch();

  useEffect(() => {
    history.listen((location) => {
      dispatch(clearMessage()); // clear message when changing location
    });
  }, [dispatch]);

  // useEffect(() => {
  //   if (currentUser) {
  //     setShowModeratorBoard(currentUser.roles.includes("ROLE_MODERATOR"));
  //     setShowAdminBoard(currentUser.roles.includes("ROLE_ADMIN"));
  //   }
  // }, [currentUser]);

  const logOut = () => {
    dispatch(logout());
  };

  return (
    <Router history={history}>
      <div className="app">
        <div className="app-header">
          <Navbar />
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/home" element={<Home />} />
            {/* <Route path="/signup" element={<SignUp />} /> */}
            <Route exact path="/login" element={<Login />} />
            <Route exact path="/register" element={<Register />} />
            {/* <Route exact path="/profile" element={<Profile />} /> */}
            <Route exact path="/create/game" element={<GameCreate />} />
            <Route exact path="/create" element={<CreateHub />} />
            <Route exact path="/community" element={<Community />} />
            <Route exact path="/community/players" element={<PlayerList />} />
            <Route exact path="/media" element={<Media />} />
            <Route exact path="/media/forums" element={<Forums />} />
            <Route exact path="/create" element={<CreateHub />} />
            <Route exact path="/play" element={<Play />} />
            <Route exact path="/chess" element={<ChessBoard />} />
            <Route exact path="/account-deleted" element={<DeletedAccount />} />
            <Route exact path="profile/edit" element={<EditAccount />}  />
            <Route exact path="profile/:username" element={<PlayerPage />} />
            <Route exact path="profile/:profileUsername/edit" element={<EditAccount />} />
            <Route exact path="/pieces" element={<Pieces />} />
            <Route exact path="/forums" element={<Forums />} />
            <Route exact path="/forums/new" element={<CreateForum />} />
            <Route exact path="/forums/:forumId" element={<Forum />} />
            <Route exact path="/forums/:forumId/edit" element={<EditForum />} />
            <Route exact path="/news" element={<News />} />
            <Route path="/*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;