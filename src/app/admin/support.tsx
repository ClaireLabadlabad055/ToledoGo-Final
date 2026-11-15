import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../Services/supabase';
import { isAdminUser } from '../../Services/adminAuth';

type RefundStatus = 'awaiting_vendor_confirmation' | 'awaiting_customer_details' | 'pending_vendor' | 'settled' | string;
type RefundCase = {
  id: string;
  customer_name: string | null;
  vendor_id: string;
  total: number;
  refund_amount: number;
  refund_status: RefundStatus;
  refund_due_at: string | null;
  refund_settled_at: string | null;
  refund_transfer_reference: string | null;
  refund_disputed_at: string | null;
  refund_dispute_reason: string | null;
  refund_dispute_reviewed_at: string | null;
  created_at: string;
  vendor?: { business_name?: string | null; is_open?: boolean | null } | null;
};
type CaseFilter = 'all' | 'attention' | 'completed';

const outstandingStatuses = ['awaiting_vendor_confirmation', 'awaiting_customer_details', 'pending_vendor'];

function getRefundState(item: RefundCase, now: number) {
  const dueAt = item.refund_due_at ? new Date(item.refund_due_at).getTime() : null;
  const settledAt = item.refund_settled_at ? new Date(item.refund_settled_at).getTime() : null;
  const settled = item.refund_status === 'settled';
  const paidLate = settled && dueAt !== null && settledAt !== null && settledAt > dueAt;
  const paidOnTime = settled && dueAt !== null && settledAt !== null && settledAt <= dueAt;
  const overdue = !settled && dueAt !== null && dueAt <= now && outstandingStatuses.includes(item.refund_status);
  const disputed = Boolean(item.refund_disputed_at && !item.refund_dispute_reviewed_at);
  return { dueAt, settledAt, settled, paidLate, paidOnTime, overdue, disputed, needsAttention: overdue || paidLate || disputed };
}

function getStatusLabel(item: RefundCase, state: ReturnType<typeof getRefundState>) {
  if (state.disputed) return 'Customer reported an issue';
  if (state.paidLate) return 'Recorded as paid late';
  if (state.paidOnTime) return 'Recorded as paid on time';
  if (state.settled) return 'Marked sent · timing unavailable';
  if (state.overdue) return 'Refund deadline missed';
  if (item.refund_status === 'awaiting_vendor_confirmation') return 'Awaiting vendor confirmation';
  if (item.refund_status === 'awaiting_customer_details') return 'Awaiting customer wallet details';
  if (item.refund_status === 'pending_vendor') return 'Vendor refund in progress';
  return item.refund_status.replaceAll('_', ' ');
}

