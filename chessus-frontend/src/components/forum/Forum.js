import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useSelector, useDispatch } from "react-redux";
import styles from "./forum.module.scss";
import { categoryLabel } from "../../helpers/forum-categories";
import { deleteComment, getForum, newComment, editComment, deleteForum } from "../../actions/forums";
import StandardButton from "../standardbutton/StandardButton";
import { formatDateLegacy, getCurrentMySQLDateTime } from "../../helpers/date-formatter";

import { FaEdit } from "react-icons/fa";
import { FaTrash } from "react-icons/fa";
import { FaReply } from "react-icons/fa";
import { FaArrowLeft } from "react-icons/fa";
import LikesModule from "./LikesModule";
import EmojiPickerButton from "../common/EmojiPickerButton";
import LinkInsertButton from "../common/LinkInsertButton";
import ValidationWarningModal from "../common/ValidationWarningModal";
import { renderContent } from "../../helpers/render-content";

const COMMENT_MAX = 10000;

const Forum = () => {
  const { user: currentUser } = useSelector((state) => state.authReducer);

  
  const [loading, setLoading] = useState(true);
  const dispatch = useDispatch();
  const [firstRender, setFirstRender] = useState(false);
  const currentForum = useSelector((state) => state.forums.forum);
  const [commentContent, setCommentContent] = useState(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyContent, setReplyContent] = useState("");
  const [validationWarnings, setValidationWarnings] = useState(null);
  // Comment editing state — single source of truth so Cancel and click-outside
  // both work without imperative DOM manipulation.
  const [editingCommentId, setEditingCommentId] = useState(null);
  const editingContainerRef = useRef(null);

  const cancelCommentEdit = () => {
    setEditingCommentId(null);
    setCommentContent(null);
  };

  // Cancel comment editing when the user clicks anywhere outside the edit form.
  useEffect(() => {
    if (editingCommentId === null) return undefined;
    const handleDocumentMouseDown = (e) => {
      const container = editingContainerRef.current;
      if (container && !container.contains(e.target)) {
        cancelCommentEdit();
      }
    };
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [editingCommentId]);
  
  const navigate = useNavigate();

  const { forumId } = useParams();

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!firstRender) {
      console.log(forumId)
      setLoading(true);
      dispatch(getForum(forumId)).finally(() => setLoading(false));
      setFirstRender(true);
    }
  }, [firstRender]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const handleDelete = (e, id) => {
    e.preventDefault();
    // console.log(id);
    dispatch(deleteComment(id));
  };

  const handleEdit = (e, commentId) => {
    e.preventDefault();
    setEditingCommentId(prev => (prev === commentId ? null : commentId));
    setCommentContent(null);
  }

  const handleNewComment = (e) => {
    e.preventDefault();
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to comment on forums." } });
      return;
    }
    if (!newCommentText.trim()) return;
    if (newCommentText.length > COMMENT_MAX) {
      setValidationWarnings([`Comment exceeds ${COMMENT_MAX.toLocaleString()} character limit (currently ${newCommentText.length.toLocaleString()})`]);
      return;
    }
    const currentTime = getCurrentMySQLDateTime();
    console.log(newCommentText);
    dispatch(newComment(currentUser.id, currentForum.id, newCommentText, currentTime, currentUser.username));
    setNewCommentText("");
  }

  const handleReply = (e, parentCommentId) => {
    e.preventDefault();
    if (!currentUser) {
      navigate('/login', { state: { message: "Please log in to reply to comments." } });
      return;
    }
    if (!replyContent.trim()) return;
    if (replyContent.length > COMMENT_MAX) {
      setValidationWarnings([`Reply exceeds ${COMMENT_MAX.toLocaleString()} character limit (currently ${replyContent.length.toLocaleString()})`]);
      return;
    }
    const currentTime = getCurrentMySQLDateTime();
    dispatch(newComment(currentUser.id, currentForum.id, replyContent, currentTime, currentUser.username, parentCommentId));
    setReplyingTo(null);
    setReplyContent("");
  }

  const handleEditComment = (e, elementId, id) => {
    e.preventDefault();
    let commentEditBox = document.getElementById(elementId);
    let commentContentSubmit;
    if (commentContent) {
      commentContentSubmit = commentContent;
    } else {
      commentContentSubmit = commentEditBox ? commentEditBox.value : '';
    }
    if (commentContentSubmit && commentContentSubmit.length > COMMENT_MAX) {
      setValidationWarnings([`Comment exceeds ${COMMENT_MAX.toLocaleString()} character limit (currently ${commentContentSubmit.length.toLocaleString()})`]);
      return;
    }
    setEditingCommentId(null);
    setCommentContent(null);

    const currentTime = getCurrentMySQLDateTime();
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
    let message = "Are you sure you want to delete this forum post? It cannot be undone.";
    if (currentForum.game_type_id) {
      message += `\n\nWarning: This forum is associated with the game "${currentForum.game_name || 'a game'}" which still exists.`;
    }
    if (window.confirm(message)) {
      dispatch(deleteForum(id));
      await new Promise(resolve => setTimeout(resolve, 100));
      navigate("/forums");
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
            <Link to="/forums" className={styles["back-to-forums"]}>
              <FaArrowLeft /> Back to Forums
            </Link>
            
            <div className={styles["forum-title-container"]}>
              <div className={styles["forum-title"]}>{currentForum.title}</div>
              { currentUser && (currentForum.author_id === currentUser.id || currentUser.role?.toLowerCase() === "admin" || currentUser.role?.toLowerCase() === "owner") &&
                <div className={styles["post-icons-container"]}>
                  <div className={styles["forum-edit-button"]} onClick={(event) => handleEditPost(event, currentForum.id)}><FaEdit /></div>
                  <div className={styles["forum-delete-button"]} onClick={(event) => handleDeletePost(event, currentForum.id)}><FaTrash /></div>
                </div>
              }
            </div>
            <div className={styles["forum-author-date"]}>
            {currentForum.author_name && currentForum.author_name !== 'Anonymous' && currentForum.author_name !== 'User Deleted' ? (
              <Link to={`/profile/${currentForum.author_name}`}>
                <div className={styles["forum-username"]}>{ currentForum.author_name }</div>
              </Link>
            ) : (
              <div className={styles["forum-username"]}>{ currentForum.author_name || 'User Deleted' }</div>
            )}
            <br/> {formatDateLegacy(currentForum.created_at)}</div>
            {!currentForum.game_type_id && (
              <div className={styles["forum-category-row"]}>
                <span className={styles["category-pill"]}>
                  Category: {categoryLabel(currentForum.category)}
                </span>
              </div>
            )}
            {currentForum.game_type_id && (
              <div className={styles["forum-game-link"]}>
                <Link to={`/games/${currentForum.game_type_id}`}>
                  ♟ {currentForum.game_name || 'View Game'}
                </Link>
              </div>
            )}
            <div className={styles["forum-content"]}>{renderContent(currentForum.content)}</div>
            <div className={styles["likes-container"]}>
              {currentUser ? (
                <LikesModule isLiked={false} likeCount={currentForum.likes ? currentForum.likes.length : 0} userId={currentUser.id} forumId={currentForum.id}/>
              ) : (
                <StandardButton buttonText={"Login to Like"} onClick={() => navigate('/login', { state: { message: "Please log in to like forum posts." } })} />
              )}
            </div>
            <h2>Comments</h2>
            {
            currentForum.comments ? (() => {
              const topLevel = currentForum.comments.filter(c => !c.parent_id);
              const getReplies = (parentId) => currentForum.comments.filter(c => c.parent_id === parentId);

              const renderComment = (comment, depth = 0) => {
                const replies = getReplies(comment.id);
                return (
                  <div className={depth > 0 ? styles["reply-container"] : styles["comment-container"]} key={comment.id}>
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
                        </div>
                      </div>
                      <div className={styles["comment-buttons"]}>
                        { currentUser &&
                          <div className={styles["comment-reply-button"]} onClick={() => setReplyingTo(replyingTo === comment.id ? null : comment.id)} title="Reply">
                            <FaReply/>
                          </div>
                        }
                        <div className={styles["comment-edit-button"]}>
                          { currentUser && (comment.author_id === currentUser.id || currentUser.role?.toLowerCase() === "admin" || currentUser.role?.toLowerCase() === "owner") ?
                            <div>
                              <div onClick={(event) => handleEdit(event, comment.id + "edit", comment.id)}><FaEdit/></div>
                            </div>
                          : "" }
                        </div>
                        <div className={styles["comment-delete"]}>
                          { currentUser && (comment.author_id === currentUser.id || currentUser.role?.toLowerCase() === "admin" || currentUser.role?.toLowerCase() === "owner") ?
                            <div>
                              <div onClick={(event) => handleDelete(event, comment.id)}><FaTrash/></div>
                            </div>
                          : "" }
                        </div>
                      </div>
                    </div>
                    <div className={styles["comment-content-container"]}>{renderContent(comment.content)}</div>
                    {editingCommentId === comment.id && (
                      <div
                        id={comment.id + "edit"}
                        className={styles["comment-edit"]}
                        ref={editingContainerRef}
                        style={{ display: 'block' }}
                      >
                        <textarea
                          id={comment.id + "edit-field"}
                          onChange={onChangeCommentContent}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditComment(e, comment.id + "edit-field", comment.id); } }}
                          defaultValue={comment.content}
                          maxLength={COMMENT_MAX}
                          autoFocus
                        ></textarea>
                        <div className={styles["submit-comment-button"]} style={{ display: 'flex', gap: '8px' }}>
                          <LinkInsertButton onInsert={(text) => {
                            const ta = document.getElementById(comment.id + "edit-field");
                            if (ta) {
                              const start = ta.selectionStart;
                              const end = ta.selectionEnd;
                              const val = ta.value;
                              ta.value = val.substring(0, start) + text + val.substring(end);
                              const ev = new Event('input', { bubbles: true });
                              ta.dispatchEvent(ev);
                              onChangeCommentContent({ target: { value: ta.value } });
                            }
                          }} />
                          <StandardButton buttonText={"Update Comment"} onClick={(event) => handleEditComment(event, comment.id + "edit-field", comment.id)}/>
                          <StandardButton buttonText={"Cancel"} onClick={cancelCommentEdit}/>
                        </div>
                      </div>
                    )}
                    {replyingTo === comment.id && (
                      <div className={styles["reply-form"]}>
                        <textarea 
                          className={styles["reply-field"]} 
                          placeholder={`Reply to ${comment.author_name}...`}
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReply(e, comment.id); } }}                            maxLength={COMMENT_MAX}                        />
                        <div className={styles["emoji-row"]}>
                          <EmojiPickerButton onEmojiSelect={(emoji) => setReplyContent(prev => prev + emoji)} />
                          <LinkInsertButton onInsert={(text) => setReplyContent(prev => prev + text)} />
                        </div>
                        <div className={styles["reply-form-buttons"]}>
                          <StandardButton buttonText={"Reply"} onClick={(e) => handleReply(e, comment.id)}/>
                          <StandardButton buttonText={"Cancel"} onClick={() => { setReplyingTo(null); setReplyContent(""); }}/>
                        </div>
                      </div>
                    )}
                    {replies.length > 0 && (
                      <div className={styles["replies"]}>
                        {replies.map(reply => renderComment(reply, depth + 1))}
                      </div>
                    )}
                  </div>
                );
              };

              return topLevel.map(comment => renderComment(comment));
            })() : "No comments so far"
          }
          <div className={styles["new-comment"]}>
            <textarea className={styles["comment-field"]} id="comment-field" disabled={!currentUser} value={newCommentText} onChange={(e) => setNewCommentText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNewComment(e); } }} maxLength={COMMENT_MAX}></textarea>
            {currentUser && (
              <div className={styles["emoji-row"]}>
                <EmojiPickerButton onEmojiSelect={(emoji) => setNewCommentText(prev => prev + emoji)} />
                <LinkInsertButton onInsert={(text) => setNewCommentText(prev => prev + text)} />
              </div>
            )}
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
      <ValidationWarningModal warnings={validationWarnings} onClose={() => setValidationWarnings(null)} />
    </div>
  );
};

export default Forum;