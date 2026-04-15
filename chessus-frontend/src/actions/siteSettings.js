import axios from "../services/axios-interceptor";
import API_URL from "../global/global";
import { FETCH_SITE_SETTINGS_SUCCESS } from "./types";

export const fetchSiteSettings = () => (dispatch) => {
  return axios.get(`${API_URL}site-settings/changelog_enabled`)
    .then((res) => {
      dispatch({
        type: FETCH_SITE_SETTINGS_SUCCESS,
        payload: {
          changelogEnabled: res.data.value !== "false" && res.data.value !== false,
        },
      });
    })
    .catch(() => {
      // Default to enabled if endpoint errors
      dispatch({
        type: FETCH_SITE_SETTINGS_SUCCESS,
        payload: { changelogEnabled: true },
      });
    });
};
