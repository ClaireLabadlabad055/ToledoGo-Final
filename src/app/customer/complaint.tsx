import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../Services/supabase';

const complaintCategories = [
  { key: 'app_issue', label: 'App issue' },
  { key: 'account_security', label: 'Account / security' },
  { key: 'payment_transaction', label: 'Payment / transaction' },
  { key: 'vendor_service', label: 'Vendor / service' },
  { key: 'other', label: 'Other' },
] as const;

export default function CustomerComplaintScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<(typeof complaintCategories)[number]['key']>('app_issue');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitComplaint = async () => {
    const cleanDetails = details.trim();
    if (cleanDetails.length < 10) {
      Alert.alert('Add more details', 'Please describe the issue using at least 10 characters.');
      return;
    }
    if (cleanDetails.length > 2000 || submitting) return;

    setSubmitting(true);
    try {
      const { data: userData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!userData.user) {
        router.replace('/login');
        return;
      }

      const { error } = await supabase.rpc('submit_customer_complaint', {
        complaint_category: category,
        complaint_details: cleanDetails,
      });
      if (error) throw error;

      Alert.alert(
        'Complaint submitted',
        'Your complaint was sent to ToledoGo Support for review.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Please try again.';
      Alert.alert('Could not submit complaint', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#7C2D12" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
            <Feather name="arrow-left" size={19} color="#292524" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>TOLEDOGO SUPPORT</Text>
            <Text style={styles.title}>Submit a complaint</Text>
          </View>
          <Feather name="flag" size={23} color="#FED7AA" />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.description}>
            Tell us about an app, account, payment, or service concern. You do not need to attach it to an order.
          </Text>
          <Text style={styles.label}>WHAT IS THE ISSUE ABOUT?</Text>
          <View style={styles.categoryList}>
            {complaintCategories.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={[styles.categoryChip, category === item.key && styles.categoryChipSelected]}
                onPress={() => setCategory(item.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: category === item.key }}
              >
                <Text style={[styles.categoryText, category === item.key && styles.categoryTextSelected]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>DESCRIBE WHAT HAPPENED</Text>
          <TextInput
            style={styles.detailsInput}
            value={details}
            onChangeText={setDetails}
            placeholder="Include relevant details, but never share a password, wallet PIN, or OTP."
            placeholderTextColor="#A8A29E"
            multiline
            maxLength={2000}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{details.trim().length}/2000 characters (minimum 10)</Text>
          <TouchableOpacity
            style={[styles.submitButton, (submitting || details.trim().length < 10) && styles.submitDisabled]}
            onPress={submitComplaint}
            disabled={submitting || details.trim().length < 10}
          >
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : (
              <>
                <Feather name="send" size={16} color="#FFFFFF" />
                <Text style={styles.submitText}>Send to support</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFF9F2' },
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, backgroundColor: '#7C2D12' },
  backButton: { width: 39, height: 39, borderRadius: 13, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#FFFFFF', fontSize: 21, fontWeight: '900', marginTop: 3 },
  content: { padding: 18, paddingBottom: 35 },
  description: { color: '#57534E', fontSize: 13, lineHeight: 20, marginBottom: 22 },
  label: { color: '#9A3412', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 9 },
  categoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 },
  categoryChip: { borderWidth: 1, borderColor: '#E7D9CC', borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 10 },
  categoryChipSelected: { borderColor: '#C2410C', backgroundColor: '#FFF1E6' },
  categoryText: { color: '#57534E', fontSize: 11, fontWeight: '700' },
  categoryTextSelected: { color: '#9A3412', fontWeight: '900' },
  detailsInput: { minHeight: 150, borderWidth: 1, borderColor: '#E7D9CC', borderRadius: 14, backgroundColor: '#FFFFFF', padding: 13, color: '#292524', fontSize: 13, lineHeight: 19 },
  counter: { color: '#78716C', fontSize: 10, textAlign: 'right', marginTop: 6 },
  submitButton: { minHeight: 48, marginTop: 20, borderRadius: 13, backgroundColor: '#C2410C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitDisabled: { opacity: 0.55 },
  submitText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
