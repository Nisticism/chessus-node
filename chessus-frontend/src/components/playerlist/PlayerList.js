import React, { useState, useEffect } from "react";
import { Navigate, Link } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import Axios from "axios";
import { users } from "../../actions/users";
import styles from "./playerlist.module.scss";
// import e from "express";

const PlayerList = () => {
  const { user: currentUser } = useSelector((state) => state.auth);
  const allUsers = useSelector((state) => state.users);
  const [loading, setLoading] = useState(false);
  const { message } = useSelector(state => state.message);
  const [ messageDisplay, setMessageDisplay ] = useState(false);
  const [firstRender, setFirstRender] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
    if (!firstRender) {
      dispatch(users());
      setFirstRender(true);
    }
  }, [firstRender]);

  if (!currentUser) {
    return <Navigate to="/login" />;
  }
  return (
    <div className={styles["player-list-container"]}>
      {/* <p>
        <strong>Your Id:</strong> {currentUser.id}
      </p> */}
      <h1 className={styles["accounts-found"]}>{allUsers.usersList ? allUsers.usersList.length : 0} accounts found</h1>
      <div className={styles["players-table"]}>
        { allUsers.usersList ?

          <table>
            <tbody>
            <tr>
              <th>
                User ID
              </th>
              <th>
                Username
              </th>
              <th>
                First Name
              </th>
              <th>
                Last Name
              </th>
              <th>
                Email
              </th>
              <th>
                Password/Token
              </th>
          </tr>
            {
              allUsers.usersList.map(function(user) {
                return (
                  <tr key={user.id}>
                    <td>
                      {user.id}
                    </td>
                    <td>
                    <Link to={"/profile/" + user.username}>
                      {user.username}
                    </Link>
                    </td>
                    <td>
                      {user.first_name}
                    </td>
                    <td>
                      {user.last_name}
                    </td>
                    <td>
                      {user.email}
                    </td>
                    <td>
                      {
                      user.password.length >= 15 ? user.password.substring(0, 15) + "..." : user.password}
                    </td>
                  </tr>
                )
              })
            }
            </tbody>
          </table>
        
 : <p>blank</p>
        }
      </div>
    </div>
  );
};

export default PlayerList;