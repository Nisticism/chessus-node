import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import authHeader from "../../services/auth-header";
import API_URL from "../../global/global";
import { parseServerDate } from "../../helpers/date-formatter";
import styles from "./announcements.module.scss";

const AnnouncementDetail = () => {
  const { id } = useParams();
  const { user: currentUser } = useSelector((s) => s.authReducer);
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'owner');

  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', content: '', action_url: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}announcements/${id}`)
      .then((res) => { if (!cancelled) setA(res.data.announcement); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.message || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const handleEdit = () => {
    const customUrl = a.action_url && a.action_url !== `/announcements/${a.id}` ? a.action_url : '';
    setEditForm({ title: a.title, content: a.content, action_url: customUrl });
    setEditing(true);
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editForm.title.trim() || !editForm.content.trim()) return;
    setSaving(true);
    try {
      await axios.put(
        `${API_URL}announcements/${id}`,
        {
          title: editForm.title.trim(),
          content: editForm.content.trim(),
          action_url: editForm.action_url.trim() || null,
        },
        { headers: authHeader() },
      );
      setA((prev) => ({
        ...prev,
        title: editForm.title.trim(),
        content: editForm.content.trim(),
        action_url: editForm.action_url.trim() || null,
      }));
      setEditing(false);
    } catch (e) {
      alert(e?.response?.data?.message || e.message || 'Failed to update announcement');
    } finally { setSaving(false); }
  };

  if (loading) return <div className={styles.page}><p>Loading…</p></div>;
  if (err) return <div className={styles.page}><p className={styles.error}>{err}</p></div>;
  if (!a) return null;

  const hasCustomLink = a.action_url && a.action_url !== `/announcements/${a.id}`;

  return (
    <div className={styles.page}>
      <Link to="/announcements" className={styles.backLink}>← All announcements</Link>
      {editing ? (
        <form className={styles.editForm} onSubmit={submitEdit}>
          <label>
            Title
            <input
              type="text" maxLength={200} required
              value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
            />
          </label>
          <label>
            Content
            <textarea
              rows={8} maxLength={5000} required
              value={editForm.content}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
            />
          </label>
          <label>
            Optional link URL
            <input
              type="text" maxLength={300} placeholder="/changelog or https://..."
              value={editForm.action_url}
              onChange={(e) => setEditForm({ ...editForm, action_url: e.target.value })}
            />
          </label>
          <div className={styles.editFormButtons}>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className={styles.detailHeader}>
            <h1>{a.title}</h1>
            {isAdmin && (
              <button type="button" className={styles.editBtn} onClick={handleEdit}>
                Edit
              </button>
            )}
          </div>
          <div className={styles.meta}>
            {parseServerDate(a.created_at).toLocaleString()}
            {a.author_username && <> · by {a.author_username}</>}
          </div>
          <div className={styles.body}>
            {a.content.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
          </div>
          {hasCustomLink && (
            <p>
              {a.action_url.startsWith('http') ? (
                <a href={a.action_url} target="_blank" rel="noopener noreferrer" className={styles.actionLink}>
                  Open link →
                </a>
              ) : (
                <Link to={a.action_url} className={styles.actionLink}>
                  Read more →
                </Link>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default AnnouncementDetail;

