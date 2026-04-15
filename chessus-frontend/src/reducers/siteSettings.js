import { FETCH_SITE_SETTINGS_SUCCESS } from "../actions/types";

const initialState = {
  changelogEnabled: true,
  loaded: false,
};

const siteSettings = (state = initialState, action) => {
  switch (action.type) {
    case FETCH_SITE_SETTINGS_SUCCESS:
      return {
        ...state,
        ...action.payload,
        loaded: true,
      };
    default:
      return state;
  }
};

export default siteSettings;
