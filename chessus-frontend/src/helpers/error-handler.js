/**
 * Extract error message from API error response
 * @param {Error} error - The error object from axios or other source
 * @returns {string} - User-friendly error message
 */
export const getErrorMessage = (error) => {
  return (
    (error.response &&
      error.response.data &&
      error.response.data.message) ||
    error.message ||
    error.toString()
  );
};
