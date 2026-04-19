import axios from "../services/axios-interceptor";
import API_URL from "../global/global";
import { FETCH_SITE_SETTINGS_SUCCESS } from "./types";

const DEFAULT_FORUM_INVITE_TEXT =
  "Welcome new players! 🌿 With so many of you joining recently, we'd love to hear from you. " +
  "Head over to our community forums to discuss bugs you've run into, ask questions, and share " +
  "what changes you'd like to see. Heads-up: while we're rolling out improvements, expect frequent " +
  "server restarts as new updates go live.";

const PUBLIC_KEYS = ["changelog_enabled", "forum_invite_enabled", "forum_invite_text"];

export const fetchSiteSettings = () => (dispatch) => {
  return axios.get(`${API_URL}site-settings?keys=${PUBLIC_KEYS.join(",")}`)
    .then((res) => {
      const settings = res.data?.settings || {};
      dispatch({
        type: FETCH_SITE_SETTINGS_SUCCESS,
        payload: {
          changelogEnabled: settings.changelog_enabled !== "false",
          forumInviteEnabled: settings.forum_invite_enabled !== "false",
          forumInviteText: settings.forum_invite_text || DEFAULT_FORUM_INVITE_TEXT,
        },
      });
    })
    .catch(() => {
      // Default to enabled if endpoint errors
      dispatch({
        type: FETCH_SITE_SETTINGS_SUCCESS,
        payload: {
          changelogEnabled: true,
          forumInviteEnabled: true,
          forumInviteText: DEFAULT_FORUM_INVITE_TEXT,
        },
      });
    });
};
