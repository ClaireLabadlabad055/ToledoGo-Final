import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../../Services/supabase';
import { hasActiveVendorPro } from '../../constants/vendor-subscriptions';

type SubscriptionInfo = {
  business_name: string;
  is_verified: boolean;
  subscription_tier: string;
  subscription_status: string;
  subscription_expires_at: string | null;
};

const getFunctionErrorMessage = async (error: unknown) => {
  if (typeof error === 'object' && error !== null && 'context' in error) {
    const context = error.context;
    if (typeof context === 'object' && context !== null && 'json' in context && typeof context.json === 'function') {
      const response = context as { json: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> } };
      const payload = await (response.clone ? response.clone().json() : response.json()).catch(() => null);
      if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') {
        return payload.error;
      }
    }
  }
  return error instanceof Error ? error.message : 'Please try again.';
};

export default function VendorSubscriptionScreen() {
  const router = useRouter();
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSubscription = useCallback(async () => {
    setError(null);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      router.replace('/login');
      return;
    }
    const { data, error: vendorError } = await supabase
      .from('vendors')
      .select('business_name, is_verified, subscription_tier, subscription_status, subscription_expires_at')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (vendorError) {
      setError(vendorError.message);
    } else if (!data) {
      setError('Vendor profile not found.');
    } else {
      setSubscription(data as SubscriptionInfo);
    }
    setLoading(false);
  }, [router]);

  useFocusEffect(useCallback(() => {
    void loadSubscription();
  }, [loadSubscription]));

  const hasPro = subscription
    ? hasActiveVendorPro(subscription.subscription_tier, subscription.subscription_status, subscription.subscription_expires_at)
    : false;
  const expiryDate = subscription?.subscription_expires_at
    ? new Date(subscription.subscription_expires_at).toLocaleDateString()
    : null;

  const startCheckout = () => {
    Alert.alert(
      hasPro ? 'Renew Pro?' : 'Upgrade to Pro?',
      'Pay ₱199 for one month using GCash or QR Ph. Renewal is manual; you will not be charged automatically.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            setCheckoutLoading(true);
            try {
              const { data, error: invokeError } = await supabase.functions.invoke('vendor-pro-upgrade', { body: {} });
              if (invokeError) throw invokeError;
              const checkoutUrl = typeof data?.checkout_url === 'string' ? data.checkout_url : null;
              if (!checkoutUrl) throw new Error('Checkout link was not returned by the payment service.');
              const parsedUrl = new URL(checkoutUrl);
              if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'checkout.paymongo.com') {
                throw new Error('The payment service returned an unexpected checkout link.');
              }
              if (!(await Linking.canOpenURL(checkoutUrl))) throw new Error('Your device cannot open the checkout page.');
              await Linking.openURL(checkoutUrl);
            } catch (checkoutError) {
              Alert.alert('Could not open checkout', await getFunctionErrorMessage(checkoutError));
            } finally {
              setCheckoutLoading(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF9F2" />
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
          <Feather name="arrow-left" size={20} color="#7C2D12" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>ACCOUNT</Text>
          <Text style={styles.title}>Subscription</Text>
        </View>
      </View>

      {loading ? <ActivityIndicator color="#C2410C" style={styles.loader} /> : (
        <ScrollView contentContainerStyle={styles.content}>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {subscription ? (
            <>
              <View style={styles.planCard}>
                <View style={styles.planIcon}><Feather name="award" size={24} color="#C2410C" /></View>
                <Text style={styles.planEyebrow}>CURRENT PLAN</Text>
                <Text style={styles.planName}>{hasPro ? 'Pro / Storefront' : 'Free / Basic'}</Text>
                <View style={[styles.statusPill, hasPro ? styles.activePill : styles.freePill]}>
                  <View style={[styles.statusDot, hasPro ? styles.activeDot : styles.freeDot]} />
                  <Text style={[styles.statusText, hasPro ? styles.activeText : styles.freeText]}>
                    {hasPro ? 'Active' : subscription.subscription_tier === 'pro' ? 'Expired' : 'Free plan'}
                  </Text>
                </View>
                {hasPro && expiryDate ? <Text style={styles.planNote}>Access through {expiryDate}</Text> : null}
                {!hasPro && subscription.subscription_tier === 'pro' && expiryDate
                  ? <Text style={styles.planNote}>Your previous Pro access ended {expiryDate}.</Text>
                  : null}
              </View>

              <View style={styles.detailsCard}>
                <Text style={styles.sectionTitle}>Pro / Storefront</Text>
                <View style={styles.priceRow}><Text style={styles.price}>₱199</Text><Text style={styles.perMonth}>/ month</Text></View>
                <Text style={styles.description}>A one-month pass with manual renewal. No automatic charges.</Text>
                <View style={styles.divider} />
                <Feature text="Up to 999 menu listings" />
                <Feature text="Quick POS for in-store sales" />
                <Feature text="Priority marketplace listing" />
                <Feature text="Up to 8 active pickup schedules" />
                <TouchableOpacity
                  style={[styles.checkoutButton, (!subscription.is_verified || checkoutLoading) && styles.disabledButton]}
                  onPress={startCheckout}
                  disabled={!subscription.is_verified || checkoutLoading}
                >
                  {checkoutLoading ? <ActivityIndicator color="#FFFFFF" /> : (
                    <Text style={styles.checkoutText}>{hasPro ? 'Renew Pro for ₱199' : 'Upgrade to Pro for ₱199'}</Text>
                  )}
                </TouchableOpacity>
                {!subscription.is_verified ? <Text style={styles.verificationNote}>Your vendor account must be approved before you can purchase Pro.</Text> : null}
                <Text style={styles.paymentNote}>Pay securely through PayMongo with GCash or QR Ph. Pro access updates after PayMongo confirms payment.</Text>
              </View>
              <TouchableOpacity style={styles.refreshButton} onPress={() => { setLoading(true); void loadSubscription(); }}>
                <Feather name="refresh-cw" size={15} color="#9A3412" />
                <Text style={styles.refreshText}>Refresh subscription status</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Feature({ text }: { text: string }) {
  return (
    <View style={styles.featureRow}>
      <Feather name="check-circle" size={16} color="#15803D" />
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFF9F2' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F3E8DC' },
  backButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E8' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#C2410C', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#292524', fontSize: 20, fontWeight: '900', marginTop: 2 },
  content: { padding: 18, paddingBottom: 35 },
  loader: { marginTop: 45 },
  planCard: { alignItems: 'center', padding: 22, backgroundColor: '#7C2D12', borderRadius: 20, marginBottom: 16 },
  planIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED', marginBottom: 11 },
  planEyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  planName: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 5 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 6, marginTop: 12 },
  activePill: { backgroundColor: '#DCFCE7' },
  freePill: { backgroundColor: '#FEF3C7' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  activeDot: { backgroundColor: '#15803D' },
  freeDot: { backgroundColor: '#B45309' },
  statusText: { fontSize: 11, fontWeight: '800' },
  activeText: { color: '#166534' },
  freeText: { color: '#92400E' },
  planNote: { color: '#FED7AA', textAlign: 'center', fontSize: 11, marginTop: 10 },
  detailsCard: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: '#F3E8DC', padding: 18 },
  sectionTitle: { color: '#292524', fontSize: 16, fontWeight: '900' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 8 },
  price: { color: '#7C2D12', fontSize: 29, fontWeight: '900' },
  perMonth: { color: '#78716C', fontSize: 12, marginLeft: 5 },
  description: { color: '#78716C', fontSize: 12, marginTop: 3 },
  divider: { height: 1, backgroundColor: '#F3E8DC', marginVertical: 15 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 },
  featureText: { color: '#44403C', fontSize: 12, fontWeight: '600' },
  checkoutButton: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#C2410C', marginTop: 8 },
  disabledButton: { opacity: 0.5 },
  checkoutText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  verificationNote: { color: '#92400E', backgroundColor: '#FEF3C7', borderRadius: 10, padding: 10, fontSize: 11, lineHeight: 16, marginTop: 10 },
  paymentNote: { color: '#78716C', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 12 },
  refreshButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 14 },
  refreshText: { color: '#9A3412', fontSize: 11, fontWeight: '800' },
  errorText: { color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10, marginBottom: 12, fontSize: 12 },
});
