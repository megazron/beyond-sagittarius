/**
 * The Android app (Capacitor): the hardware back button and the app going to the background.
 * On the web this does nothing; the Capacitor plugins are only loaded inside the app.
 */
import { Capacitor } from '@capacitor/core';

export interface AndroidHooks {
  /** Back was pressed: return true if the game used it (closed a menu, paused, skipped a scene). */
  back(): boolean;
  /** The app left the screen: pause the game and save. */
  hidden(): void;
  /** Text for the exit question, in the game's language. */
  exitQuestion(): string;
}

export const isNativeApp = () => Capacitor.isNativePlatform();

export async function initAndroid(h: AndroidHooks) {
  if (!isNativeApp()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    if (h.back()) return;
    if (window.confirm(h.exitQuestion())) void App.exitApp();
  });
  await App.addListener('pause', () => h.hidden());
}
