import React, { useState, useEffect } from "react";
import { Navigate, Link, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from "react-redux";
import styles from "./forums.module.scss";
import StandardButton from "../../components/standardbutton/StardardButton";
import { forums, deleteForum, firstForumsRender } from "../../actions/forums";
const Forums = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const allForums = useSelector((state) => state.forums);
  const navigate = useNavigate();
  const firstRender = useSelector((state) => state.forums.first_forums_render);
  // const [forums, setForums] = useState(false);
  const dispatch = useDispatch();

  useEffect(() => {
  console.log("before entering inner use effect, first render is: " + firstRender);
    if (!firstRender) {
      console.log("in useeffect forums page");
      // dispatch(users());
      dispatch(forums());
      dispatch(firstForumsRender());
      console.log("after entering inner use effect, first render is: " + firstRender);
    }
  }, [firstRender]);

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  function createNewPost() {
    navigate("/forums/new");
  }

  function formatDateFromString(date) {
    let year = date.substring(0,4);
    let day = date.substring(8,10);
    let month = date.substring(5,7);
    let hoursTime = date.substring(11, 13);
    let minutesTime = date.substring(14, 16);
    let dayHalf = "am"
    if (hoursTime > 12) {
      dayHalf = "pm"
      hoursTime = (parseInt(hoursTime) - 12).toString();
    }
    return month + "/" + day + "/" + year + " " + hoursTime + ":" + minutesTime + dayHalf;
  }

  return (
    <div className="container">
      <header className="jumbotron">
        <h3 className={styles["forum-page-title"]}>
          Forums
        </h3>
      </header>
    <div className={styles["forums"]}>
      {/* This line allows the fake forum with idk of -1 to load in upon deletion of the last article from state, immediately switching to
      rendering "No Forums Found" instead of having a blank table until refresh. */}
      {allForums.forums && allForums.forums[0] && allForums.forums[0].id >= 0 ? 
    <table className={styles["forums-table"]}>
      <tbody>
        <tr>
          <th>
            Subject
          </th>
          <th>
            Written By
          </th>
          <th>
            Replies
          </th>
          <th>
            Likes
          </th>
          <th>
            Content
          </th>
          <th>
            Created At
          </th>
        </tr>
          {
            allForums.forums.map(function(forum) {
              return (
                <tr key={forum.id} className={styles["forum-row"]}>
                    <td>
                      <div className={styles["forums-link"]}>
                        <Link to={`/forums/${forum.id}`}>
                          <strong><div className={styles["forum-title"]}>{ forum.title }</div></strong> <br/> <div className={styles["forums-comments-likes"]}></div>
                        </Link>
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        { forum.author_name ? 
                                              <Link to={`/profile/${forum.author_name}`}>
                          <div className={styles["forums-username"]}>{ forum.author_name }</div>
                        </Link>
                        :                         <Link to={"/community/players"}>
                          <div className={styles["forums-username"]}>User Deleted</div>
                        </Link>
                      
                      }
                      </div>
                    </td>
                    <td>
                    <div className={styles["forums-link"]}>
                        <Link to={`/forums/${forum.id}`}>
                          <div className={styles["forums-comment-likes"]}>{forum.comment_count}</div>
                        </Link>
                      </div>
                    </td>
                    <td>
                      <div className={styles["forums-link"]}>
                        <Link to={`/forums/${forum.id}`}>
                          <div className={styles["forums-comment-likes"]}>{forum.likes ? forum.likes.length : 0}</div>
                        </Link>
                      </div>
                    </td>
                    <td className={styles["forums-link-content"]}>
                      <Link to={`/forums/${forum.id}`}>
                        <div className={styles["forum-content"]}>
                          {forum.content}
                        </div>
                      </Link>
                    </td>
                    <td className={styles["date-td"]}>
                      <div className={styles["forums-date"]}>
                        {
                        formatDateFromString(forum.created_at.toString())
                        }
                      </div>
                    </td>
                </tr>
              )
            })
          }
      </tbody>
    </table>
    : 
    <h1>No Forums Found</h1>
      }
    </div>
      <div className="buttons">
        <StandardButton buttonText={"Create New Post"} onClick={createNewPost}/>
      </div>
    </div>
  );
};

export default Forums;