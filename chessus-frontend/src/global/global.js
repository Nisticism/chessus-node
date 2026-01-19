// const API_URL = "https://squarestrat.com/";
const API_URL = (process.env.REACT_APP_API_URL || "") + "/api/";

module.exports = API_URL;