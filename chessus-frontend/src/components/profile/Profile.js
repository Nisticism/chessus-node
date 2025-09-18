import React, { useState } from "react";
import { Navigate, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./profile.module.scss";
import { deleteUser } from "../../actions/auth";
import StandardButton from "../standardbutton/StardardButton";

const Profile = (props) => {
  const { user: currentUser } = useSelector((state) => state.auth);

  
  const [loading, setLoading] = useState(false);
  const [ messageDisplay, setMessageDisplay ] = useState(false);
  const dispatch = useDispatch();
  
  const navigate = useNavigate();

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  const handleDelete = (e) => {
    e.preventDefault();
    dispatch(deleteUser(currentUser.username))
    // navigate("/account-deleted").then(
    // );
    // dispatch(deleteUser(currentUser.username))
    //   .then(() => {
    //     props.history.push("/deleted-account");
    //     window.location.reload();
    //   })
    //   .catch(() => {
    //     setLoading(false);
    //     setMessageDisplay(true);
    //   });
  };

  const handleEdit = (e) => {
    e.preventDefault();
    navigate("/profile/edit");
  }

  return (
    <div className="container">
      <header>
        <h3>
          <strong>{currentUser.username}</strong>
        </h3>
      </header>
      <table>
            <tbody>
            <tr>
              <th>
                
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
            {/* {
              allUsers.usersList.map(function(user) {
                return (
                  <tr key={user.id}>
                    <td>
                      {user.id}
                    </td>
                    <td>
                      {user.username}
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
            } */}
            </tbody>
          </table>
      <p>
        <strong>Token:</strong> {currentUser.accessToken.substring(0, 20)} ...{" "}
        {currentUser.accessToken.substr(currentUser.accessToken.length - 20)}
      </p>
      <p>
        <strong>Id:</strong> {currentUser.id}
      </p>
      <p>
        <strong>Email:</strong> {currentUser.email}
      </p>
      {/* <strong>Authorities:</strong>
      <ul>
        {currentUser.roles &&
          currentUser.roles.map((role, index) => <li key={index}>{role}</li>)}
      </ul> */}
      <StandardButton buttonText={"TestDelet"} onClick={handleDelete}></StandardButton>
      <StandardButton onClick={handleEdit}>Edit Account</StandardButton>
    </div>
  );
};

export default Profile;