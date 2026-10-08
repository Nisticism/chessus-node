import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import styles from "./upvote.module.scss";

/*
 * The upvote button for things people make - games, pieces and puzzles - on
 * their lists and their own pages. The same ▲/△ the games have always used.
 *
 * Give it `count` and `upvoted` when the list already has them (every row of
 * a list does); leave them out and it asks the server itself, which is what a
 * detail page wants.
 *
 * Nobody can upvote their own creation: for the creator it shows the count but
 * cannot be pressed. The server refuses it as well, whatever this shows.
 */

const PATH = { game: "games", piece: "pieces", puzzle: "puzzles" };

export const toggleUpvoteFor = async (kind, id) =>
  (await axios.post(`${API_URL}${PATH[kind]}/${id}/upvote`, {}, { headers: authHeader() })).data;

export const upvoteStatusFor = async (kind, id) =>
  (await axios.get(`${API_URL}${PATH[kind]}/${id}/upvote`, { headers: authHeader() })).data;

const UpvoteButton = ({ kind, id, count, upvoted, ownerId, size = "small", onChange }) => {
  const navigate = useNavigate();
  const { user: currentUser } = useSelector((state) => state.authReducer);
  const given = count !== undefined;
  const [state, setState] = useState({ count: Number(count) || 0, upvoted: !!upvoted, own: false });
  const [busy, setBusy] = useState(false);

  // From the list's row when it has one ...
  useEffect(() => {
    if (given) setState((s) => ({ ...s, count: Number(count) || 0, upvoted: !!upvoted }));
  }, [given, count, upvoted]);

  // ... or from the server (a detail page), again whenever who is signed in changes.
  useEffect(() => {
    if (given || !id) return undefined;
    let cancelled = false;
    upvoteStatusFor(kind, id)
      .then((d) => { if (!cancelled) setState({ count: Number(d.upvote_count) || 0, upvoted: !!d.upvoted, own: !!d.own }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [given, kind, id, currentUser?.id]);

  const own = state.own || (!!currentUser && ownerId != null && Number(ownerId) === Number(currentUser.id));
  const title = own
    ? `You can't upvote your own ${kind}`
    : !currentUser
      ? "Log in to upvote"
      : state.upvoted ? "Remove upvote" : `Upvote this ${kind}`;

  const press = async (e) => {
    // Lists put this inside a clickable card; the press is the button's alone.
    e.preventDefault();
    e.stopPropagation();
    if (own || busy) return;
    if (!currentUser) {
      navigate("/login", { state: { message: `Please log in to upvote ${kind}s.` } });
      return;
    }
    setBusy(true);
    try {
      const r = await toggleUpvoteFor(kind, id);
      setState((s) => ({ ...s, count: Number(r.upvote_count) || 0, upvoted: !!r.upvoted }));
      if (onChange) onChange(r);
    } catch (err) {
      if (err?.response?.data?.own) setState((s) => ({ ...s, own: true }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`${styles.upvote} ${styles[size] || ""} ${state.upvoted ? styles.upvoted : ""} ${own ? styles.own : ""}`}
      onClick={press}
      title={title}
      aria-label={`${title} (${state.count} upvote${state.count === 1 ? "" : "s"})`}
      aria-pressed={state.upvoted}
      aria-disabled={own || undefined}
    >
      <span className={styles.icon} aria-hidden="true">{state.upvoted ? "▲" : "△"}</span>
      <span>{state.count}</span>
    </button>
  );
};

export default UpvoteButton;
