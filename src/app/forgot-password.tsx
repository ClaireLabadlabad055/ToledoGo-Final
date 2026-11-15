import { Feather } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../Services/supabase';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const { width } = Dimensions.get('window');

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { email: initialEmail } = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof initialEmail === 'string' ? initialEmail : '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const glowTopAnim = useSharedValue(0);
  const glowBottomAnim = useSharedValue(0);

  useEffect(() => {
    glowTopAnim.value = withRepeat(
      withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    glowBottomAnim.value = withRepeat(
      withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [glowBottomAnim, glowTopAnim]);

  const topGlowStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + glowTopAnim.value * 0.15 },
      { translateY: glowTopAnim.value * 15 },
    ],
    opacity: 0.07 + glowTopAnim.value * 0.05,
  }));

  const bottomGlowStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + glowBottomAnim.value * 0.12 },
      { translateX: glowBottomAnim.value * -15 },
    ],
    opacity: 0.15 + glowBottomAnim.value * 0.08,
  }));

  const sendResetEmail = async () => {
    const normalizedEmail = email.trim();
    if (!emailPattern.test(normalizedEmail)) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    setSending(true);
    setErrorMessage('');
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: Linking.createURL('reset-password'),
      });
      if (error) {
        setErrorMessage(error.message);
        return;
      }
      setSent(true);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not send the password reset email. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#451A03" />
      <LinearGradient
        colors={['#451A03', '#7C2D12', '#C2410C']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Animated.View style={[styles.glowCircleTop, topGlowStyle]} />
        <Animated.View style={[styles.glowCircleBottom, bottomGlowStyle]} />
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView
            style={styles.safeArea}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.contentWrapper}>
              <Animated.View
                entering={FadeInDown.delay(100).duration(600).springify()}
                style={styles.topHeader}
              >
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => router.replace('/login')}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Back to sign in"
                >
                  <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>
              </Animated.View>

              <View style={styles.formContainer}>
                <Animated.View entering={FadeInDown.delay(200).duration(800).springify()}>
                  <View style={styles.icon}>
                    <Feather name={sent ? 'mail' : 'lock'} size={24} color="#451A03" />
                  </View>
                  <Text style={styles.title}>{sent ? 'Check your email' : 'Forgot your password?'}</Text>
                  <Text style={styles.subtitle}>
                    {sent
                      ? `If an account exists for ${email.trim()}, we sent a password reset link. Open it on this device to choose a new password.`
                      : 'Enter the email address linked to your account. We’ll send you a link to reset your password.'}
                  </Text>
                </Animated.View>

                {!sent && (
                  <>
                    <Animated.View
                      entering={FadeInDown.delay(400).duration(800).springify()}
                      style={styles.inputGroup}
                    >
                      <Text style={styles.inputLabel}>Email Address</Text>
                      <TextInput
                        style={styles.textInput}
                        value={email}
                        onChangeText={(value) => {
                          setEmail(value);
                          if (errorMessage) setErrorMessage('');
                        }}
                        placeholder="vendor@toledogo.com"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        textContentType="emailAddress"
                        accessibilityLabel="Email address"
                      />
                      {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
                    </Animated.View>
                    <Animated.View
                      entering={FadeInDown.delay(600).duration(800).springify()}
                      style={styles.buttonWrapper}
                    >
                      <TouchableOpacity
                        style={styles.submitBtn}
                        onPress={sendResetEmail}
                        disabled={sending}
                        activeOpacity={0.9}
                        accessibilityRole="button"
                      >
                        <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                          {sending
                            ? <ActivityIndicator color="#451A03" />
                            : <Text style={styles.btnText}>Send Reset Link</Text>}
                        </LinearGradient>
                      </TouchableOpacity>
                    </Animated.View>
                  </>
                )}

                {sent && (
                  <Animated.View
                    entering={FadeInDown.delay(400).duration(800).springify()}
                    style={styles.buttonWrapper}
                  >
                    <TouchableOpacity
                      style={styles.submitBtn}
                      onPress={() => router.replace('/login')}
                      activeOpacity={0.9}
                      accessibilityRole="button"
                    >
                      <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                        <Text style={styles.btnText}>Back to Sign In</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#451A03' },
  safeArea: { flex: 1 },
  glowCircleTop: {
    position: 'absolute',
    top: -width * 0.3,
    right: -width * 0.2,
    width: width * 0.9,
    height: width * 0.9,
    borderRadius: width * 0.45,
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  glowCircleBottom: {
    position: 'absolute',
    bottom: -width * 0.2,
    left: -width * 0.3,
    width: width * 0.8,
    height: width * 0.8,
    borderRadius: width * 0.4,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  contentWrapper: { flex: 1, paddingHorizontal: 28, justifyContent: 'space-between', paddingVertical: 16 },
  topHeader: { paddingTop: 10 },
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  backButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  formContainer: { justifyContent: 'center', flex: 1, marginTop: -80 },
  icon: {
    width: 54,
    height: 54,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', marginBottom: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#FED7AA', marginBottom: 32, lineHeight: 20 },
  inputGroup: { marginBottom: 20 },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFEDD5',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    color: '#FFFFFF',
    fontSize: 15,
  },
  errorText: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(127, 29, 29, 0.55)',
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
    fontSize: 12,
  },
  buttonWrapper: { marginTop: 10 },
  submitBtn: {
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 6,
  },
  btnGradient: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#451A03', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
});
