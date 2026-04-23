import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "../../services/axios-interceptor";
import API_URL from "../../global/global";
import { parseServerDate } from "../../helpers/date-formatter";
import styles from "./announcements.module.scss";

const AnnouncementDetail = () => {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    axios.get(`${API_URL}announcements/${id}`)
      .then((res) => { if (!cancelled) setA(res.data.announcement); })
      .catch((e) => { if (!cancelled) setErr(e?.response?.data?.message || e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className={styles.page}><p>Loading…</p></div>;
  if (err) return <div className={styles.page}><p className={styles.error}>{err}</p></div>;
  if (!a) return null;

  return (
    <div className={styles.page}>
      <Link to="/announcements" className={styles.backLink}>← All announcements</Link>
      <h1>{a.title}</h1>
      <div className={styles.meta}>
        {parseServerDate(a.created_at).toLocaleString()}
        {a.author_username && <> · by {a.author_username}</>}
      </div>
      <div className={styles.body}>
        {a.content.split(/\n+/).map((para, i) => <p key={i}>{para}</p>)}
      </div>
      {a.action_url && a.action_url !== `/announcements/${a.id}` && (
        <p>
          <Link to={a.action_url} className={styles.actionLink}>
            {a.action_url.startsWith('http') ? 'Open link' : 'Read more'} →
          </Link>
        </p>
      )}
    </div>
  );
};

export default AnnouncementDetail;
