import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import styles from "./likes-module.module.scss";
import { AiOutlineHeart, AiFillHeart } from "react-icons/ai";
import ForumsService from "../../services/forums.service";

/*
 * The like on a forum post's own page.
 *
 * Through the signed-in toggle (/api/forums/:id/toggle-like), like the forum
 * lists. It used the old like/unlike pair, which took the user id from the
 * request body. The post's author sees the count but cannot like their own
 * post - the server refuses it as well.
 */
const LikesModule = (props) => {
  const currentForum = useSelector((state) => state.forums.forum);
  const likes = currentForum?.likes || [];
  const [liked, setLiked] = useState(likes.some((l) => l.user_id === props.userId));
  const [count, setCount] = useState(likes.length);
  const [busy, setBusy] = useState(false);

  // A different post, or the same one reloaded.
  useEffect(() => {
    const list = currentForum?.likes || [];
    setLiked(list.some((l) => l.user_id === props.userId));
    setCount(list.length);
  }, [currentForum, props.userId]);

  const own = currentForum?.author_id != null && Number(currentForum.author_id) === Number(props.userId);

  async function toggle(e) {
    e.preventDefault();
    if (own || busy) return;
    setBusy(true);
    try {
      const result = await ForumsService.toggleForumLike(props.forumId);
      setLiked(!!result.liked);
      setCount(Number(result.like_count) || 0);
    } catch (_) {
      // Left as it was.
    } finally {
      setBusy(false);
    }
  }

  const title = own ? "You can't like your own post" : liked ? "Unlike" : "Like this post";
  const Icon = liked ? AiFillHeart : AiOutlineHeart;
  return (
    <div className={styles["likes-module"]}>
      <div className={styles["likes-count"]}>{count}</div>
      <Icon
        className={`${styles["likes"]} ${own ? styles["own"] : ""}`}
        onClick={toggle}
        title={title}
        role="button"
        aria-label={`${title} (${count} like${count === 1 ? "" : "s"})`}
        aria-pressed={liked}
        aria-disabled={own || undefined}
      />
    </div>
  );
};

export default LikesModule;
