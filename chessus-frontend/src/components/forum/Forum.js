import React, { useState, useEffect } from "react";
import { Navigate, Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./forum.module.scss";
import { deleteComment, getForum, newComment, editComment, deleteForum } from "../../actions/forums";
import StandardButton from "../standardbutton/StardardButton";
import axios from "axios";

import { FaEdit } from "react-icons/fa";
import { FaTrash } from "react-icons/fa";
import LikesModule from "./LikesModule";

const Forum = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);

  
  const [loading, setLoading] = useState(false);
  const [ messageDisplay, setMessageDisplay ] = useState(false);
  const dispatch = useDispatch();
  const [firstRender, setFirstRender] = useState(false);
  const currentForum = useSelector((state) => state.forums.forum);
  // const [currentForum, setCurrentForum] = useState(null);
  const [realForum, setRealForum] = useState(false);
  const [commentContent, setCommentContent] = useState(null);
  
  const navigate = useNavigate();

  const { forumId } = useParams();

  useEffect(() => {
    if (!firstRender) {
      console.log(forumId)
      dispatch(getForum(forumId));
      setFirstRender(true);
    }
  }, [firstRender]);

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  const handleDelete = (e, id) => {
    e.preventDefault();
    // console.log(id);
    dispatch(deleteComment(id));
  };

  const handleEdit = (e, id) => {
    e.preventDefault();
    console.log("clicked edit");
    let editField = document.getElementById(id);
    if (editField.style.display !== "block") {
      console.log("at none, displaying block");
      editField.style.setProperty("display", "block");
    } else {
      console.log("at block, displaying none")
      editField.style.setProperty("display", "none");
    }
  }

  const handleNewComment = (e) => {
    e.preventDefault();
    let commentContent = document.getElementById("comment-field").value;
    const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    console.log(commentContent);
    dispatch(newComment(currentUser.id, currentForum.id, commentContent, currentTime, currentUser.username));
  }

  const handleEditComment = (e, elementId, id) => {
    e.preventDefault();
    let commentEditBox = document.getElementById(elementId);
    let editField = document.getElementById(id + "edit");
    editField.style.display = "none";
    let commentContentSubmit;
    if (commentContent) {
      commentContentSubmit = commentContent;
    } else {
      commentContentSubmit = commentEditBox.value;
    }
  
    const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    console.log("comment content: " + commentContentSubmit, "element id: " + elementId, "id: " + id);
    dispatch(editComment(id, commentContentSubmit, currentTime));
  }

  // const getForum = (id) => {
  //   axios.get('http://localhost:3001/forum', 
  //    {params: { id:id}})
  //   .then ((res) => {
  //       setRealForum(true);
  //       setCurrentForum(res);
  //   })
  //   .catch(
  //     err => {
  //       setRealForum(false);
  //       console.log(err);
  //   })
  // }

  const handleEditPost = (e, id) => {
    e.preventDefault();
    navigate(`/forums/${id}/edit`);
  }

  async function handleDeletePost(e, id){
    e.preventDefault();
    if (window.confirm("Are you sure you want to delete this forum post?  It cannot be undone.")) {
      dispatch(deleteForum(id));
      await new Promise(resolve => setTimeout(resolve, 100));
      navigate("/forums");
      console.log("delete post clicked");
    }
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
    if (hoursTime[0] === "0") {
      hoursTime = hoursTime.substring(1);
    }
    return month + "/" + day + "/" + year + " " + hoursTime + ":" + minutesTime + dayHalf;
  }

  const onChangeCommentContent = (e) => {
    const newCommentContent = e.target.value;
    setCommentContent(newCommentContent);
  };

  return (
    <div className="container">
      { currentForum ? 
          <div className={styles["forum-container"]}>
            
            <div className={styles["forum-title-container"]}>
              <div className={styles["forum-title"]}>{currentForum.title}</div>
              { (currentForum.author_id === currentUser.id || currentUser.role === "Admin") &&
                <div className={styles["post-icons-container"]}>
                  <div className={styles["forum-edit-button"]} onClick={(event) => handleEditPost(event, currentForum.id)}><FaEdit /></div>
                  <div className={styles["forum-delete-button"]} onClick={(event) => handleDeletePost(event, currentForum.id)}><FaTrash /></div>
                </div>
              }
            </div>
            <div className={styles["forum-author-date"]}>
            <Link to={`/profile/${currentForum.author_name}`}>
              <div className={styles["forum-username"]}>{ currentForum.author_name }</div>
            </Link>
            <br/> {formatDateFromString(currentForum.created_at)}</div>
            <div className={styles["forum-content"]}>{currentForum.content}</div>
            <div className={styles["likes-container"]}>
              <LikesModule isLiked={false} likeCount={currentForum.likes ? currentForum.likes.length : 0} userId={currentUser.id} forumId={currentForum.id}/>
            </div>
            <h2>Comments</h2>
            {
            currentForum.comments ? currentForum.comments.map(function(comment) {
              return (
                <div className={styles["comment-container"]} key={comment.id}>
                  <div className={styles["comment"]}>
                    <div className={styles["comment-data"]}>
                      <div className={styles["comment-date"]}>
                        { comment.last_updated_at ? formatDateFromString(comment.last_updated_at.toString()) : "" }{comment.last_updated_at === comment.created_at ? "" : <span className={styles["edited-text"]}>&nbsp;Edited</span>}
                      </div>
                      <div className={styles["comment-author"]}>
                        <div className={styles["comment-link"]}>
                            <Link to={`/profile/${comment.author_name}`}>
                              { comment.author_name }
                            </Link>
                        </div>
                      </div>
                      <div className={styles["comment-content"]}>
                        {/* { comment.content } */}
                      </div>
                    </div>
                    <div className={styles["comment-buttons"]}>
                      <div className={styles["comment-edit-button"]}>
                        { (comment.author_id === currentUser.id || currentUser.role === "Admin") ?
                          <div>
                            <div onClick={(event) => handleEdit(event, comment.id + "edit", comment.id)}><FaEdit/></div>
                          </div>
                        : "" }
                      </div>
                      <div className={styles["comment-delete"]}>
                        { (comment.author_id === currentUser.id || currentUser.role === "Admin") ?
                          <div>
                            <div onClick={(event) => handleDelete(event, comment.id)}><FaTrash/></div>
                          </div>
                        : "" }
                      </div>
                    </div>
                  </div>
                  <div className={styles["comment-content-container"]}> { comment.content }</div>
                  <div id={comment.id + "edit"} className={styles["comment-edit"]}>
                    <textarea id={comment.id + "edit-field"} onChange={onChangeCommentContent} defaultValue={comment.content}></textarea>
                    <div className={styles["submit-comment-button"]}>
                      <StandardButton buttonText={"Update Comment"} onClick={(event) => handleEditComment(event, comment.id + "edit-field", comment.id)}/>
                    </div>
                  </div>
                </div>
              )
            }) : "No comments so far"
          }
          <div className={styles["new-comment"]}>
            <textarea className={styles["comment-field"]} id="comment-field"></textarea>
          </div>
          <div className={styles["submit-comment-button"]}>
            <StandardButton buttonText={"Submit Comment"} onClick={handleNewComment}/>
          </div>
          </div>
           :
           <div className={styles["forum-not-found"]}>
              <strong>
                <header>
                  Forum post not found!
                </header>
              </strong>
           </div>
}
      {/* {currentUser.username === username ?
            <div className={styles["profile-buttons"]}>
              <div className={styles["profile-button"]}>
                <StandardButton buttonText={"Delete Account"} onClick={handleDelete} />
              </div>
              <div className={styles["profile-button"]}>
                <StandardButton buttonText={"Edit Account"} onClick={handleEdit} />
              </div>
            </div>
            : ""} */}
    </div>
  );
};

export default Forum;