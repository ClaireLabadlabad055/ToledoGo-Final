import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { supabase } from "../../Services/supabase";
import { isAdminUser } from "../../Services/adminAuth";

type Order = {
  id: string;
  vendor_id: string;
  total: number;
  platform_fee?: number | null;
  status: string;
  created_at: string;
  vendor?: { business_name?: string | null } | null;
};
type Payout = {
  id: string;
  vendor_id: string;
  status: "pending" | "disbursed";
};
type VendorPayout = {
  vendorId: string;
  vendorName: string;
  gross: number;
  platformFees: number;
  net: number;
  payout?: Payout;
};

const startOfWeek = () => {
  const date = new Date();
  const day = date.getDay();
  const offset = day === 0 ? 6 : day - 1;
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - offset);
  return date;
};

export default function AdminLedgerScreen() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const periodStart = startOfWeek();
  const periodEnd = new Date();
  const periodStartIso = periodStart.toISOString();
  const periodEndIso = periodEnd.toISOString();
  const periodStartDate = periodStartIso.slice(0, 10);
  const periodEndDate = periodEndIso.slice(0, 10);

  const loadLedger = useCallback(async () => {
    try {
      setError(null);
      if (!(await isAdminUser())) {
        router.replace("/login");
        return;
      }
      const [
        { data: orderRows, error: orderError },
        { data: payoutRows, error: payoutError },
      ] = await Promise.all([
        supabase
          .from("orders")
          .select(
            "id, vendor_id, total, platform_fee, status, created_at, vendor:vendors(business_name)",
          )
          .gte("created_at", periodStartIso)
          .lte("created_at", periodEndIso)
          .order("created_at", { ascending: false }),
        supabase
          .from("vendor_payouts")
          .select("id, vendor_id, status")
          .eq("period_start", periodStartDate)
          .eq("period_end", periodEndDate),
      ]);
      if (orderError) throw orderError;
      if (payoutError) throw payoutError;
      setOrders((orderRows ?? []) as Order[]);
      setPayouts((payoutRows ?? []) as Payout[]);
    } catch (loadError: any) {
      setError(
        loadError.message ??
          "Unable to load the financial ledger. Run admin-ledger-moderation.sql first.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [periodEndDate, periodEndIso, periodStartDate, periodStartIso, router]);

  useFocusEffect(
    useCallback(() => {
      loadLedger();
    }, [loadLedger]),
  );

  const vendorPayouts = useMemo<VendorPayout[]>(() => {
    const grouped = new Map<string, VendorPayout>();
    orders.forEach((order) => {
      const entry = grouped.get(order.vendor_id) ?? {
        vendorId: order.vendor_id,
        vendorName:
          order.vendor?.business_name ||
          `Vendor ${order.vendor_id.slice(0, 6)}`,
        gross: 0,
        platformFees: 0,
        net: 0,
      };
      if (order.status === "completed") {
        entry.gross += Number(order.total ?? 0);
        entry.platformFees += Number(order.platform_fee ?? 0);
      }
      grouped.set(order.vendor_id, entry);
    });
    return Array.from(grouped.values()).map((entry) => ({
      ...entry,
      net: Math.max(entry.gross - entry.platformFees, 0),
      payout: payouts.find((payout) => payout.vendor_id === entry.vendorId),
    }));
  }, [orders, payouts]);

  const gmv = orders
    .filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + Number(order.total ?? 0), 0);
  const todayKey = new Date().toISOString().slice(0, 10);
  const dailyGmv = orders
    .filter(
      (order) =>
        order.status !== "cancelled" &&
        order.created_at.slice(0, 10) === todayKey,
    )
    .reduce((sum, order) => sum + Number(order.total ?? 0), 0);

  const ensurePayout = async (entry: VendorPayout) => {
    const { data, error: upsertError } = await supabase.rpc(
      "ensure_vendor_payout",
      {
        target_vendor_id: entry.vendorId,
        target_period_start: periodStartDate,
        target_period_end: periodEndDate,
      },
    );
    if (upsertError) {
      Alert.alert("Could not create payout", upsertError.message);
      return null;
    }
    return (Array.isArray(data) ? data[0] : data) as Payout;
  };

  const disburse = async (entry: VendorPayout) => {
    const payout = entry.payout ?? (await ensurePayout(entry));
    if (!payout) return;
    Alert.alert(
      "Mark payout disbursed?",
      `Confirm PHP ${entry.net.toFixed(2)} was paid to ${entry.vendorName}.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark disbursed",
          onPress: async () => {
            const { error: disburseError } = await supabase.rpc(
              "disburse_vendor_payout",
              { payout_id: payout.id },
            );
            if (disburseError) {
              Alert.alert("Could not disburse payout", disburseError.message);
              return;
            }
            setPayouts((current) => [
              ...current.filter((item) => item.id !== payout.id),
              { ...payout, status: "disbursed" },
            ]);
            Alert.alert(
              "Payout recorded",
              `${entry.vendorName} is marked as paid for this period.`,
            );
          },
        },
      ],
    );
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
            <Text style={styles.title}>Financial ledger</Text>
            <Text style={styles.subtitle}>
              Weekly GMV, vendor earnings, and payout offsets.
            </Text>
          </View>
          <MaterialCommunityIcons
            name="chart-box-outline"
            size={28}
            color="#FFF7ED"
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadLedger();
              }}
              tintColor="#C2410C"
            />
          }
        >
          <View style={styles.metricGrid}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>TODAY&apos;S GMV</Text>
              <Text style={styles.metricValue}>PHP {dailyGmv.toFixed(2)}</Text>
            </View>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>WEEKLY GMV</Text>
              <Text style={styles.metricValue}>PHP {gmv.toFixed(2)}</Text>
            </View>
          </View>
          <View style={styles.period}>
            <Feather name="calendar" size={15} color="#9A3412" />
            <Text style={styles.periodText}>
              Period: {periodStartDate} to {periodEndDate}
            </Text>
          </View>
          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={loadLedger}>
                <Text style={styles.retry}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {loading ? (
            <ActivityIndicator color="#C2410C" style={styles.loader} />
          ) : null}
          <Text style={styles.sectionTitle}>Vendor payout list</Text>
          {!loading && !error && vendorPayouts.length === 0 ? (
            <View style={styles.empty}>
              <Feather name="bar-chart-2" size={35} color="#C2410C" />
              <Text style={styles.emptyTitle}>No payout activity yet</Text>
              <Text style={styles.emptyText}>
                Completed orders from this week will appear here.
              </Text>
            </View>
          ) : null}
          {vendorPayouts.map((entry) => (
            <View key={entry.vendorId} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.vendorCopy}>
                  <Text style={styles.vendorName}>{entry.vendorName}</Text>
                  <Text style={styles.vendorId}>Weekly payout calculation</Text>
                </View>
                <Text style={styles.net}>PHP {entry.net.toFixed(2)}</Text>
              </View>
              <View style={styles.breakdown}>
                <Text style={styles.breakdownText}>
                  Completed sales{" "}
                  <Text style={styles.breakdownValue}>
                    PHP {entry.gross.toFixed(2)}
                  </Text>
                </Text>
                <Text style={styles.breakdownText}>
                  ToledoGo commission{" "}
                  <Text style={styles.offset}>
                    - PHP {entry.platformFees.toFixed(2)}
                  </Text>
                </Text>
              </View>
              {entry.payout?.status === "disbursed" ? (
                <View style={styles.disbursed}>
                  <Feather name="check-circle" size={15} color="#C2410C" />
                  <Text style={styles.disbursedText}>Disbursed</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.disburseButton}
                  onPress={() => disburse(entry)}
                >
                  <Feather name="send" size={15} color="#FFFFFF" />
                  <Text style={styles.disburseText}>Mark payout disbursed</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
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
  metricGrid: { flexDirection: "row", gap: 10 },
  metric: {
    flex: 1,
    padding: 16,
    borderRadius: 17,
    backgroundColor: "#C2410C",
  },
  metricLabel: {
    color: "#FED7AA",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  metricValue: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "900",
    marginTop: 5,
  },
  period: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingVertical: 14,
  },
  periodText: { color: "#9A3412", fontSize: 11, fontWeight: "800" },
  error: { backgroundColor: "#FEF2F2", borderRadius: 11, padding: 12 },
  errorText: { color: "#B91C1C", fontSize: 12 },
  retry: { color: "#991B1B", fontWeight: "900", marginTop: 7 },
  loader: { marginVertical: 30 },
  sectionTitle: {
    color: "#7C2D12",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyTitle: {
    color: "#7C2D12",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 10,
  },
  emptyText: { color: "#9A4B2D", fontSize: 12, marginTop: 5 },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 17,
    padding: 15,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  vendorCopy: { flex: 1 },
  vendorName: { color: "#7C2D12", fontSize: 15, fontWeight: "900" },
  vendorId: { color: "#C9896D", fontSize: 10, marginTop: 3 },
  net: { color: "#C2410C", fontSize: 17, fontWeight: "900" },
  breakdown: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#FFEDD5",
    marginTop: 12,
    paddingVertical: 10,
    gap: 5,
  },
  breakdownText: { color: "#9A4B2D", fontSize: 11 },
  breakdownValue: { color: "#9A3412", fontWeight: "900" },
  offset: { color: "#B91C1C", fontWeight: "900" },
  disburseButton: {
    marginTop: 13,
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: "#C2410C",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  disburseText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  disbursed: {
    marginTop: 13,
    minHeight: 42,
    borderRadius: 11,
    backgroundColor: "#FFEDD5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  disbursedText: { color: "#C2410C", fontSize: 11, fontWeight: "900" },
});
