"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import { loadSettingsFromStorage, saveSettingsToStorage } from "@/lib/settings-storage";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  type LecturerSettings,
} from "@/types/settings";

interface SettingsContextValue {
  settings: LecturerSettings;
  updateSettings: (nextSettings: LecturerSettings) => void;
  patchSettings: (patch: Partial<LecturerSettings>) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);
const SETTINGS_UPDATED_EVENT = "lecturer:settings-updated";

function subscribeToSettings(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === SETTINGS_STORAGE_KEY) {
      onStoreChange();
    }
  };

  const onSettingsUpdated = () => {
    onStoreChange();
  };

  window.addEventListener("storage", onStorage);
  window.addEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(SETTINGS_UPDATED_EVENT, onSettingsUpdated);
  };
}

function getSettingsSnapshot() {
  return loadSettingsFromStorage();
}

function getSettingsServerSnapshot() {
  return DEFAULT_SETTINGS;
}

function notifySettingsUpdated() {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new Event(SETTINGS_UPDATED_EVENT));
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const settings = useSyncExternalStore(
    subscribeToSettings,
    getSettingsSnapshot,
    getSettingsServerSnapshot,
  );

  const updateSettings = useCallback((nextSettings: LecturerSettings) => {
    saveSettingsToStorage(nextSettings);
    notifySettingsUpdated();
  }, []);

  const patchSettings = useCallback((patch: Partial<LecturerSettings>) => {
    const nextSettings = { ...loadSettingsFromStorage(), ...patch };
    saveSettingsToStorage(nextSettings);
    notifySettingsUpdated();
  }, []);

  const resetSettings = useCallback(() => {
    saveSettingsToStorage(DEFAULT_SETTINGS);
    notifySettingsUpdated();
  }, []);

  const value = useMemo(
    () => ({
      settings,
      updateSettings,
      patchSettings,
      resetSettings,
    }),
    [settings, updateSettings, patchSettings, resetSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used inside SettingsProvider.");
  }
  return context;
}
