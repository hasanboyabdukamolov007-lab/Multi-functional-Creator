import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

// Show notifications that arrive while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/**
 * Ask for permission and get this device's Expo push token. Returns null on simulators, when the user
 * declines, or when the build has no EAS project id (push needs `eas init`).
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === "android") {
    // The server sends to the "default" channel.
    await Notifications.setNotificationChannelAsync("default", { name: "Default", importance: Notifications.AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

export function deviceLabel(): string {
  return [Device.manufacturer, Device.modelName].filter(Boolean).join(" ") || (Platform.OS === "ios" ? "iPhone" : "Android");
}

/** In-app path from a tapped notification, if any. */
export function linkOf(response: Notifications.NotificationResponse | null): string | null {
  const link = response?.notification.request.content.data?.link;
  return typeof link === "string" && link.startsWith("/") && !link.startsWith("//") ? link : null;
}
