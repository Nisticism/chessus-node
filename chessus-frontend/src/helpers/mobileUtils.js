// Mobile detection and touch utilities

export const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
         (window.innerWidth <= 768);
};

export const isTouchDevice = () => {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

// Hook for long press detection
export const useLongPress = (callback, options = {}) => {
  const { threshold = 500, onStart, onFinish, onCancel } = options;
  let timeout;
  let preventClick = false;

  const start = (event) => {
    // Only handle long press on mobile/touch devices
    if (!isTouchDevice()) return;
    
    preventClick = false;
    if (onStart) onStart(event);
    
    timeout = setTimeout(() => {
      preventClick = true;
      callback(event);
      if (onFinish) onFinish(event);
    }, threshold);
  };

  const clear = (event, shouldTriggerOnCancel = true) => {
    timeout && clearTimeout(timeout);
    if (shouldTriggerOnCancel && onCancel && preventClick === false) {
      onCancel(event);
    }
  };

  const clickCaptureHandler = (event) => {
    if (preventClick) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return {
    onMouseDown: (e) => !isTouchDevice() && start(e),
    onTouchStart: start,
    onMouseUp: (e) => !isTouchDevice() && clear(e),
    onMouseLeave: (e) => !isTouchDevice() && clear(e, false),
    onTouchEnd: clear,
    onTouchMove: (e) => clear(e, false),
    onClickCapture: clickCaptureHandler,
  };
};
