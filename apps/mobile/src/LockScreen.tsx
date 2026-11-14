import { useCallback, useEffect } from "react";
import { Image, Pressable, Text, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { t } from "./i18n";
import type { Palette } from "./theme";
import { makeStyles } from "./theme";

/** Face ID / fingerprint / device passcode before the panel shows. */
export function LockScreen({ colors, onUnlocked }: { colors: Palette; onUnlocked: () => void }) {
  const s = makeStyles(colors);
  const unlock = useCallback(async () => {
    const usable = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    // Without biometrics or a passcode there's nothing to check against.
    if (!usable) return onUnlocked();
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t("unlockReason") });
    if (r.success) onUnlocked();
  }, [onUnlocked]);
  useEffect(() => {
    void unlock();
  }, [unlock]);
  return (
    <View style={[s.center, { gap: 16 }]}>
      <Image source={require("../assets/logo.png")} style={{ width: 72, height: 72, borderRadius: 18 }} accessibilityIgnoresInvertColors />
      <Text style={s.title}>{t("locked")}</Text>
      <Pressable style={s.button} onPress={() => void unlock()} accessibilityRole="button">
        <Text style={s.buttonText}>{t("unlock")}</Text>
      </Pressable>
    </View>
  );
}
