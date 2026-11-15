import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../Services/supabase';

export default function VendorUpgradeSuccessScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ session_id?: string }>();
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    const finalizeUpgrade = async () => {
      const sessionId = typeof params.session_id === 'string' ? params.session_id : '';

      if (!sessionId) {
        Alert.alert('Payment status missing', 'We could not confirm the checkout session.');
        router.replace('/vendor/dashboard');
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke('vendor-pro-upgrade', {
          body: {
            mode: 'finalize_checkout',
            session_id: sessionId,
          },
        });

        if (error) throw error;
        if (!data?.activated) {
          throw new Error(data?.message ?? 'Payment verification failed.');
        }

        Alert.alert('Pro activated', 'Your vendor plan has been upgraded successfully.');
      } catch (finalizeError: any) {
        Alert.alert('Upgrade status could not be confirmed', finalizeError.message ?? 'Please try again later.');
      } finally {
        setProcessing(false);
        router.replace('/vendor/dashboard');
      }
    };

    finalizeUpgrade();
  }, [params.session_id, router]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {processing ? <ActivityIndicator size="large" color="#C2410C" /> : null}
        <Text style={styles.title}>{processing ? 'Confirming your Pro upgrade...' : 'Back to your dashboard'}</Text>
        <Text style={styles.subtitle}>{processing ? 'This should only take a moment.' : 'Your storefront status will refresh shortly.'}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFF9F2' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { marginTop: 18, color: '#292524', fontSize: 20, fontWeight: '900' },
  subtitle: { marginTop: 8, color: '#78716C', fontSize: 12, textAlign: 'center' },
});
