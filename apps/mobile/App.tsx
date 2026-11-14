import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { ConnectScreen } from "./src/ConnectScreen";
import { LockScreen } from "./src/LockScreen";
import { PanelScreen } from "./src/PanelScreen";
import { getLock, getServer } from "./src/server";
import { linkOf } from "./src/push";
import { colors } from "./src/theme";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Lock again after the app has been in the background this long. */
const RELOCK_MS = 60_000;

type Phase = { name: "loading" } | { name: "connect"; initial?: string | null } | { name: "panel"; origin: string };

export default function App() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [locked, setLocked] = useState(false);
  const [initialLink, setInitialLink] = useState<string | null>(null);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const [server, lock, last] = await Promise.all([getServer(), getLock(), Notifications.getLastNotificationResponseAsync().catch(() => null)]);
      // Opened by tapping a notification: go straight to its page.
      setInitialLink(linkOf(last));
      setLocked(lock);
      setPhase(server ? { name: "panel", origin: server } : { name: "connect" });
      await SplashScreen.hideAsync().catch(() => undefined);
    })();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") backgroundAt.current = Date.now();
      if (state === "active" && backgroundAt.current && Date.now() - backgroundAt.current > RELOCK_MS) {
        void getLock().then((on) => on && setLocked(true));
      }
      if (state === "active") backgroundAt.current = null;
    });
    return () => sub.remove();
  }, []);

  const changeServer = useCallback(() => setPhase((p) => ({ name: "connect", initial: p.name === "panel" ? p.origin : null })), []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.bg }} edges={["top", "bottom", "left", "right"]}>
        <StatusBar style={scheme === "dark" ? "light" : "dark"} />
        {phase.name === "connect" && <ConnectScreen colors={palette} initial={phase.initial} onConnected={(origin) => setPhase({ name: "panel", origin })} />}
        {phase.name === "panel" && (locked ? <LockScreen colors={palette} onUnlocked={() => setLocked(false)} /> : <PanelScreen colors={palette} origin={phase.origin} initialLink={initialLink} onChangeServer={changeServer} />)}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
