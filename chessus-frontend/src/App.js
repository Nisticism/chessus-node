import React, { useEffect } from "react";
import { useDispatch } from "react-redux";
import { Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/navbar/Navbar';
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
import Preferences from "./components/preferences/Preferences";
import NotFound from './components/notfound/NotFound';

import { clearMessage, resetEdit } from "./actions/general";
import "./App.css";
import Media from "./containers/media/Media";

function App() {

  const dispatch = useDispatch();
  const location = useLocation();

  useEffect(() => {

    dispatch(clearMessage()); // clear message when changing location
    dispatch(resetEdit());    // set editSuccess = to false when changing locations (so that we can base things off of the edit Success state)

  }, [location, dispatch]);

  return (
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
            <Route exact path="/create/piece" element={<PieceCreate />} />
            <Route exact path="/create" element={<CreateHub />} />
            <Route exact path="/community" element={<Community />} />
            <Route exact path="/community/players" element={<PlayerList />} />
            <Route exact path="/community/pieces" element={<PieceList />} />
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
            <Route exact path="/preferences" element={<Preferences />} />
            <Route path="/*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
  );
}

export default App;