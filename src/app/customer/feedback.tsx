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

export default function CustomerFeedbackScreen() {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submitFeedback = async () => {
    if (rating < 1 || rating > 5) {
      Alert.alert('Choose a rating', 'Tap a star to rate your ToledoGo experience.');
      return;
    }
    if (submitting) return;

    setSubmitting(true);
    try {
      const { data: userData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!userData.user) {
        router.replace('/login');
        return;
      }

      const { error } = await supabase.rpc('submit_customer_feedback', {
        feedback_rating: rating,
        feedback_comments: comments.trim() || null,
      });
      if (error) throw error;

      Alert.alert(
        'Thank you for your feedback',
        'Your rating and comments were sent to the ToledoGo team.',
        [{ text: 'Done', onPress: () => router.back() }],
      );
    } catch (error) {
      Alert.alert(
        'Could not submit feedback',
        error instanceof Error ? error.message : 'Please try again.',
      );
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
            <Text style={styles.title}>Share feedback</Text>
          </View>
          <Feather name="star" size={23} color="#FED7AA" />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.description}>
            Your feedback helps us improve ToledoGo. This rating is about the app overall and is separate from menu-item reviews.
          </Text>
          <Text style={styles.label}>HOW WAS YOUR EXPERIENCE?</Text>
          <View style={styles.ratingRow}>
            {[1, 2, 3, 4, 5].map((value) => (
              <TouchableOpacity
                key={value}
                style={styles.starButton}
                onPress={() => setRating(value)}
                accessibilityRole="radio"
                accessibilityLabel={`${value} ${value === 1 ? 'star' : 'stars'}`}
                accessibilityState={{ selected: rating === value }}
              >
                <Feather
                  name="star"
                  size={34}
                  color={value <= rating ? '#D97706' : '#A8A29E'}
                  fill={value <= rating ? '#D97706' : 'transparent'}
                />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.ratingCaption}>
            {rating ? `${rating} out of 5 stars` : 'Tap a star to rate'}
          </Text>
          <Text style={styles.label}>COMMENTS (OPTIONAL)</Text>
          <TextInput
            style={styles.commentsInput}
            value={comments}
            onChangeText={setComments}
            placeholder="What worked well? What could we improve?"
            placeholderTextColor="#A8A29E"
            multiline
            maxLength={1000}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{comments.length}/1000 characters</Text>
          <TouchableOpacity
            style={[styles.submitButton, (!rating || submitting) && styles.submitDisabled]}
            onPress={submitFeedback}
            disabled={!rating || submitting}
          >
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : (
              <>
                <Feather name="send" size={16} color="#FFFFFF" />
                <Text style={styles.submitText}>Send feedback</Text>
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
  description: { color: '#57534E', fontSize: 13, lineHeight: 20, marginBottom: 24 },
  label: { color: '#9A3412', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginBottom: 9 },
  ratingRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 7 },
  starButton: { padding: 4 },
  ratingCaption: { color: '#78716C', fontSize: 11, fontWeight: '700', textAlign: 'center', marginTop: 8, marginBottom: 26 },
  commentsInput: { minHeight: 140, borderWidth: 1, borderColor: '#E7D9CC', borderRadius: 14, backgroundColor: '#FFFFFF', padding: 13, color: '#292524', fontSize: 13, lineHeight: 19 },
  counter: { color: '#78716C', fontSize: 10, textAlign: 'right', marginTop: 6 },
  submitButton: { minHeight: 48, marginTop: 20, borderRadius: 13, backgroundColor: '#C2410C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitDisabled: { opacity: 0.55 },
  submitText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
