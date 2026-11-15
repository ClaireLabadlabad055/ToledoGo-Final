import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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

type Review = {
  id: string;
  customer_id?: string | null;
  rating: number;
  comment?: string | null;
  photo_url?: string | null;
  moderation_status: "published" | "hidden";
  created_at: string;
  customer?: { full_name?: string | null } | null;
  vendor?: {
    business_name?: string | null;
    profile_photo_url?: string | null;
    store_photo_url?: string | null;
  } | null;
  menu?: { name?: string | null } | null;
};

type Report = {
  id: string;
  customer_id?: string | null;
  vendor_id?: string | null;
  review_id?: string | null;
  order_id?: string | null;
  category?: string | null;
  reason: string;
  details?: string | null;
  photo_url?: string | null;
  severity?: "low" | "medium" | "high" | "critical";
  status: "open" | "resolved" | "dismissed";
  created_at: string;
  vendor?: { business_name?: string | null } | null;
  review?: { photo_url?: string | null } | null;
  customerName?: string;
};

type Feedback = {
  id: string;
  customer_id: string;
  rating: number;
  comments: string;
  status: "new" | "reviewed";
  created_at: string;
  customerName?: string;
};

type ModerationTab = "reviews" | "reports" | "feedback";

const complaintCategoryLabels: Record<string, string> = {
  app_issue: "App issue",
  account_security: "Account / security",
  payment_transaction: "Payment / transaction",
  vendor_service: "Vendor / service",
  other: "Other",
};

