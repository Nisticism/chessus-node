import React, { useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import styles from "./likes-module.module.scss";
import { deleteUser } from "../../actions/auth";
import { AiOutlineLike } from "react-icons/ai";
import { AiFillLike } from "react-icons/ai";
import { newLike, deleteLike } from "../../actions/forums";

const LikesModule = (props) => {

  const [isLiked, setIsliked] = useState(props.isLiked);
  const [likeCount, setLikeCount] = useState(props.likeCount);
  const dispatch = useDispatch();
  const currentForum = useSelector((state) => state.forums.forum);



  function handleLike(e) {
    e.preventDefault();
    console.log("liked");
    setIsliked(true);
    dispatch(newLike(props.userId, props.forumId));
  }

  function handleDeleteLike(e) {
    e.preventDefault();
    console.log("like deleted");
    setIsliked(false);
    let userLike = getUserLike();
    dispatch(deleteLike(userLike.id));
  }

  function getUserLike() {
    let userLike = currentForum.likes.filter((like) => like.user_id === props.userId)[0];
    console.log(userLike);
    return userLike;
  }

  return (
    <div className="container">
      <div className={styles["likes-module"]}>
        <div className={styles["likes-count"]}>{ currentForum.likes ? currentForum.likes.length : 0 }</div>
          { 
            currentForum.likes && currentForum.likes.filter((like) => like.user_id === props.userId).length === 0 ? 
            <AiOutlineLike className={styles["likes"]} onClick={(event) => handleLike(event)}/>
            : <AiFillLike className={styles["likes"]} onClick={(event) => handleDeleteLike(event)}/>
          }
      </div>
    </div>
  );
};

export default LikesModule;