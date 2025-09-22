import React, { useState, useEffect } from "react";
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./player-page.module.scss";
import { deleteUser, getUser } from "../../actions/auth";
import StandardButton from "../standardbutton/StardardButton";
import axios from "axios";
import API_URL from "../../global/global";
// import NotFound from "../notfound/NotFound";

const PlayerPage = (props) => {
  const { user: currentUser } = useSelector((state) => state.authReducer);

  
  // const [loading, setLoading] = useState(false);
  // const [ messageDisplay, setMessageDisplay ] = useState(false);
  const dispatch = useDispatch();
  const [firstRender, setFirstRender] = useState(false);
  // const [userInfo, setUserInfo] = useState(null);
  const [realUser, setRealUser] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState("");
  // const [postDeleteUsername, setPostDeleteUsername] = useState("");
  const playerPageUser = useSelector((state) => state.authReducer.playerPage);
  
  const navigate = useNavigate();

  const { username } = useParams();

  const handleHome = () => {
    navigate("/");
  }

  useEffect(() => {
    if (!firstRender) {
      if (currentUser.username === username) {
        console.log(currentUser);
        console.log("setting as real user");
        setRealUser(true);
        // setUserInfo(currentUser);
      } else {
        checkIfRealUser(username);
        getPlayerPage();
      }
    }
  }, [firstRender, username]);



  useEffect(() => {
    let timer;
    if (showAlert) {
      timer = setTimeout(() => {
        setShowAlert(false);
        setAlertMessage(''); // Clear message after hiding
        navigate('/community/players');
      }, 2000); // 2000 milliseconds = 2 seconds
    }

    // Cleanup function to clear the timeout if the component unmounts or showAlert changes
    return () => {
      clearTimeout(timer);
    };
  }, [showAlert]); // Re-run effect when showAlert changes

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  const getPlayerPage = () => {
    dispatch(getUser(username))
  }

  const handleDelete = async(e) => {
    e.preventDefault();
    if (currentUser.role !== "Admin") {
      dispatch(deleteUser(currentUser.username))
    } else {
      // setPostDeleteUsername(username);
      await new Promise(resolve => dispatch(deleteUser(username, currentUser.id))).then(setAlertMessage("User Deleted"))
      .then(setShowAlert(true)).then(console.log("finally deleting worked")).then(setRealUser(false));
      setAlertMessage("User Deleted")
      setShowAlert(true);
      // navigate(`/`);
      // checkIfRealUser(username);
      // console.log(realUser);
      // console.log("what is this")
    }
  };

  const handleEdit = (e) => {
    e.preventDefault();
    if (currentUser.role !== "Admin") {
      navigate("/profile/edit");
    } else {
      navigate(`/profile/${username}/edit`);
    }
  }

  const handleLogInfo = (e) => {
    e.preventDefault();
    console.log(playerPageUser);
  }

  const checkIfRealUser = (username) => {
    console.log(username);
    axios.get((API_URL + 'user'), 
     {params: { username: username}})
    .then (res => {
      setRealUser(true);
      console.log("setting real user as true");
    })
    .catch(
      err => {
        setRealUser(false);
        console.log("setting real user as false");
        console.log(err);
    })
  }

  return (
    <div className="container">
      {showAlert  &&
      (<div id="alert-container">
        <div className={styles["alert-style"]}>
          { alertMessage }
        </div>
      </div>
      )}
          {realUser ? 
          <div className={styles["player-page-table-container"]}>
            <div className={styles["player-info"]}>Player Information</div>
            <table className={styles["player-page-table"]}>
              <tbody>
                <tr>
                  <td>Username:</td>
                  <td>{username}</td>
                </tr>
                <tr>
                  <td>First name:</td>
                  <td>{username === currentUser.username ? (currentUser.first_name ? currentUser.first_name : "N/A") 
                  : playerPageUser && playerPageUser.first_name ? playerPageUser.first_name : "N/A"}</td>
                </tr>
                <tr>
                  <td>Last name:</td>
                  <td>{username === currentUser.username ? (currentUser.last_name ? currentUser.last_name : "N/A") 
                  : playerPageUser && playerPageUser.last_name ? playerPageUser.last_name : "N/A"}</td>
                </tr>
                <tr>
                  <td>Email:</td>
                  <td>{username === currentUser.username ? (currentUser.email ? currentUser.email : "N/A") 
                  : playerPageUser && playerPageUser.email ? playerPageUser.email : "N/A"}</td>
                </tr>
                <tr>
                  <td>Role:</td>
                  <td>{username === currentUser.username ? (currentUser.role ? currentUser.role : "N/A")
                  : playerPageUser && playerPageUser.role ? playerPageUser.role : "N/A"}</td>
                </tr>
                <tr>
                  <td>Last Active:</td>
                  <td>{username === currentUser.username ? (currentUser.last_active_at ? currentUser.last_active_at : "N/A") 
                  : playerPageUser && playerPageUser.last_active_at ? playerPageUser.last_active_at : "N/A"}</td>
                </tr>
              </tbody>
            </table>
          </div>
           : 
           <div className={styles["user-not-found"]}>
              <strong>
                <header>
                  Player with username "{username}" not found!
                </header>
                <StandardButton buttonText={"Return Home"} onClick={handleHome}/>
              </strong>
           </div>}
      {((currentUser.username === username || currentUser.role === "Admin") && realUser) ?
            <div className={styles["profile-buttons"]}>
              <div className={styles["profile-button"]}>
                <StandardButton buttonText={"Delete Account"} onClick={handleDelete} />
              </div>
              <div className={styles["profile-button"]}>
                <StandardButton buttonText={"Edit Account"} onClick={handleEdit} />
              </div>
            </div>
            : "" }
            {}
    </div>
  );
};

export default PlayerPage;