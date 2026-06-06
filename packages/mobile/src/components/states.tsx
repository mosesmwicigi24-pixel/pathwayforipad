// Shared async-state views: a centered spinner, an error card with retry, and an
// empty placeholder. Screens use these instead of ad-hoc inline states so every
// data-backed view behaves consistently.
import { type ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { palette, spacing } from "../theme/tokens";
import { PButton, T } from "../theme/components";

export function Loading({ label = "Loading…", dark = false }: { label?: string; dark?: boolean }): ReactNode {
  return (
    <View style={s.center}>
      <ActivityIndicator color={dark ? palette.onNavy : palette.navy} />
      <T variant="caption" tone={dark ? "onNavyDim" : "tertiary"} style={{ marginTop: spacing.sm }}>
        {label}
      </T>
    </View>
  );
}

export function ErrorState({
  message = "Something went wrong.",
  onRetry,
  dark = false,
}: {
  message?: string;
  onRetry?: () => void;
  dark?: boolean;
}): ReactNode {
  return (
    <View style={s.center}>
      <T variant="heading" tone={dark ? "onNavy" : "ink"} style={{ textAlign: "center" }}>
        Couldn’t load
      </T>
      <T variant="body" tone={dark ? "onNavyDim" : "secondary"} style={s.msg}>
        {message}
      </T>
      {onRetry ? (
        <View style={{ marginTop: spacing.base }}>
          <PButton variant={dark ? "ghostDark" : "ghost"} size="md" fullWidth={false} onPress={onRetry}>
            Try again
          </PButton>
        </View>
      ) : null}
    </View>
  );
}

export function Empty({ title, subtitle }: { title: string; subtitle?: string }): ReactNode {
  return (
    <View style={s.center}>
      <T variant="heading" tone="secondary" style={{ textAlign: "center" }}>
        {title}
      </T>
      {subtitle ? (
        <T variant="body" tone="tertiary" style={s.msg}>
          {subtitle}
        </T>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  center: { paddingVertical: spacing.xl, alignItems: "center", justifyContent: "center" },
  msg: { textAlign: "center", marginTop: spacing.xs, maxWidth: 320 },
});
