import { StyleSheet } from "react-native";

export const colors = {
  light: { bg: "#f6f7fb", card: "#ffffff", text: "#15161c", muted: "#5d6170", border: "#dfe2ea", accent: "#6d5efc", danger: "#c43c3c" },
  dark: { bg: "#0d0e13", card: "#171922", text: "#eceef4", muted: "#9aa0b2", border: "#2a2d3a", accent: "#8579ff", danger: "#ff7676" },
};
export type Palette = (typeof colors)["light"];

export const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
    card: { width: "100%", maxWidth: 460, backgroundColor: c.card, borderColor: c.border, borderWidth: 1, borderRadius: 16, padding: 24, gap: 12 },
    brand: { flexDirection: "row", alignItems: "center", gap: 10 },
    logo: { width: 36, height: 36, borderRadius: 9 },
    brandText: { color: c.text, fontWeight: "700", fontSize: 16 },
    title: { color: c.text, fontSize: 22, fontWeight: "700" },
    muted: { color: c.muted, fontSize: 14, lineHeight: 20 },
    label: { color: c.muted, fontSize: 13 },
    input: { height: 48, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, color: c.text, fontSize: 16 },
    error: { color: c.danger, fontSize: 13 },
    button: { height: 48, borderRadius: 10, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    buttonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
    ghost: { height: 44, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
    ghostText: { color: c.text, fontWeight: "600", fontSize: 15 },
    hint: { color: c.muted, fontSize: 12 },
  });
