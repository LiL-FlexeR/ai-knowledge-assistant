'use client';
import { useSyncExternalStore } from 'react';
function subscribe(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    document.removeEventListener('visibilitychange', callback);
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}
export function useActivity() {
  return useSyncExternalStore(
    subscribe,
    () => document.visibilityState === 'visible' && navigator.onLine,
    () => false,
  );
}
