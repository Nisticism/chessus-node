import React, { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useSelector } from "react-redux";
import axios from "../../services/axios-interceptor";
import authHeader from "../../services/auth-header";
import API_URL from "../../global/global";
import { parseServerDate } from "../../helpers/date-formatter";
import styles from "./announcements.module.scss";
import LinkInsertButton from "../../components/common/LinkInsertButton";
import { renderContent } from "../../helpers/render-content";

const AnnouncementDetail = () => {
  const { id } = useParams();
  const { user: currentUser } = useSelector((s) => s.authReducer);
  const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'owner');

  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', content: '' });
  const [saving, setSaving] = useState(false);
  const editContentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}announcements/${id}`)
      .then((res) => { if (!cancelled) setA(res.data.announcement); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.message || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const handleEdit = () => {
    setEditForm({ title: a.title, content: a.content });
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
        },
        { headers: authHeader() },
      );
      setA((prev) => ({
        ...prev,
        title: editForm.title.trim(),
        content: editForm.content.trim(),
      }));
      setEditing(false);
    } catch (e) {
      alert(e?.response?.data?.message || e.message || 'Failed to update announcement');
    } finally { setSaving(false); }
  };

  if (loading) return <div className={styles.page}><p>Loading…</p></div>;
  if (err) return <div className={styles.page}><p className={styles.error}>{err}</p></div>;
  if (!a) return null;

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
            <div className={`${styles.charCounter} ${editForm.title.length > 180 ? styles.charCounterWarn : ''}`}>{editForm.title.length} / 200</div>
          </label>
          <label>
            Content
            <textarea
              rows={8} maxLength={5000} required
              value={editForm.content}
              ref={editContentRef}
              onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
            />
            <div className={`${styles.charCounter} ${editForm.content.length > 4500 ? styles.charCounterWarn : ''}`}>{editForm.content.length.toLocaleString()} / 5,000</div>
          </label>
          <div style={{ marginBottom: '10px' }}>
            <LinkInsertButton textareaRef={editContentRef} onChange={(newVal) => setEditForm((f) => ({ ...f, content: newVal }))} />
          </div>
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
            {renderContent(a.content)}
          </div>
        </>
      )}
    </div>
  );
};

export default AnnouncementDetail;