export default function AdminModerationScreen() {
  const router = useRouter();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [reviewPhotoUrls, setReviewPhotoUrls] = useState<
    Record<string, string>
  >({});
  const [vendorCoverUrls, setVendorCoverUrls] = useState<
    Record<string, string>
  >({});
  const [reportPhotoUrls, setReportPhotoUrls] = useState<
    Record<string, string>
  >({});
  const [tab, setTab] = useState<ModerationTab>("reviews");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadModeration = useCallback(async () => {
    try {
      setError(null);
      if (!(await isAdminUser())) {
        router.replace("/login");
        return;
      }

      const [
        { data: reviewRows, error: reviewError },
        { data: reportRows, error: reportError },
        { data: feedbackRows, error: feedbackError },
      ] = await Promise.all([
        supabase
          .from("reviews")
          .select(
            "id, customer_id, rating, comment, photo_url, moderation_status, created_at, vendor:vendors(business_name, profile_photo_url, store_photo_url), menu:menus(name)",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("content_reports")
          .select(
            "id, customer_id, vendor_id, review_id, order_id, category, reason, details, photo_url, severity, status, created_at, vendor:vendors(business_name), review:reviews(photo_url)",
          )
          .eq("status", "open")
          .order("created_at", { ascending: false }),
        supabase
          .from("customer_feedback")
          .select("id, customer_id, rating, comments, status, created_at")
          .eq("status", "new")
          .order("created_at", { ascending: false }),
      ]);

      if (reviewError) throw reviewError;
      if (reportError) throw reportError;
      if (feedbackError) throw feedbackError;

      const customerIds = Array.from(
        new Set(
          [
            ...(reviewRows ?? [])
            .map((item) => item.customer_id)
            .filter((value): value is string => Boolean(value)),
            ...(reportRows ?? [])
              .map((item) => item.customer_id)
              .filter((value): value is string => Boolean(value)),
            ...(feedbackRows ?? []).map((item) => item.customer_id),
          ],
        ),
      );
      let customerMap = new Map<string, string>();

      if (customerIds.length > 0) {
        const { data: customerRows, error: customerError } = await supabase
          .from("customers")
          .select("id, full_name")
          .in("id", customerIds);

        if (customerError) throw customerError;

        for (const customer of customerRows ?? []) {
          if (customer.id && customer.full_name) {
            customerMap.set(customer.id, customer.full_name);
          }
        }
      }

      const mappedReviews = (reviewRows ?? []).map((review) => ({
        ...review,
        customer: {
          full_name: review.customer_id
            ? (customerMap.get(review.customer_id) ?? "Customer")
            : "Customer",
        },
      })) as Review[];

      setReviews(mappedReviews);
      const mappedReports = (reportRows ?? []).map((report) => ({
        ...report,
        customerName: report.customer_id
          ? (customerMap.get(report.customer_id) ?? "Customer")
          : "Customer",
      })) as Report[];
      setReports(mappedReports);
      setFeedback((feedbackRows ?? []).map((item) => ({
        ...item,
        customerName: customerMap.get(item.customer_id) ?? "Customer",
      })) as Feedback[]);

      const reportPhotoEntries = await Promise.all(
        mappedReports
          .filter((report) => report.photo_url || report.review?.photo_url)
          .map(async (report) => {
            const { data } = await supabase.storage
              .from("review-photos")
              .createSignedUrl(
                report.photo_url ?? report.review!.photo_url!,
                900,
              );
            return data?.signedUrl
              ? ([report.id, data.signedUrl] as const)
              : null;
          }),
      );
      setReportPhotoUrls(
        Object.fromEntries(
          reportPhotoEntries.filter(Boolean) as [string, string][],
        ),
      );

      const reviewPhotoEntries = await Promise.all(
        mappedReviews
          .filter((review) => review.photo_url)
          .map(async (review) => {
            const { data } = await supabase.storage
              .from("review-photos")
              .createSignedUrl(review.photo_url!, 900);
            return data?.signedUrl
              ? ([review.id, data.signedUrl] as const)
              : null;
          }),
      );
      setReviewPhotoUrls(
        Object.fromEntries(
          reviewPhotoEntries.filter(Boolean) as [string, string][],
        ),
      );

      const vendorCoverEntries = await Promise.all(
        mappedReviews.map(async (review) => {
          const path =
            review.vendor?.profile_photo_url ?? review.vendor?.store_photo_url;
          if (!path) return null;
          const { data } = await supabase.storage
            .from("vendor-verification")
            .createSignedUrl(path, 900);
          return data?.signedUrl
            ? ([review.id, data.signedUrl] as const)
            : null;
        }),
      );
      setVendorCoverUrls(
        Object.fromEntries(
          vendorCoverEntries.filter(Boolean) as [string, string][],
        ),
      );
    } catch (loadError: any) {
      setError(
        loadError.message ??
          "Unable to load moderation data. Run admin-ledger-moderation.sql first.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      loadModeration();
    }, [loadModeration]),
  );

  const hiddenCount = useMemo(
    () =>
      reviews.filter((review) => review.moderation_status === "hidden").length,
    [reviews],
  );

  const moderateReview = async (
    review: Review,
    status: "published" | "hidden",
  ) => {
    const { error: updateError } = await supabase
      .from("reviews")
      .update({
        moderation_status: status,
        moderated_at: new Date().toISOString(),
      })
      .eq("id", review.id);

    if (updateError) {
      Alert.alert("Could not update review", updateError.message);
      return;
    }

    setReviews((current) =>
      current.map((item) =>
        item.id === review.id ? { ...item, moderation_status: status } : item,
      ),
    );
  };

  const applyVendorAction = async (
    report: Report,
    action: "warning" | "suspended" | "banned" | "dismissed",
  ) => {
    const { error: actionError } = await supabase.rpc(
      "apply_vendor_quality_action",
      {
        report_id: report.id,
        action,
        admin_note: `Admin action: ${action}`,
      },
    );

    if (actionError) {
      Alert.alert("Could not apply action", actionError.message);
      return;
    }

    setReports((current) => current.filter((item) => item.id !== report.id));
    Alert.alert("Quality action applied", `Vendor action recorded: ${action}.`);
  };

  const closeGeneralComplaint = async (
    report: Report,
    status: "resolved" | "dismissed",
  ) => {
    try {
      const { data: userData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!userData.user) throw new Error("Sign in again to review this complaint.");

      const { data, error: updateError } = await supabase
        .from("content_reports")
        .update({
          status,
          resolved_at: new Date().toISOString(),
          resolved_by: userData.user.id,
        })
        .eq("id", report.id)
        .eq("status", "open")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("This complaint is no longer open. Refresh the report queue.");

      setReports((current) => current.filter((item) => item.id !== report.id));
      Alert.alert(
        status === "resolved" ? "Complaint resolved" : "Complaint dismissed",
        status === "resolved" ? "The complaint was marked as resolved." : "The complaint was dismissed.",
      );
    } catch (actionError) {
      Alert.alert(
        "Could not update complaint",
        actionError instanceof Error ? actionError.message : "Please try again.",
      );
    }
  };

  const markFeedbackReviewed = async (item: Feedback) => {
    try {
      const { data: userData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!userData.user) throw new Error("Sign in again to review this feedback.");

      const { data, error: updateError } = await supabase
        .from("customer_feedback")
        .update({
          status: "reviewed",
          reviewed_at: new Date().toISOString(),
          reviewed_by: userData.user.id,
        })
        .eq("id", item.id)
        .eq("status", "new")
        .select("id")
        .maybeSingle();
      if (updateError) throw updateError;
      if (!data) throw new Error("This feedback was already reviewed. Refresh the queue.");

      setFeedback((current) => current.filter((entry) => entry.id !== item.id));
      Alert.alert("Feedback reviewed", "The submission was marked as reviewed.");
    } catch (reviewError) {
      Alert.alert(
        "Could not update feedback",
        reviewError instanceof Error ? reviewError.message : "Please try again.",
      );
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#C2410C" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.replace("/admin/dashboard")}
          >
            <Feather name="arrow-left" size={20} color="#7C2D12" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>ADMIN TRUST & SAFETY</Text>
            <Text style={styles.title}>Moderation queue</Text>
            <Text style={styles.subtitle}>
              Review community content and vendor quality issues.
            </Text>
          </View>
          <MaterialCommunityIcons
            name="shield-alert-outline"
            size={29}
            color="#FFF7ED"
          />
        </View>

        <View style={styles.tabBar}>
          <TouchableOpacity
            style={[styles.tab, tab === "reviews" && styles.tabActive]}
            onPress={() => setTab("reviews")}
          >
            <Feather
              name="message-square"
              size={15}
              color={tab === "reviews" ? "#FFFFFF" : "#7C2D12"}
            />
            <Text
              style={[
                styles.tabText,
                tab === "reviews" && styles.tabTextActive,
              ]}
            >
              Reviews ({reviews.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === "reports" && styles.tabActive]}
            onPress={() => setTab("reports")}
          >
            <Feather
              name="flag"
              size={15}
              color={tab === "reports" ? "#FFFFFF" : "#7C2D12"}
            />
            <Text
              style={[
                styles.tabText,
                tab === "reports" && styles.tabTextActive,
              ]}
            >
              Reports ({reports.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, tab === "feedback" && styles.tabActive]}
            onPress={() => setTab("feedback")}
          >
            <Feather
              name="star"
              size={15}
              color={tab === "feedback" ? "#FFFFFF" : "#7C2D12"}
            />
            <Text
              style={[
                styles.tabText,
                tab === "feedback" && styles.tabTextActive,
              ]}
            >
              Feedback ({feedback.length})
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadModeration();
              }}
              tintColor="#C2410C"
            />
          }
        >
          <View style={styles.summary}>
            <Text style={styles.summaryTitle}>
              {tab === "reviews"
                ? `${hiddenCount} hidden review${hiddenCount === 1 ? "" : "s"}`
                : tab === "reports"
                  ? `${reports.length} open report${reports.length === 1 ? "" : "s"}`
                  : `${feedback.length} new feedback submission${feedback.length === 1 ? "" : "s"}`}
            </Text>
            <Text style={styles.summaryText}>
              {tab === "reviews"
                ? "Hide inappropriate comments or fake photo reviews from the marketplace."
                : tab === "reports"
                  ? "Investigate customer and vendor reports before closing each case."
                  : "Read customer ratings and comments about their overall ToledoGo experience."}
            </Text>
          </View>

          {error ? (
            <View style={styles.error}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={loadModeration}>
                <Text style={styles.retry}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {loading ? (
            <ActivityIndicator color="#C2410C" style={styles.loader} />
          ) : null}

          {!loading && !error && tab === "reviews" && reviews.length === 0 ? (
            <Empty text="No reviews have been submitted yet." />
          ) : null}
          {!loading && !error && tab === "reports" && reports.length === 0 ? (
            <Empty text="No open reports." />
          ) : null}
          {!loading && !error && tab === "feedback" && feedback.length === 0 ? (
            <Empty text="No new customer feedback." />
          ) : null}

          {tab === "reviews"
            ? reviews.map((review) => (
                <View key={review.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {review.moderation_status === "hidden"
                          ? "HIDDEN"
                          : "PUBLISHED"}
                      </Text>
                    </View>
                    <Text style={styles.date}>
                      {new Date(review.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.subject}>
                    {review.vendor?.business_name || "Local kitchen"} ·{" "}
                    {review.menu?.name || "Menu item"}
                  </Text>
                  <View style={styles.vendorRow}>
                    {vendorCoverUrls[review.id] ? (
                      <Image
                        source={{ uri: vendorCoverUrls[review.id] }}
                        style={styles.vendorCover}
                      />
                    ) : (
                      <View style={styles.vendorCoverFallback}>
                        <Feather
                          name="shopping-bag"
                          size={16}
                          color="#C2410C"
                        />
                      </View>
                    )}
                    <View style={styles.vendorCopy}>
                      <Text style={styles.vendorLabel}>SELLER</Text>
                      <Text style={styles.vendorName}>
                        {review.vendor?.business_name || "Local kitchen"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.author}>
                    {review.customer?.full_name || "Customer"} ·{" "}
                    {"★".repeat(Math.max(0, Math.min(5, review.rating)))}
                  </Text>
                  {review.comment ? (
                    <Text style={styles.comment}>{review.comment}</Text>
                  ) : (
                    <Text style={styles.noComment}>Photo-only review</Text>
                  )}
                  {review.photo_url ? (
                    reviewPhotoUrls[review.id] ? (
                      <Image
                        source={{ uri: reviewPhotoUrls[review.id] }}
                        style={styles.reviewPhoto}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.photoFlag}>
                        <Feather name="image" size={14} color="#C2410C" />
                        <Text style={styles.photoFlagText}>
                          Customer photo unavailable
                        </Text>
                      </View>
                    )
                  ) : null}
                  <TouchableOpacity
                    style={
                      review.moderation_status === "hidden"
                        ? styles.restoreButton
                        : styles.hideButton
                    }
                    onPress={() =>
                      moderateReview(
                        review,
                        review.moderation_status === "hidden"
                          ? "published"
                          : "hidden",
                      )
                    }
                  >
                    <Feather
                      name={
                        review.moderation_status === "hidden"
                          ? "eye"
                          : "eye-off"
                      }
                      size={15}
                      color={
                        review.moderation_status === "hidden"
                          ? "#C2410C"
                          : "#FFFFFF"
                      }
                    />
                    <Text
                      style={
                        review.moderation_status === "hidden"
                          ? styles.restoreText
                          : styles.hideText
                      }
                    >
                      {review.moderation_status === "hidden"
                        ? "Restore review"
                        : "Hide review"}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))
            : tab === "reports" ? reports.map((report) => (
                <View key={report.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.reportBadge}>
                      <Text style={styles.reportBadgeText}>
                        {report.severity?.toUpperCase() || "REPORT"}
                      </Text>
                    </View>
                    <Text style={styles.date}>
                      {new Date(report.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.subject}>
                    {report.vendor?.business_name || (report.vendor_id ? "Vendor" : "ToledoGo Support")} ·{" "}
                    {report.category === "general_complaint"
                      ? "General complaint"
                      : report.category || report.reason}
                  </Text>
                  <Text style={styles.reportLabel}>
                    {report.category === "general_complaint" ? "COMPLAINT CATEGORY" : "REPORTED BY"}
                    {report.category === "general_complaint"
                      ? ""
                      : ` ${report.customerName?.toUpperCase() || "CUSTOMER"}`}
                  </Text>
                  <Text style={styles.reportReason}>
                    {report.category === "general_complaint"
                      ? complaintCategoryLabels[report.reason] || report.reason
                      : report.reason}
                  </Text>
                  {report.category === "general_complaint" ? (
                    <Text style={styles.author}>Submitted by {report.customerName || "Customer"}</Text>
                  ) : null}
                  {report.details ? (
                    <>
                      <Text style={styles.reportLabel}>CUSTOMER DETAILS</Text>
                      <Text style={styles.comment}>{report.details}</Text>
                    </>
                  ) : null}
                  {report.photo_url || report.review_id ? (
                    reportPhotoUrls[report.id] ? (
                      <Image
                        source={{ uri: reportPhotoUrls[report.id] }}
                        style={styles.reviewPhoto}
                        resizeMode="cover"
                      />
                    ) : report.photo_url || report.review?.photo_url ? (
                      <View style={styles.photoFlag}>
                        <Feather name="image" size={14} color="#C2410C" />
                        <Text style={styles.photoFlagText}>
                          Customer photo unavailable
                        </Text>
                      </View>
                    ) : null
                  ) : null}
                  {report.vendor_id ? (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.warningButton}
                        onPress={() => applyVendorAction(report, "warning")}
                      >
                        <Text style={styles.warningText}>Warning</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.suspendButton}
                        onPress={() => applyVendorAction(report, "suspended")}
                      >
                        <Text style={styles.suspendText}>Suspend</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.banButton}
                        onPress={() => applyVendorAction(report, "banned")}
                      >
                        <Text style={styles.banText}>Ban</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.dismissButton}
                        onPress={() => applyVendorAction(report, "dismissed")}
                      >
                        <Text style={styles.dismissText}>Dismiss</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={styles.warningButton}
                        onPress={() => closeGeneralComplaint(report, "resolved")}
                      >
                        <Text style={styles.warningText}>Resolve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.dismissButton}
                        onPress={() => closeGeneralComplaint(report, "dismissed")}
                      >
                        <Text style={styles.dismissText}>Dismiss</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )) : feedback.map((item) => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.reportBadge}>
                      <Text style={styles.reportBadgeText}>CUSTOMER FEEDBACK</Text>
                    </View>
                    <Text style={styles.date}>
                      {new Date(item.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <Text style={styles.subject}>
                    {item.customerName || "Customer"} · App experience
                  </Text>
                  <Text style={styles.author}>
                    {"★".repeat(item.rating)}{"☆".repeat(5 - item.rating)} · {item.rating}/5
                  </Text>
                  {item.comments ? (
                    <Text style={styles.comment}>{item.comments}</Text>
                  ) : (
                    <Text style={styles.noComment}>No written comment.</Text>
                  )}
                  <TouchableOpacity
                    style={styles.restoreButton}
                    onPress={() => markFeedbackReviewed(item)}
                  >
                    <Feather name="check" size={15} color="#C2410C" />
                    <Text style={styles.restoreText}>Mark as reviewed</Text>
                  </TouchableOpacity>
                </View>
              ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Feather name="check-circle" size={36} color="#C2410C" />
      <Text style={styles.emptyTitle}>{text}</Text>
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
    backgroundColor: "#C2410C",
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
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  tabBar: {
    flexDirection: "row",
    gap: 8,
    padding: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#FCD7AE",
  },
  tab: {
    flex: 1,
    minHeight: 39,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#FCD7AE",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  tabActive: { backgroundColor: "#C2410C", borderColor: "#C2410C" },
  tabText: { color: "#7C2D12", fontSize: 11, fontWeight: "900" },
  tabTextActive: { color: "#FFFFFF" },
  content: { padding: 16, paddingBottom: 35 },
  summary: {
    padding: 16,
    borderRadius: 17,
    backgroundColor: "#FFF1E6",
    marginBottom: 14,
  },
  summaryTitle: { color: "#7C2D12", fontSize: 15, fontWeight: "900" },
  summaryText: { color: "#9A4B2D", fontSize: 11, lineHeight: 16, marginTop: 4 },
  error: { backgroundColor: "#FEF2F2", padding: 12, borderRadius: 11 },
  errorText: { color: "#B91C1C", fontSize: 12 },
  retry: { color: "#991B1B", fontWeight: "900", marginTop: 7 },
  loader: { marginVertical: 30 },
  empty: { alignItems: "center", paddingVertical: 65 },
  emptyTitle: {
    color: "#7C2D12",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 10,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#F3E8DC",
    borderRadius: 17,
    padding: 15,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    backgroundColor: "#FFEDD5",
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: { color: "#9A3412", fontSize: 9, fontWeight: "900" },
  reportBadge: {
    backgroundColor: "#FEE2E2",
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 999,
  },
  reportBadgeText: { color: "#B91C1C", fontSize: 9, fontWeight: "900" },
  date: { color: "#C2410C", fontSize: 10, fontWeight: "800" },
  subject: { color: "#7C2D12", fontSize: 14, fontWeight: "900", marginTop: 10 },
  vendorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 10,
    padding: 9,
    borderRadius: 12,
    backgroundColor: "#FFF7ED",
  },
  vendorCover: { width: 42, height: 42, borderRadius: 10 },
  vendorCoverFallback: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#FFEDD5",
    alignItems: "center",
    justifyContent: "center",
  },
  vendorCopy: { flex: 1 },
  vendorLabel: {
    color: "#C2410C",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  vendorName: {
    color: "#7C2D12",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 2,
  },
  author: { color: "#9A4B2D", fontSize: 12, marginTop: 4 },
  comment: { color: "#44403C", fontSize: 12, lineHeight: 17, marginTop: 9 },
  noComment: {
    color: "#C2410C",
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 9,
  },
  photoFlag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  photoFlagText: { color: "#C2410C", fontSize: 10, fontWeight: "800" },
  reviewPhoto: {
    width: "100%",
    height: 190,
    borderRadius: 12,
    marginTop: 10,
    backgroundColor: "#FFF7ED",
  },
  hideButton: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#C2410C",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },
  hideText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  restoreButton: {
    marginTop: 12,
    minHeight: 40,
    borderRadius: 10,
    backgroundColor: "#FFEDD5",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },
  restoreText: { color: "#C2410C", fontSize: 12, fontWeight: "900" },
  reportReason: {
    color: "#7C2D12",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 8,
  },
  reportLabel: {
    color: "#C2410C",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 10,
  },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  warningButton: {
    backgroundColor: "#FEF3C7",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  warningText: { color: "#92400E", fontSize: 10, fontWeight: "900" },
  suspendButton: {
    backgroundColor: "#FEE2E2",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  suspendText: { color: "#991B1B", fontSize: 10, fontWeight: "900" },
  banButton: {
    backgroundColor: "#1F2937",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  banText: { color: "#FFFFFF", fontSize: 10, fontWeight: "900" },
  dismissButton: {
    backgroundColor: "#E5E7EB",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  dismissText: { color: "#374151", fontSize: 10, fontWeight: "900" },
});
