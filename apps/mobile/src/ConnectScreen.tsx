import { useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { checkServer, normaliseServer, setServer } from "./server";
import { t } from "./i18n";
import type { Palette } from "./theme";
import { makeStyles } from "./theme";

export function ConnectScreen({ colors, initial, onConnected }: { colors: Palette; initial?: string | null; onConnected: (origin: string) => void }) {
  const s = makeStyles(colors);
  const [value, setValue] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  const done = async (origin: string) => {
    await setServer(origin);
    onConnected(origin);
  };

  const submit = async () => {
    setError(null);
    setFallback(null);
    const n = normaliseServer(value);
    if ("error" in n) {
      setError(n.error === "insecure" ? t("insecure") : t("unreachable"));
      return;
    }
    setBusy(true);
    const r = await checkServer(n.origin);
    setBusy(false);
    if (r.ok) return done(n.origin);
    setError(t(r.reason));
    setFallback(n.origin);
  };

  return (
    <KeyboardAvoidingView style={s.center} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.card}>
        <View style={s.brand}>
          <Image source={require("../assets/logo.png")} style={s.logo} accessibilityIgnoresInvertColors />
          <Text style={s.brandText}>Multi-functional Creator</Text>
        </View>
        <Text style={s.title} accessibilityRole="header">{t("title")}</Text>
        <Text style={s.muted}>{t("subtitle")}</Text>
        <Text style={s.label} nativeID="server-label">{t("label")}</Text>
        <TextInput
          style={s.input}
          value={value}
          onChangeText={setValue}
          placeholder="panel.example.com"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          textContentType="URL"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          accessibilityLabelledBy="server-label"
          editable={!busy}
        />
        {error && <Text style={s.error} accessibilityLiveRegion="polite">{error}</Text>}
        <Pressable style={[s.button, busy && { opacity: 0.7 }]} onPress={() => void submit()} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.buttonText}>{t("connect")}</Text>}
        </Pressable>
        {fallback && (
          <Pressable style={s.ghost} onPress={() => void done(fallback)} accessibilityRole="button">
            <Text style={s.ghostText}>{t("anyway")}</Text>
          </Pressable>
        )}
        <Text style={s.hint}>{t("hint")}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}