export default function AdminSupportScreen() {
  const router = useRouter();
  const [cases, setCases] = useState<RefundCase[]>([]);
  const [filter, setFilter] = useState<CaseFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const loadCases = useCallback(async () => {
    try {
      setError(null);
      if (!(await isAdminUser())) {
        router.replace('/login');
        return;
      }

      const { data, error: queryError } = await supabase
        .from('orders')
        .select('id, customer_name, vendor_id, total, refund_amount, refund_status, refund_due_at, refund_settled_at, refund_transfer_reference, refund_disputed_at, refund_dispute_reason, refund_dispute_reviewed_at, created_at, vendor:vendors(business_name, is_open)')
        .eq('status', 'cancelled')
        .in('refund_status', ['awaiting_vendor_confirmation', 'awaiting_customer_details', 'pending_vendor', 'settled'])
        .order('refund_due_at', { ascending: true, nullsFirst: false });
      if (queryError) throw queryError;
      setCases((data ?? []) as RefundCase[]);
      setCurrentTime(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load refund monitoring cases.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(useCallback(() => {
    void loadCases();
  }, [loadCases]));

  const counts = useMemo(() => cases.reduce((result, item) => {
    const state = getRefundState(item, currentTime);
    if (state.needsAttention || outstandingStatuses.includes(item.refund_status)) result.attention += 1;
    if (state.settled && !state.needsAttention) result.completed += 1;
    result.total += 1;
    return result;
  }, { attention: 0, completed: 0, total: 0 }), [cases, currentTime]);

  const visibleCases = cases.filter((item) => {
    const state = getRefundState(item, currentTime);
    if (filter === 'attention') return state.needsAttention || outstandingStatuses.includes(item.refund_status);
    if (filter === 'completed') return state.settled && !state.needsAttention;
    return true;
  });

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#7C2D12" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/admin/dashboard')} accessibilityLabel="Back to admin dashboard">
            <Feather name="arrow-left" size={20} color="#C2410C" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ADMIN OPERATIONS</Text>
            <Text style={styles.title}>Refund monitoring</Text>
            <Text style={styles.subtitle}>Track vendor refund deadlines and reported outcomes.</Text>
          </View>
          <Feather name="rotate-ccw" size={25} color="#FFF7ED" />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadCases();
              }}
              tintColor="#C2410C"
            />
          }
        >
          <View style={styles.summaryRow}>
            <View style={[styles.summaryCard, styles.attentionCard]}>
              <Text style={styles.summaryNumber}>{counts.attention}</Text>
              <Text style={styles.summaryLabel}>Needs attention</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryNumber, styles.completedNumber]}>{counts.completed}</Text>
              <Text style={styles.summaryLabel}>Recorded completed</Text>
            </View>
          </View>

          <View style={styles.notice}>
            <Feather name="info" size={16} color="#9A3412" />
            <Text style={styles.noticeText}>
              Overdue refunds, late-reported payments, and customer reports are flagged for admin follow-up. Open the vendor record to review or manually pause the storefront. ToledoGo does not independently verify external wallet transfers.
            </Text>
          </View>

          <View style={styles.filters}>
            {([
              ['all', `All (${counts.total})`],
              ['attention', `Needs attention (${counts.attention})`],
              ['completed', `Completed (${counts.completed})`],
            ] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.filterButton, filter === key && styles.filterButtonActive]}
                onPress={() => setFilter(key)}
              >
                <Text style={[styles.filterText, filter === key && styles.filterTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => void loadCases()}>
                <Text style={styles.retry}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {loading ? <ActivityIndicator color="#C2410C" style={styles.loader} /> : null}
          {!loading && !error && visibleCases.length === 0 ? (
            <View style={styles.empty}>
              <Feather name={filter === 'completed' ? 'check-circle' : 'shield'} size={42} color="#15803D" />
              <Text style={styles.emptyTitle}>{filter === 'completed' ? 'No completed refunds in this list' : 'No refunds need monitoring'}</Text>
              <Text style={styles.emptyText}>Cancelled paid orders with vendor-managed refunds will appear here.</Text>
            </View>
          ) : null}

          {visibleCases.map((item) => {
            const state = getRefundState(item, currentTime);
            const urgent = state.needsAttention || state.overdue;
            return (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={[styles.caseBadge, urgent ? styles.alertBadge : styles.normalBadge]}>
                    <Text style={[styles.caseBadgeText, urgent ? styles.alertText : styles.normalText]}>
                      {getStatusLabel(item, state)}
                    </Text>
                  </View>
                  <Text style={styles.amount}>PHP {Number(item.refund_amount ?? 0).toFixed(2)}</Text>
                </View>
                <Text style={styles.customer}>
                  {item.customer_name || 'Customer'}
                  <Text style={styles.muted}> · {item.vendor?.business_name || 'Unknown vendor'}</Text>
                </Text>
                <Text style={styles.orderId}>Order {item.id.slice(0, 8).toUpperCase()}</Text>

                <View style={styles.details}>
                  {item.refund_due_at ? (
                    <Text style={styles.detailLine}>
                      Deadline: <Text style={state.overdue || state.paidLate ? styles.alertText : styles.detailStrong}>{new Date(item.refund_due_at).toLocaleString()}</Text>
                    </Text>
                  ) : null}
                  {item.refund_settled_at ? (
                    <Text style={styles.detailLine}>Vendor marked sent: <Text style={styles.detailStrong}>{new Date(item.refund_settled_at).toLocaleString()}</Text></Text>
                  ) : null}
                  {item.refund_transfer_reference ? (
                    <Text style={styles.detailLine}>Transfer reference: <Text style={styles.detailStrong}>{item.refund_transfer_reference}</Text></Text>
                  ) : null}
                  {state.disputed && item.refund_dispute_reason ? (
                    <Text style={styles.disputeText}>Customer report: {item.refund_dispute_reason}</Text>
                  ) : null}
                  {state.overdue && state.dueAt !== null ? (
                    <Text style={styles.overdueBy}>Deadline passed {Math.max(1, Math.floor((currentTime - state.dueAt) / 86400000))} day(s) ago.</Text>
                  ) : null}
                </View>

                <TouchableOpacity
                  style={styles.vendorButton}
                  onPress={() => router.push({ pathname: '/admin/vendor-details', params: { id: item.vendor_id } })}
                >
                  <Text style={styles.vendorButtonText}>{item.vendor?.is_open === false ? 'Review vendor · storefront paused' : 'Review vendor / manage storefront'}</Text>
                  <Feather name="arrow-up-right" size={15} color="#9A3412" />
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF9F2' },
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 22, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#7C2D12' },
  backButton: { backgroundColor: '#FFEDD5', padding: 8, borderRadius: 14 },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', marginTop: 3 },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '700', marginTop: 3 },
  content: { padding: 15, paddingBottom: 35 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  summaryCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, padding: 13, borderWidth: 1, borderColor: '#F3E8DC' },
  attentionCard: { backgroundColor: '#FFF7ED' },
  summaryNumber: { color: '#B91C1C', fontSize: 22, fontWeight: '900' },
  completedNumber: { color: '#15803D' },
  summaryLabel: { color: '#78716C', fontSize: 10, fontWeight: '800', marginTop: 3 },
  notice: { flexDirection: 'row', gap: 9, padding: 12, backgroundColor: '#FFF7ED', borderRadius: 12, marginBottom: 14 },
  noticeText: { flex: 1, color: '#7C2D12', fontSize: 11, lineHeight: 16, fontWeight: '600' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 13 },
  filterButton: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7D8C9' },
  filterButtonActive: { backgroundColor: '#7C2D12', borderColor: '#7C2D12' },
  filterText: { color: '#78716C', fontSize: 10, fontWeight: '800' },
  filterTextActive: { color: '#FFFFFF' },
  loader: { marginVertical: 30 },
  errorBox: { backgroundColor: '#FEF2F2', padding: 12, borderRadius: 12 },
  errorText: { color: '#B91C1C', fontSize: 12 },
  retry: { color: '#991B1B', fontWeight: '900', marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 55, paddingHorizontal: 20 },
  emptyTitle: { color: '#292524', fontSize: 17, fontWeight: '900', marginTop: 12 },
  emptyText: { color: '#78716C', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 5 },
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3E8DC', borderRadius: 17, padding: 15, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  caseBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, flexShrink: 1 },
  alertBadge: { backgroundColor: '#FEF2F2' },
  normalBadge: { backgroundColor: '#ECFDF5' },
  caseBadgeText: { fontSize: 9, fontWeight: '900' },
  alertText: { color: '#B91C1C', fontWeight: '900' },
  normalText: { color: '#15803D' },
  amount: { color: '#292524', fontSize: 15, fontWeight: '900' },
  customer: { color: '#292524', fontSize: 14, fontWeight: '900', marginTop: 12 },
  muted: { color: '#78716C', fontWeight: '600' },
  orderId: { color: '#C2410C', fontSize: 10, fontWeight: '900', marginTop: 4 },
  details: { backgroundColor: '#FAF7F2', borderRadius: 10, padding: 10, marginTop: 12, gap: 5 },
  detailLine: { color: '#78716C', fontSize: 10, lineHeight: 15 },
  detailStrong: { color: '#44403C', fontWeight: '800' },
  disputeText: { color: '#B91C1C', fontSize: 10, lineHeight: 15, fontWeight: '700' },
  overdueBy: { color: '#B91C1C', fontSize: 10, fontWeight: '900', marginTop: 2 },
  vendorButton: { borderTopWidth: 1, borderTopColor: '#F7F1EB', marginTop: 13, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  vendorButtonText: { color: '#9A3412', fontSize: 11, fontWeight: '900', flex: 1 },
});
