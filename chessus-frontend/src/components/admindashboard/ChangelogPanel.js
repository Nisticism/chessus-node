import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import authHeader from "../../services/auth-header";
import styles from "./admin-dashboard.module.scss";

const API_URL = (process.env.REACT_APP_API_URL || "http://localhost:3001") + "/api/";

/*
 * Writing the changelog.
 *
 * A day is the unit. The table has a UNIQUE key on the date, so saving a date
 * that already exists EDITS that day rather than making a second one - which is
 * the whole reason the changelog moved out of a source file, where "two entries
 * for the same day" was not only possible but common.
 *
 * Within a day there can be several titled sections, because a busy day used to
 * produce several separate entries and none of that writing should be lost or
 * flattened into one undifferentiated list.
 */

/* Today where the ADMIN is, which is the day they mean when they say "today". */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/*
 * How a stored instant reads to this admin, spelled out.
 *
 * Shown because the two can differ: an entry filed late in the evening is
 * already tomorrow in UTC, and an admin who cannot see that would file the next
 * day's work against the same date and wonder why it merged.
 */
const describeInstant = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const emptyDraft = () => ({ date: localToday(), sections: [{ title: "", items: [""] }] });

const ChangelogPanel = () => {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API_URL}admin/changelog`, { headers: authHeader() });
      setEntries(Array.isArray(data?.entries) ? data.entries : []);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.message || "Could not load the changelog.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setSection = (si, patch) => setDraft((d) => ({
    ...d,
    sections: d.sections.map((s, i) => (i === si ? { ...s, ...patch } : s)),
  }));

  const setItem = (si, ii, value) => setDraft((d) => ({
    ...d,
    sections: d.sections.map((s, i) => (i === si
      ? { ...s, items: s.items.map((it, j) => (j === ii ? value : it)) }
      : s)),
  }));

  const save = async () => {
    const cleaned = draft.sections
      .map((s) => ({ title: s.title.trim() || null, items: s.items.map((i) => i.trim()).filter(Boolean) }))
      .filter((s) => s.items.length);
    if (!cleaned.length) { setError("Add at least one item before saving."); return; }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const existing = entries.find((e) => e.entry_date === draft.date);
      const { data } = await axios.put(
        `${API_URL}admin/changelog/${draft.date}`,
        { sections: cleaned },
        { headers: authHeader() }
      );
      setNotice(existing
        ? `Updated ${draft.date}. It already had ${existing.sections.length} section(s); this replaced them.`
        : `Saved ${draft.date}. ${data?.entry?.sections?.length || cleaned.length} section(s).`);
      setDraft(emptyDraft());
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not save that entry.");
    } finally {
      setSaving(false);
    }
  };

  const editExisting = (entry) => {
    setDraft({
      date: entry.entry_date,
      sections: (entry.sections || []).map((s) => ({
        title: s.title || "",
        items: [...(s.items || []), ""],
      })),
    });
    setNotice(`Loaded ${entry.entry_date} for editing. Saving will replace that day.`);
    setError(null);
  };

  const remove = async (entry) => {
    // eslint-disable-next-line no-restricted-globals
    if (!window.confirm(`Delete the changelog entry for ${entry.entry_date}? This cannot be undone.`)) return;
    try {
      await axios.delete(`${API_URL}admin/changelog/${entry.id}`, { headers: authHeader() });
      setNotice(`Deleted ${entry.entry_date}.`);
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || "Could not delete that entry.");
    }
  };

  const existingForDate = entries.find((e) => e.entry_date === draft.date);

  return (
    <div className={styles["settings-section"]}>
      <h3>Changelog</h3>
      <p style={{ opacity: 0.75, marginTop: 0 }}>
        One entry per day. Saving a date that already has an entry replaces that day rather
        than adding a second one. Readers see each entry on whatever day it was where they are.
      </p>

      {error && <p style={{ color: "#ff8080" }}>{error}</p>}
      {notice && <p style={{ color: "#8fd68f" }}>{notice}</p>}

      <div style={{ border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: 12, marginBottom: 20 }}>
        <label style={{ display: "block", marginBottom: 8 }}>
          <strong>Date</strong>{" "}
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
            style={{ marginLeft: 8 }}
          />
          {existingForDate && (
            <span style={{ marginLeft: 10, color: "#e0c070" }}>
              This day already has an entry — saving replaces it.
            </span>
          )}
        </label>

        {draft.sections.map((section, si) => (
          <div key={si} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed rgba(255,255,255,0.12)" }}>
            <input
              type="text"
              placeholder="Section title (optional)"
              value={section.title}
              onChange={(e) => setSection(si, { title: e.target.value })}
              style={{ width: "100%", marginBottom: 6 }}
            />
            {section.items.map((item, ii) => (
              <textarea
                key={ii}
                placeholder="What changed?"
                value={item}
                onChange={(e) => setItem(si, ii, e.target.value)}
                rows={2}
                style={{ width: "100%", marginBottom: 4 }}
              />
            ))}
            <button
              type="button"
              onClick={() => setSection(si, { items: [...section.items, ""] })}
            >
              + item
            </button>
            {draft.sections.length > 1 && (
              <button
                type="button"
                style={{ marginLeft: 6 }}
                onClick={() => setDraft((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== si) }))}
              >
                remove section
              </button>
            )}
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setDraft((d) => ({ ...d, sections: [...d.sections, { title: "", items: [""] }] }))}
          >
            + section
          </button>
          <button type="button" onClick={save} disabled={saving} style={{ marginLeft: 8 }}>
            {saving ? "Saving…" : existingForDate ? "Replace that day" : "Save entry"}
          </button>
          <button type="button" onClick={() => { setDraft(emptyDraft()); setNotice(null); setError(null); }} style={{ marginLeft: 8 }}>
            Clear
          </button>
        </div>
      </div>

      <h4>Existing entries {loading ? "" : `(${entries.length})`}</h4>
      {loading && <p>Loading…</p>}
      {!loading && entries.length === 0 && <p>Nothing yet.</p>}
      {entries.slice(0, 40).map((entry) => (
        <div key={entry.id} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
          <strong>{entry.entry_date}</strong>
          <span style={{ opacity: 0.6, marginLeft: 8 }}>
            {describeInstant(entry.published_at)} your time
          </span>
          <span style={{ opacity: 0.6, marginLeft: 8 }}>
            · {entry.sections.length} section(s), {entry.sections.reduce((n, s) => n + (s.items?.length || 0), 0)} item(s)
          </span>
          <button type="button" onClick={() => editExisting(entry)} style={{ marginLeft: 10 }}>Edit</button>
          <button type="button" onClick={() => remove(entry)} style={{ marginLeft: 6 }}>Delete</button>
        </div>
      ))}
      {entries.length > 40 && <p style={{ opacity: 0.6 }}>…and {entries.length - 40} older.</p>}
    </div>
  );
};

export default ChangelogPanel;
