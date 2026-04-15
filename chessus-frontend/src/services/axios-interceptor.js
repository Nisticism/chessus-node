import axios from 'axios';
import AuthService from './auth.service';

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  
  failedQueue = [];
};

// Helper to check if a JWT token is expired or about to expire (within 60 seconds)
function isTokenExpiringSoon(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() + 60000; // expired or expiring within 60s
  } catch {
    return true;
  }
}

// Add request interceptor to proactively refresh expired tokens before sending
// This prevents silent auth failures on optionalAuthenticate endpoints
axios.interceptors.request.use(
  async (config) => {
    // Skip token refresh for auth endpoints to avoid infinite loops
    const isAuthEndpoint = config.url?.includes('/token') || 
                          config.url?.includes('/login') || 
                          config.url?.includes('/register');
    if (isAuthEndpoint) return config;

    const user = JSON.parse(localStorage.getItem('user'));
    if (user && user.accessToken && user.refreshToken && isTokenExpiringSoon(user.accessToken)) {
      try {
        const newAccessToken = await AuthService.refreshAccessToken();
        config.headers['Authorization'] = 'Bearer ' + newAccessToken;
      } catch {
        // Refresh failed, proceed without token
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Add response interceptor to handle token expiration
axios.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Retry on network errors (e.g. server restarting during development)
    // Catches: Network Error, ECONNREFUSED, ECONNRESET, ETIMEDOUT, ERR_NETWORK
    const isNetworkError = !error.response && (
      error.message === 'Network Error' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ERR_NETWORK'
    );
    if (isNetworkError && originalRequest) {
      if (!originalRequest._networkRetry) originalRequest._networkRetry = 0;
      if (originalRequest._networkRetry < 10) {
        originalRequest._networkRetry++;
        // Exponential backoff: 1s, 1.5s, 2.25s, ... capped at 5s
        const delay = Math.min(1000 * Math.pow(1.5, originalRequest._networkRetry - 1), 5000);
        await new Promise(r => setTimeout(r, delay));
        return axios(originalRequest);
      }
    }

    // If error is 401 (unauthorized) or 403 (forbidden/expired token) and we haven't tried to refresh yet
    // Skip refresh attempts for login/register/token endpoints to avoid infinite loops
    const isAuthEndpoint = originalRequest?.url?.includes('/login') || 
                          originalRequest?.url?.includes('/register') || 
                          originalRequest?.url?.includes('/token');
    
    const shouldRefresh = (error.response?.status === 401 || error.response?.status === 403) && 
                         !originalRequest._retry && 
                         !isAuthEndpoint;
    
    if (shouldRefresh) {
      if (isRefreshing) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(token => {
            originalRequest.headers['Authorization'] = 'Bearer ' + token;
            return axios(originalRequest);
          })
          .catch(err => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newAccessToken = await AuthService.refreshAccessToken();
        processQueue(null, newAccessToken);
        originalRequest.headers['Authorization'] = 'Bearer ' + newAccessToken;
        return axios(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        // Auth service handles logout/redirect, but we still reject for proper error handling
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export default axios;
