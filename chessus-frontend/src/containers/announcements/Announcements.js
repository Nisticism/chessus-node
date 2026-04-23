import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { parseServerDate } from "../../helpers/date-formatter";
import styles from "./announcements.module.scss";

const PAGE_SIZE = 10;

const Announcements = () => {
  const { user: currentUser } = useSelector((s) => s.authReducer);
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'owner');

  const [page, setPage] = useState(1);
  const [data, setData] = useState({ announcements: [], totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Admin compose form state
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', action_url: '' });
  const [posting, setPosting] = useState(false);

  const load = useCallback(async (p) => {
    setLoading(true); setErr(null);
    try {
      const res = await axios.get(`${API_URL}announcements?page=${p}&limit=${PAGE_SIZE}`);
      setData(res.data);
    } catch (e) {
      setErr(e?.response?.data?.message || e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page); }, [page, load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.content.trim()) return;
    setPosting(true);
    try {
      await axios.post(
        `${API_URL}announcements`,
        {
          title: form.title.trim(),
          content: form.content.trim(),
          action_url: form.action_url.trim() || null,
        },
        { headers: authHeader() },
      );
      setForm({ title: '', content: '', action_url: '' });
      setComposing(false);
      setPage(1);
      load(1);
    } catch (e) {
      alert(e?.response?.data?.message || e.message || 'Failed to post announcement');
    } finally { setPosting(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this announcement? Notifications fanned-out to users will also be removed.')) return;
    try {
      await axios.delete(`${API_URL}announcements/${id}`, { headers: authHeader() });
      load(page);
    } catch (e) {
      alert(e?.response?.data?.message || e.message);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Announcements</h1>
        {isAdmin && (
          <button
            type="button"
            className={styles.composeBtn}
            onClick={() => setComposing((v) => !v)}
          >
            {composing ? 'Cancel' : '+ New announcement'}
          </button>
        )}
      </div>
      <p className={styles.intro}>
        Site-wide updates from the GridGrove team. Each announcement also
        sends a one-time notification to every user.
      </p>

      {composing && (
        <form className={styles.composeForm} onSubmit={submit}>
          <label>
            Title
            <input
              type="text" maxLength={200} required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            Content
            <textarea
              rows={6} maxLength={5000} required
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </label>
          <label>
            Optional link URL
            <input
              type="text" maxLength={300} placeholder="/changelog or https://..."
              value={form.action_url}
              onChange={(e) => setForm({ ...form, action_url: e.target.value })}
            />
          </label>
          <button type="submit" disabled={posting}>
            {posting ? 'Posting…' : 'Post announcement to all users'}
          </button>
          <p className={styles.warn}>
            This will create a notification for every active user account.
            Use sparingly.
          </p>
        </form>
      )}

      {loading && <p>Loading…</p>}
      {err && <p className={styles.error}>{err}</p>}

      {!loading && data.announcements.length === 0 && (
        <p>No announcements yet.</p>
      )}

      <ul className={styles.list}>
        {data.announcements.map((a) => (
          <li key={a.id} className={styles.item}>
            <h3>
              <Link to={`/announcements/${a.id}`}>{a.title}</Link>
            </h3>
            <div className={styles.meta}>
              {parseServerDate(a.created_at).toLocaleString()}
              {a.author_username && <> · by {a.author_username}</>}
            </div>
            <p className={styles.preview}>
              {a.content.length > 280 ? a.content.slice(0, 280) + '…' : a.content}
            </p>
            {isAdmin && (
              <button
                type="button"
                className={styles.deleteBtn}
                onClick={() => handleDelete(a.id)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      {data.totalPages > 1 && (
        <div className={styles.pager}>
          <button
            type="button" disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ← Prev
          </button>
          <span>Page {page} of {data.totalPages}</span>
          <button
            type="button" disabled={page >= data.totalPages}
            onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default Announcements;
