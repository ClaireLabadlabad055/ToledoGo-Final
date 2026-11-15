import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { supabase } from "../../Services/supabase";
import { isAdminUser } from "../../Services/adminAuth";
import { vendorSubscriptionPlans } from "../../constants/vendor-subscriptions";

type PlanFormState = {
  free: string;
  pro: string;
};

export default function AdminMonetizationScreen() {
  const router = useRouter();
  const [plans, setPlans] = useState<PlanFormState>({
    free: String(vendorSubscriptionPlans.free.monthlyPrice),
    pro: String(vendorSubscriptionPlans.pro.monthlyPrice),
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      if (!(await isAdminUser())) {
        router.replace("/login");
        return;
      }
      const { data, error: settingsError } = await supabase
        .from("vendor_subscription_plans")
        .select("id, monthly_price")
        .order("id");

      if (settingsError) throw settingsError;

      const nextPlans = { free: String(vendorSubscriptionPlans.free.monthlyPrice), pro: String(vendorSubscriptionPlans.pro.monthlyPrice) };
      for (const plan of data ?? []) {
        if (plan.id === "free") nextPlans.free = String(Number(plan.monthly_price ?? 0));
        if (plan.id === "pro") nextPlans.pro = String(Number(plan.monthly_price ?? 199));
      }
      setPlans(nextPlans);
    } catch (loadError: any) {
      setError(loadError.message ?? "Run vendor-subscriptions.sql in Supabase first.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      loadSettings();
    }, [loadSettings]),
  );

  const savePlans = async () => {
    const parsedFree = Number(plans.free);
    const parsedPro = Number(plans.pro);

    if (!Number.isFinite(parsedFree) || parsedFree < 0 || !Number.isFinite(parsedPro) || parsedPro < 0) {
      Alert.alert("Invalid pricing", "Monthly fees must be zero or a positive value.");
      return;
    }

    setSaving(true);
    try {
      const updates = [
        {
          id: "free",
          display_name: "Free / Basic",
          monthly_price: parsedFree,
          max_menu_items: 5,
          allows_quick_pos: false,
          priority_listing: false,
          batch_capacity_limit: 1,
          is_active: true,
        },
        {
          id: "pro",
          display_name: "Pro / Storefront",
          monthly_price: parsedPro,
          max_menu_items: 999,
          allows_quick_pos: true,
          priority_listing: true,
          batch_capacity_limit: 8,
          is_active: true,
        },
      ];

      const { error: saveError } = await supabase.from("vendor_subscription_plans").upsert(updates, { onConflict: "id" });
      if (saveError) throw saveError;

      Alert.alert(
        "Subscription plans updated",
        `Free tier: PHP ${parsedFree.toFixed(2)}/month\nPro tier: PHP ${parsedPro.toFixed(2)}/month`,
      );
    } catch (saveError: any) {
      Alert.alert("Could not update plan pricing", saveError.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#7C2D12" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.replace("/admin/dashboard")}
          >
            <Feather name="arrow-left" size={20} color="#9A3412" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ADMIN FINANCE</Text>
            <Text style={styles.title}>Monetization</Text>
            <Text style={styles.subtitle}>
              Control platform fees and protect vendor payouts.
            </Text>
          </View>
          <Feather name="percent" size={28} color="#FFF7ED" />
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator color="#C2410C" style={styles.loader} />
          ) : (
            <>
              <View style={styles.card}>
                <View style={styles.cardHeading}>
                  <View style={styles.icon}>
                    <Feather name="credit-card" size={18} color="#C2410C" />
                  </View>
                  <View style={styles.copy}>
                    <Text style={styles.cardTitle}>
                      Vendor subscription tiers
                    </Text>
                    <Text style={styles.cardText}>
                      Keep the platform flexible: a free Basic tier for micro vendors and a paid Pro tier for storefront growth.
                    </Text>
                  </View>
                </View>

                <View style={styles.tierCard}>
                  <Text style={styles.tierLabel}>FREE / BASIC</Text>
                  <Text style={styles.tierDescription}>Up to 5 menu items and 1 active meetup schedule.</Text>
                  <View style={styles.rateRow}>
                    <Text style={styles.currency}>PHP</Text>
                    <TextInput
                      style={styles.rateInput}
                      value={plans.free}
                      onChangeText={(value) => setPlans((current) => ({ ...current, free: value }))}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.percent}>/month</Text>
                  </View>
                </View>

                <View style={styles.tierCard}>
                  <Text style={styles.tierLabel}>PRO / STOREFRONT</Text>
                  <Text style={styles.tierDescription}>Quick POS, unlimited product listings, up to eight active meetup schedules, and priority visibility.</Text>
                  <View style={styles.rateRow}>
                    <Text style={styles.currency}>PHP</Text>
                    <TextInput
                      style={styles.rateInput}
                      value={plans.pro}
                      onChangeText={(value) => setPlans((current) => ({ ...current, pro: value }))}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.percent}>/month</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.saveButton}
                  onPress={savePlans}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Feather name="save" size={16} color="#FFFFFF" />
                      <Text style={styles.saveText}>Save subscription pricing</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              <View style={styles.infoCard}>
                <Feather name="shield" size={18} color="#C2410C" />
                <View style={styles.copy}>
                  <Text style={styles.infoTitle}>Why this works</Text>
                  <Text style={styles.infoText}>
                    Free plans help micro vendors validate demand, while Pro unlocks the operational tools and marketplace visibility needed to scale into a storefront business.
                  </Text>
                </View>
              </View>
              <View style={styles.infoCard}>
                <Feather name="bar-chart-2" size={18} color="#C2410C" />
                <View style={styles.copy}>
                  <Text style={styles.infoTitle}>Recommended launch pricing</Text>
                  <Text style={styles.infoText}>
                    Keep Basic free and position Pro as the value tier with Quick POS, unlimited listings, more active meetup schedules, and priority placement.
                  </Text>
                </View>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFF9F2" },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#7C2D12",
  },
  backButton: { backgroundColor: "#FFEDD5", padding: 8, borderRadius: 14 },
  headerCopy: { flex: 1 },
  eyebrow: {
    color: "#FED7AA",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  title: { color: "#FFFFFF", fontSize: 24, fontWeight: "900", marginTop: 3 },
  subtitle: {
    color: "rgba(240,253,244,0.8)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  content: { padding: 16, paddingBottom: 35 },
  loader: { marginVertical: 35 },
  error: {
    backgroundColor: "#FEF2F2",
    borderRadius: 12,
    padding: 13,
    marginBottom: 12,
  },
  errorText: { color: "#B91C1C", fontSize: 12 },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 18,
    padding: 17,
  },
  cardHeading: { flexDirection: "row", gap: 11, alignItems: "flex-start" },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: "#FFEDD5",
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1 },
  cardTitle: { color: "#7C2D12", fontSize: 16, fontWeight: "900" },
  cardText: { color: "#9A4B2D", fontSize: 12, lineHeight: 18, marginTop: 5 },
  fieldLabel: {
    color: "#C9896D",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
    marginTop: 22,
    marginBottom: 6,
  },
  rateRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#FED7AA",
  },
  rateInput: {
    flex: 1,
    color: "#7C2D12",
    fontSize: 30,
    fontWeight: "900",
    paddingVertical: 5,
  },
  percent: {
    color: "#C2410C",
    fontSize: 14,
    fontWeight: "800",
    paddingBottom: 2,
  },
  currency: {
    color: "#7C2D12",
    fontSize: 16,
    fontWeight: "900",
    marginRight: 6,
  },
  hint: { color: "#64748B", fontSize: 11, lineHeight: 17, marginTop: 9 },
  tierCard: {
    backgroundColor: "#FFF7ED",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FED7AA",
    padding: 14,
    marginTop: 14,
  },
  tierLabel: {
    color: "#7C2D12",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
  },
  tierDescription: {
    color: "#78716C",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    marginBottom: 10,
  },
  saveButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#C2410C",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginTop: 18,
  },
  saveText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
  infoCard: {
    flexDirection: "row",
    gap: 10,
    padding: 15,
    marginTop: 12,
    borderRadius: 15,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  infoTitle: { color: "#9A3412", fontSize: 12, fontWeight: "900" },
  infoText: { color: "#9A4B2D", fontSize: 11, lineHeight: 17, marginTop: 4 },
});
