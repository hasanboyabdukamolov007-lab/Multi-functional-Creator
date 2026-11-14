import { useCallback, useEffect, useRef, useState, type ForwardRefExoticComponent, type RefAttributes } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Pressable, Text, ToastAndroid, View } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation, type WebViewProps } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { deviceLabel, getPushToken, linkOf } from "./push";
import { getLock, sameOrigin, setLock } from "./server";
import { t } from "./i18n";
import type { Palette } from "./theme";
import { makeStyles } from "./theme";

type FromWeb =
  | { type: "ready" }
  | { type: "session"; signedIn: boolean }
  | { type: "save"; name: string; mime: string; base64: string }
  | { type: "change-server" }
  | { type: "lock"; enabled: boolean };

// react-native-webview types its class as Component<WebViewProps & undefined>, which TypeScript 6 reduces to never.
const Web = WebView as unknown as ForwardRefExoticComponent<WebViewProps & RefAttributes<WebView>>;

const INJECT = `window.__MFC_MOBILE__ = { platform: ${JSON.stringify(Platform.OS)} }; true;`;

/** The panel itself, in a WebView that shares nothing with other sites. */
export function PanelScreen({ colors, origin, initialLink, onChangeServer }: { colors: Palette; origin: string; initialLink: string | null; onChangeServer: () => void }) {
  const s = makeStyles(colors);
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const canGoBack = useRef(false);
  const token = useRef<string | null>(null);
  const pendingLink = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);

  const send = useCallback((msg: Record<string, unknown>) => {
    web.current?.injectJavaScript(`window.__mfcNative && window.__mfcNative(${JSON.stringify(msg)}); true;`);
  }, []);

  const open = useCallback(
    (link: string) => {
      if (ready.current) send({ type: "open", link });
      else pendingLink.current = link;
    },
    [send],
  );

  // Tapping a notification while the app runs opens its page in the panel.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const link = linkOf(r);
      if (link) open(link);
    });
    return () => sub.remove();
  }, [open]);

  // Android back button walks back through the panel's history.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const saveFile = async (m: Extract<FromWeb, { type: "save" }>) => {
    try {
      const name = m.name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "download";
      const file = new File(Paths.cache, name);
      if (file.exists) file.delete();
      file.create();
      await file.write(m.base64, { encoding: "base64" });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri, { mimeType: m.mime, dialogTitle: name });
      else if (Platform.OS === "android") ToastAndroid.show(t("saved", { name }), ToastAndroid.SHORT);
    } catch {
      if (Platform.OS === "android") ToastAndroid.show(t("saveFailed"), ToastAndroid.SHORT);
    }
  };

  const onMessage = async (e: WebViewMessageEvent) => {
    let m: FromWeb;
    try {
      m = JSON.parse(e.nativeEvent.data) as FromWeb;
    } catch {
      return;
    }
    switch (m.type) {
      case "ready":
        ready.current = true;
        send({ type: "shell-info", platform: Platform.OS, lock: await getLock() });
        if (token.current) send({ type: "push-token", token: token.current, label: deviceLabel() });
        if (pendingLink.current) {
          send({ type: "open", link: pendingLink.current });
          pendingLink.current = null;
        }
        break;
      case "session":
        // Ask for notification permission only once someone has signed in.
        if (m.signedIn && !token.current) {
          token.current = await getPushToken();
          if (token.current) send({ type: "push-token", token: token.current, label: deviceLabel() });
        }
        break;
      case "save":
        await saveFile(m);
        break;
      case "change-server":
        onChangeServer();
        break;
      case "lock":
        await setLock(m.enabled);
        send({ type: "shell-info", platform: Platform.OS, lock: m.enabled });
        break;
    }
  };

  if (failed) {
    return (
      <View style={[s.center, { gap: 12 }]}>
        <Text style={s.title}>{t("offline")}</Text>
        <Text style={[s.muted, { textAlign: "center" }]}>{t("offlineBody")}</Text>
        <Text style={s.hint}>{origin}</Text>
        <Pressable style={s.button} onPress={() => (setFailed(false), setKey((k) => k + 1))} accessibilityRole="button">
          <Text style={s.buttonText}>{t("retry")}</Text>
        </Pressable>
        <Pressable style={s.ghost} onPress={onChangeServer} accessibilityRole="button">
          <Text style={s.ghostText}>{t("changeServer")}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Web
      key={key}
      ref={web}
      style={{ flex: 1, backgroundColor: colors.bg }}
      source={{ uri: initialLink ? `${origin}${initialLink}` : origin }}
      injectedJavaScriptBeforeContentLoaded={INJECT}
      onMessage={(e: WebViewMessageEvent) => void onMessage(e)}
      applicationNameForUserAgent="MFCMobile/1.0"
      sharedCookiesEnabled
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      setSupportMultipleWindows={false}
      startInLoadingState
      renderLoading={() => (
        <View style={[s.center, { position: "absolute", inset: 0, backgroundColor: colors.bg }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
      onNavigationStateChange={(n: WebViewNavigation) => (canGoBack.current = n.canGoBack)}
      onShouldStartLoadWithRequest={(req: ShouldStartLoadRequest) => {
        const url = req.url;
        if (/^(about|blob|data):/.test(url) || sameOrigin(url, origin)) return true;
        // Frames (embeds, the plugin sandbox) load in place; other pages open in the system browser.
        if (req.isTopFrame === false) return true;
        if (/^(https?|mailto|tel):/.test(url)) void Linking.openURL(url);
        return false;
      }}
      onError={() => setFailed(true)}
      onRenderProcessGone={() => setKey((k) => k + 1)}
      onContentProcessDidTerminate={() => web.current?.reload()}
      onLoadStart={() => (ready.current = false)}
    />
  );
}
