import React, { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import authHeader from "../../services/auth-header";
import { parseServerDate } from "../../helpers/date-formatter";
import styles from "./announcements.module.scss";
import LinkInsertButton from "../../components/common/LinkInsertButton";
import { renderContent } from "../../helpers/render-content";

const PAGE_SIZE = 10;

const Announcements = () => {
  const { user: currentUser } = useSelector((s) => s.authReducer);
  const isOwner = currentUser && currentUser.role === 'owner';
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'owner');

  const [page, setPage] = useState(1);
  const [data, setData] = useState({ announcements: [], totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Admin compose form state
  const [composing, setComposing] = useState(false);
  const [form, setForm] = useState({ title: '', content: '' });
  const [posting, setPosting] = useState(false);

  // Admin inline edit state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);

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
        },
        { headers: authHeader() },
      );
      setForm({ title: '', content: '' });
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

  const handleEdit = (a) => {
    setEditForm({ title: a.title, content: a.content });
    setEditingId(a.id);
  };

  const submitEdit = async (e, id) => {
    e.preventDefault();
    if (!editForm.title.trim() || !editForm.content.trim()) return;
    setSaving(true);
    try {
      await axios.put(
        `${API_URL}announcements/${id}`,
        {
          title: editForm.title.trim(),
          content: editForm.content.trim(),
        },
        { headers: authHeader() },
      );
      setEditingId(null);
      load(page);
    } catch (e) {
      alert(e?.response?.data?.message || e.message || 'Failed to update announcement');
    } finally { setSaving(false); }
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
            <div className={`${styles.charCounter} ${form.title.length > 180 ? styles.charCounterWarn : ''}`}>{form.title.length} / 200</div>
          </label>
          <label>
            Content
            <textarea
              rows={6} maxLength={5000} required
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
            <div className={`${styles.charCounter} ${form.content.length > 4500 ? styles.charCounterWarn : ''}`}>{form.content.length.toLocaleString()} / 5,000</div>
          </label>
          <div style={{ marginBottom: '10px' }}>
            <LinkInsertButton onInsert={(text) => setForm((f) => ({ ...f, content: f.content + text }))} />
          </div>
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
        {data.announcements.map((a) => {
          return (
            <li key={a.id} className={styles.item}>
              {editingId === a.id ? (
                <form className={styles.editForm} onSubmit={(e) => submitEdit(e, a.id)}>
                  <label>
                    Title
                    <input
                      type="text" maxLength={200} required
                      value={editForm.title}
                      onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    />
                    <div className={`${styles.charCounter} ${editForm.title.length > 180 ? styles.charCounterWarn : ''}`}>{editForm.title.length} / 200</div>
                  </label>
                  <label>
                    Content
                    <textarea
                      rows={6} maxLength={5000} required
                      value={editForm.content}
                      onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                    />
                    <div className={`${styles.charCounter} ${editForm.content.length > 4500 ? styles.charCounterWarn : ''}`}>{editForm.content.length.toLocaleString()} / 5,000</div>
                  </label>
                  <div style={{ marginBottom: '10px' }}>
                    <LinkInsertButton onInsert={(text) => setEditForm((f) => ({ ...f, content: f.content + text }))} />
                  </div>
                  <div className={styles.editFormButtons}>
                    <button type="submit" disabled={saving}>
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <h3>{a.title}</h3>
                  <div className={styles.meta}>
                    {parseServerDate(a.created_at).toLocaleString()}
                    {a.author_username && <> · by {a.author_username}</>}
                  </div>
                  <div className={styles.preview}>
                    {renderContent(a.content)}
                  </div>
                  <div className={styles.itemFooter}>
                    <Link to={`/announcements/${a.id}`} className={styles.viewBtn}>
                      View announcement →
                    </Link>
                    {isAdmin && (
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => handleEdit(a)}
                      >
                        Edit
                      </button>
                    )}
                    {isOwner && (
                      <button
                        type="button"
                        className={styles.deleteBtn}
                        onClick={() => handleDelete(a.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
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

