import React, { useState, useEffect } from "react";
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./forum.module.scss";
import { deleteComment, getForum, newComment, editComment, deleteForum } from "../../actions/forums";
import StandardButton from "../standardbutton/StandardButton";
import { formatDateLegacy, getCurrentMySQLDateTime } from "../../helpers/date-formatter";

import { FaEdit } from "react-icons/fa";
import { FaTrash } from "react-icons/fa";
import LikesModule from "./LikesModule";

const Forum = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);

  
  const [loading, setLoading] = useState(true);
  const dispatch = useDispatch();
  const [firstRender, setFirstRender] = useState(false);
  const currentForum = useSelector((state) => state.forums.forum);
  const [commentContent, setCommentContent] = useState(null);
  
  const navigate = useNavigate();

  const { forumId } = useParams();

  useEffect(() => {
    if (!firstRender) {
      console.log(forumId)
      setLoading(true);
      dispatch(getForum(forumId)).finally(() => setLoading(false));
      setFirstRender(true);
    }
  }, [firstRender]);

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
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to comment on forums." } });
      return;
    }
    let commentContent = document.getElementById("comment-field").value;
    const currentTime = getCurrentMySQLDateTime();
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
  
    const currentTime = getCurrentMySQLDateTime();
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



  const onChangeCommentContent = (e) => {
    const newCommentContent = e.target.value;
    setCommentContent(newCommentContent);
  };

  return (
    <div className="container">
      {loading ? (
        <div className={styles["loading-container"]}>
          <p>Loading forum...</p>
        </div>
      ) : (
        <>
      { currentForum ? 
          <div className={styles["forum-container"]}>
            
            <div className={styles["forum-title-container"]}>
              <div className={styles["forum-title"]}>{currentForum.title}</div>
              { currentUser && (currentForum.author_id === currentUser.id || currentUser.role === "Admin") &&
                <div className={styles["post-icons-container"]}>
                  <div className={styles["forum-edit-button"]} onClick={(event) => handleEditPost(event, currentForum.id)}><FaEdit /></div>
                  <div className={styles["forum-delete-button"]} onClick={(event) => handleDeletePost(event, currentForum.id)}><FaTrash /></div>
                </div>
              }
            </div>
            <div className={styles["forum-author-date"]}>
            {currentForum.author_name && currentForum.author_name !== 'Anonymous' ? (
              <Link to={`/profile/${currentForum.author_name}`}>
                <div className={styles["forum-username"]}>{ currentForum.author_name }</div>
              </Link>
            ) : (
              <div className={styles["forum-username"]}>{ currentForum.author_name || 'User Deleted' }</div>
            )}
            <br/> {formatDateLegacy(currentForum.created_at)}</div>
            {currentForum.game_type_id && (
              <div className={styles["forum-game-link"]}>
                <Link to={`/games/${currentForum.game_type_id}`}>
                  ♟ {currentForum.game_name || 'View Game'}
                </Link>
              </div>
            )}
            <div className={styles["forum-content"]}>{currentForum.content}</div>
            <div className={styles["likes-container"]}>
              {currentUser ? (
                <LikesModule isLiked={false} likeCount={currentForum.likes ? currentForum.likes.length : 0} userId={currentUser.id} forumId={currentForum.id}/>
              ) : (
                <StandardButton buttonText={"Login to Like"} onClick={() => navigate('/login', { state: { message: "Please log in to like forum posts." } })} />
              )}
            </div>
            <h2>Comments</h2>
            {
            currentForum.comments ? currentForum.comments.map(function(comment) {
              return (
                <div className={styles["comment-container"]} key={comment.id}>
                  <div className={styles["comment"]}>
                    <div className={styles["comment-data"]}>
                      <div className={styles["comment-date"]}>
                        { comment.last_updated_at ? formatDateLegacy(comment.last_updated_at) : "" }{comment.last_updated_at === comment.created_at ? "" : <span className={styles["edited-text"]}>&nbsp;Edited</span>}
                      </div>
                      <div className={styles["comment-author"]}>
                        <div className={styles["comment-link"]}>
                          {comment.author_name && comment.author_name !== 'Anonymous' && comment.author_name !== 'User Deleted' ? (
                            <Link to={`/profile/${comment.author_name}`}>
                              { comment.author_name }
                            </Link>
                          ) : (
                            <span>{ comment.author_name }</span>
                          )}
                        </div>
                      </div>
                      <div className={styles["comment-content"]}>
                        {/* { comment.content } */}
                      </div>
                    </div>
                    <div className={styles["comment-buttons"]}>
                      <div className={styles["comment-edit-button"]}>
                        { currentUser && (comment.author_id === currentUser.id || currentUser.role === "Admin") ?
                          <div>
                            <div onClick={(event) => handleEdit(event, comment.id + "edit", comment.id)}><FaEdit/></div>
                          </div>
                        : "" }
                      </div>
                      <div className={styles["comment-delete"]}>
                        { currentUser && (comment.author_id === currentUser.id || currentUser.role === "Admin") ?
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
            <textarea className={styles["comment-field"]} id="comment-field" disabled={!currentUser}></textarea>
          </div>
          <div className={styles["submit-comment-button"]}>
            {currentUser ? (
              <StandardButton buttonText={"Submit Comment"} onClick={handleNewComment}/>
            ) : (
              <StandardButton buttonText={"Login to Comment"} onClick={() => navigate('/login', { state: { message: "Please log in to comment on forums." } })}/>
            )}
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
        </>
      )}
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