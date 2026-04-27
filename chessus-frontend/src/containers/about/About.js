import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import API_URL from "../../global/global";
import styles from "./about.module.scss";

const ASSET_URL = process.env.REACT_APP_ASSET_URL || "http://localhost:3001";

const DEFAULT_MISSION = `GridGrove is a community-driven platform dedicated to empowering players to create, share, and play custom strategy board games. We believe that the timeless appeal of chess and strategy games deserves a modern, creative twist — one where the players themselves shape the experience.

Founded in 2025, GridGrove was born from the idea that chess variants shouldn't be limited to what's already been invented. Our platform gives anyone the tools to design unique pieces with custom movement patterns, build game boards of any size, and share their creations with a global community of strategists.`;

/**
 * Render the mission text. Splits on blank lines into paragraphs so the
 * admin can write multi-paragraph content in the textarea naturally.
 */
function renderMission(text) {
  const paragraphs = (text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return paragraphs.map((p, i) => <p key={i}>{p}</p>);
}

/**
 * Resolve a stored team-member picture URL into an absolute URL the
 * browser can fetch. Stored URLs are either:
 *   - a relative path under /uploads/... (from our upload endpoint)
 *   - an absolute http(s) URL (admin pasted external avatar)
 *   - empty (no picture; render an initial-letter avatar instead)
 */
function resolvePicture(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) return `${ASSET_URL}${url}`;
  return url;
}

const About = () => {
  const [mission, setMission] = useState(DEFAULT_MISSION);
  const [team, setTeam] = useState([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await axios.get(
          `${API_URL}site-settings?keys=about_mission_text,about_team_members`,
        );
        if (!alive) return;
        const settings = res.data?.settings || {};
        if (typeof settings.about_mission_text === "string" && settings.about_mission_text.trim()) {
          setMission(settings.about_mission_text);
        }
        if (typeof settings.about_team_members === "string") {
          try {
            const parsed = JSON.parse(settings.about_team_members);
            if (Array.isArray(parsed)) setTeam(parsed.slice(0, 20));
          } catch (_) { /* ignore malformed JSON, render empty */ }
        }
      } catch (_) { /* fall back to defaults */ }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className={styles["about-container"]}>
      <div className={styles["about-header"]}>
        <h1>About GridGrove</h1>
        <p className={styles["subtitle"]}>Community-driven chess variant design, creation, and play</p>
      </div>

      <div className={styles["about-panel"]}>
        <h2>Our Mission</h2>
        {renderMission(mission)}
      </div>

      {team.length > 0 && (
        <div className={styles["about-panel"]}>
          <h2>Our Team</h2>
          <div className={styles["team-grid"]}>
            {team.map((m, i) => {
              const pic = resolvePicture(m.picture_url);
              const initial = (m.username || "?").trim().charAt(0).toUpperCase() || "?";
              const linkTarget = m.profile_link && m.profile_link.trim()
                ? m.profile_link.trim()
                : (m.username ? `/profile/${m.username}` : null);
              const isExternal = linkTarget && /^https?:\/\//i.test(linkTarget);
              const nameContent = m.username || "Team Member";
              return (
                <div className={styles["team-member"]} key={i}>
                  {pic ? (
                    <img
                      src={pic}
                      alt={m.username || "team member"}
                      className={styles["member-avatar"]}
                    />
                  ) : (
                    <div className={styles["member-avatar"]}>{initial}</div>
                  )}
                  <div className={styles["member-info"]}>
                    <h3>
                      {linkTarget ? (
                        isExternal ? (
                          <a
                            href={linkTarget}
                            target="_blank"
                            rel="noreferrer noopener"
                            className={styles["profile-link"]}
                          >
                            {nameContent}
                          </a>
                        ) : (
                          <Link to={linkTarget} className={styles["profile-link"]}>
                            {nameContent}
                          </Link>
                        )
                      ) : (
                        nameContent
                      )}
                    </h3>
                    {m.role && <div className={styles["member-role"]}>{m.role}</div>}
                    {m.contribution && <p>{m.contribution}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles["about-panel"]}>
        <h2>Future Goals</h2>
        <div className={styles["goals-grid"]}>
          <div className={styles["goal-card"]}>
            <div className={styles["goal-icon"]}>🏆</div>
            <h3>Global Tournaments</h3>
            <p>Expand our tournament system to support large-scale competitive events with prizes and rankings across multiple game variants.</p>
          </div>
          <div className={styles["goal-card"]}>
            <div className={styles["goal-icon"]}>🤖</div>
            <h3>AI Opponents</h3>
            <p>Develop AI that can learn and play any custom game variant, giving players practice partners and solo play options.</p>
          </div>
          <div className={styles["goal-card"]}>
            <div className={styles["goal-icon"]}>📱</div>
            <h3>Mobile App</h3>
            <p>Bring GridGrove to iOS and Android so players can create, share, and play on the go.</p>
          </div>
          <div className={styles["goal-card"]}>
            <div className={styles["goal-icon"]}>📚</div>
            <h3>Educational Tools</h3>
            <p>Build resources for educators to use GridGrove as a teaching tool for logic, strategy, and game design.</p>
          </div>
          <div className={styles["goal-card"]}>
            <div className={styles["goal-icon"]}>♟️</div>
            <h3>More Games</h3>
            <p>Add support for Shogi, Go, Duck Chess, Bughouse, Othello, and other grid-based board games.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;
