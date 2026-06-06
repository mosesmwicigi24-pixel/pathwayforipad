// Giving (spec §1.10 C, §5.6). Money is online-only — the flow blocks when
// offline rather than queuing financial intent. Amounts are entered/displayed in
// minor units; card data is tokenized by Stripe Elements, never by us.
import { useState, type ReactElement } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { assertOnlineForGiving, getConnectivity } from "../net/connectivity";

const FUNDS = ["tithe", "offering", "general", "media"] as const;

export function GivingScreen(): ReactElement {
  const nav = useNavigation();
  const [fund, setFund] = useState<(typeof FUNDS)[number]>("tithe");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  async function give(): Promise<void> {
    const amountMinor = Math.round(Number(amount) * 100);
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      setStatus("Enter a valid amount.");
      return;
    }
    setStatus("Creating payment…");
    try {
      // Money is never queued offline (§5.6): hard-block before doing anything.
      await assertOnlineForGiving(getConnectivity());
      await NuruApi.giving({ fund, amount_minor: amountMinor, currency: "KES", idempotency_key: uuidv4() });
      setStatus("Payment started — confirm in the card sheet.");
    } catch {
      setStatus("Could not start payment — giving requires a connection (never queued offline).");
    }
  }

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Pressable accessibilityRole="button" onPress={() => nav.goBack()}>
        <Text style={{ color: "#2563eb" }}>‹ Back</Text>
      </Pressable>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>Give</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {FUNDS.map((f) => (
          <Pressable
            key={f}
            accessibilityRole="button"
            onPress={() => setFund(f)}
            style={{ padding: 8, borderRadius: 6, backgroundColor: fund === f ? "#2563eb" : "#e5e7eb" }}
          >
            <Text style={{ color: fund === f ? "white" : "#111827" }}>{f}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        keyboardType="decimal-pad"
        placeholder="Amount (KES)"
        value={amount}
        onChangeText={setAmount}
        style={{ borderWidth: 1, borderColor: "#d1d5db", borderRadius: 8, padding: 12 }}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => void give()}
        style={{ padding: 14, borderRadius: 8, backgroundColor: "#16a34a" }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>Give now</Text>
      </Pressable>
      {status ? <Text style={{ color: "#374151" }}>{status}</Text> : null}
    </View>
  );
}
