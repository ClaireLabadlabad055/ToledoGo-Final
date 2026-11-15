import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useEffect } from 'react';
import { 
  Dimensions, 
  StatusBar, 
  StyleSheet, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ScrollView,
  View, 
  KeyboardAvoidingView, 
  Platform,
  Alert,
  ActivityIndicator
} from 'react-native';
import Animated, { 
  FadeInDown, 
  useAnimatedStyle, 
  useSharedValue, 
  withRepeat, 
  withTiming, 
  Easing 
} from 'react-native-reanimated';
import { supabase } from '../Services/supabase';

const { width } = Dimensions.get('window');

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  // Floating background glow animations
  const glowTopAnim = useSharedValue(0);
  const glowBottomAnim = useSharedValue(0);

  useEffect(() => {
    glowTopAnim.value = withRepeat(
      withTiming(1, { duration: 6000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    glowBottomAnim.value = withRepeat(
      withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [glowBottomAnim, glowTopAnim]);

  const topGlowStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + glowTopAnim.value * 0.15 },
      { translateY: glowTopAnim.value * 15 }
    ],
    opacity: 0.07 + glowTopAnim.value * 0.05,
  }));

  const bottomGlowStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: 1 + glowBottomAnim.value * 0.12 },
      { translateX: glowBottomAnim.value * -15 }
    ],
    opacity: 0.15 + glowBottomAnim.value * 0.08,
  }));

  const validateEmailAddress = (emailValue: string) => {
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
    return emailRegex.test(emailValue.trim());
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Missing details', 'Enter your email and password.');
      return;
    }

    if (!validateEmailAddress(email)) {
      Alert.alert('Invalid Email Address', 'Please enter a valid email address before signing in.');
      return;
    }

    setLoggingIn(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setLoggingIn(false);
      Alert.alert('Sign-in failed', error.message);
      return;
    }

    if (data.user.app_metadata?.role === 'admin') {
      setLoggingIn(false);
      router.replace('/admin/dashboard');
      return;
    }

    let [{ data: vendor }, { data: customer }] = await Promise.all([
      supabase.from('vendors').select('is_verified').eq('id', data.user.id).maybeSingle(),
      supabase.from('customers').select('is_verified').eq('id', data.user.id).maybeSingle(),
    ]);

    const createCustomerProfile = () => supabase
      .from('customers')
      .insert({
        id: data.user.id,
        full_name: data.user.user_metadata.full_name ?? null,
        email: data.user.email ?? null,
        phone: data.user.user_metadata.phone ?? null,
        is_verified: false,
      })
      .select('is_verified')
      .single();

    if (!vendor && !customer && data.user.user_metadata?.role === 'customer') {
      const { data: createdCustomer, error: createCustomerError } = await createCustomerProfile();
      if (createCustomerError) {
        await supabase.auth.signOut();
        setLoggingIn(false);
        Alert.alert('Could not finish registration', createCustomerError.message);
        return;
      }
      customer = createdCustomer;
    }

    if (!vendor && !customer && !data.user.user_metadata?.role) {
      setLoggingIn(false);
      Alert.alert(
        'Finish customer registration?',
        'This confirmed account has no saved customer profile. If you created a customer account, continue to add it to the admin approval queue.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => { void supabase.auth.signOut(); } },
          {
            text: 'Continue as customer',
            onPress: async () => {
              setLoggingIn(true);
              const { error: createCustomerError } = await createCustomerProfile();
              if (createCustomerError) {
                await supabase.auth.signOut();
                setLoggingIn(false);
                Alert.alert('Could not finish registration', createCustomerError.message);
                return;
              }
              await supabase.auth.signOut();
              setLoggingIn(false);
              Alert.alert(
                'Pending approval',
                'Your customer profile has been created and is waiting for admin approval.',
                [{ text: 'Continue', onPress: () => router.replace('/pending-approval') }],
              );
            },
          },
        ],
      );
      return;
    }

    if (vendor && customer) {
      await supabase.auth.signOut();
      setLoggingIn(false);
      Alert.alert('Account conflict', 'This login has both a vendor and customer profile. Contact an administrator to keep only one account type.');
      return;
    }

    const account = vendor ?? customer;
    const isVendor = Boolean(vendor);

    if (!account) {
      await supabase.auth.signOut();
      setLoggingIn(false);
      Alert.alert('Account not found', 'Your account profile is not ready yet. Please contact ToledoGo support.');
      return;
    }

    if (!account.is_verified) {
      await supabase.auth.signOut();
      setLoggingIn(false);
      Alert.alert(
        'Pending approval',
        'Your account is registered and waiting for admin approval.',
        [{ text: 'Continue', onPress: () => router.replace('/pending-approval') }],
      );
      return;
    }

    setLoggingIn(false);
    router.replace(isVendor ? '/vendor/dashboard' : '/customer/dashboard');
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

        <SafeAreaView style={{ flex: 1 }}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView
              contentContainerStyle={styles.contentWrapper}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              showsVerticalScrollIndicator={false}
            >
              
              {/* Top Navigation / Back Button */}
              <Animated.View 
                entering={FadeInDown.delay(100).duration(600).springify()}
                style={styles.topHeader}
              >
                <TouchableOpacity 
                  style={styles.backButton}
                  onPress={() => {
                    if (router.canGoBack()) router.back();
                    else router.replace('/');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>
              </Animated.View>

              {/* Main Form Content */}
              <View style={styles.formContainer}>
                
                <Animated.View entering={FadeInDown.delay(200).duration(800).springify()}>
                  <Text style={styles.title}>Welcome Back</Text>
                  <Text style={styles.subtitle}>Sign in to manage your orders and pickups on ToledoGo</Text>
                </Animated.View>

                <Animated.View 
                  entering={FadeInDown.delay(400).duration(800).springify()}
                  style={styles.inputGroup}
                >
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <TextInput 
                    style={styles.textInput}
                    placeholder="vendor@toledogo.com"
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </Animated.View>

                <Animated.View 
                  entering={FadeInDown.delay(550).duration(800).springify()}
                  style={styles.inputGroup}
                >
                  <Text style={styles.inputLabel}>Password</Text>
                  <TextInput 
                    style={styles.textInput}
                    placeholder="••••••••••••"
                    placeholderTextColor="rgba(255, 255, 255, 0.4)"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                  />
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(650).duration(800).springify()}>
                  <TouchableOpacity
                    style={styles.forgotPasswordLink}
                    activeOpacity={0.7}
                    onPress={() => router.push({
                      pathname: '/forgot-password',
                      params: { email: email.trim() },
                    })}
                  >
                    <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                  </TouchableOpacity>
                </Animated.View>

                {/* Submit Button */}
                <Animated.View 
                  entering={FadeInDown.delay(700).duration(800).springify()}
                  style={styles.buttonWrapper}
                >
                  <TouchableOpacity 
                    style={styles.submitBtn} 
                    activeOpacity={0.9}
                    onPress={handleLogin}
                    disabled={loggingIn}
                  >
                    <LinearGradient
                      colors={['#FFFFFF', '#FFF7ED']}
                      style={styles.btnGradient}
                    >
                      {loggingIn ? <ActivityIndicator color="#451A03" /> : <Text style={styles.btnText}>Sign In</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>

              </View>

              {/* Footer Switch to Register */}
              <Animated.View 
                entering={FadeInDown.delay(850).duration(800).springify()}
                style={styles.footerSection}
              >
                <TouchableOpacity 
                  style={styles.switchLink}
                  activeOpacity={0.7}
                  onPress={() => router.push('/register')}
                >
                  <Text style={styles.switchLinkText}>
                    Don&apos;t have an account? <Text style={styles.highlightText}>Create Account</Text>
                  </Text>
                </TouchableOpacity>
              </Animated.View>

            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1,
    backgroundColor: '#451A03'
  },
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
  contentWrapper: {
    flexGrow: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
    paddingVertical: 16
  },
  topHeader: {
    paddingTop: 10
  },
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 13,
  },
  formContainer: {
    justifyContent: 'center',
    flexGrow: 1,
    flexShrink: 0,
    marginTop: -30
  },
  title: { 
    fontSize: 34, 
    fontWeight: '900', 
    color: '#FFFFFF', 
    marginBottom: 6,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#FED7AA',
    marginBottom: 32,
    lineHeight: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  forgotPasswordLink: {
    alignSelf: 'flex-end',
    marginTop: -12,
    marginBottom: 4,
    paddingVertical: 6,
  },
  forgotPasswordText: {
    color: '#FED7AA',
    fontSize: 13,
    fontWeight: '700',
  },
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
  buttonWrapper: {
    marginTop: 10,
  },
  submitBtn: { 
    borderRadius: 18, 
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 6
  },
  btnGradient: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center'
  },
  btnText: { 
    color: '#451A03', 
    fontSize: 17, 
    fontWeight: '800',
    letterSpacing: 0.5
  },
  footerSection: { 
    alignItems: 'center',
    paddingBottom: 10
  },
  switchLink: { 
    paddingVertical: 6
  },
  switchLinkText: { 
    color: '#FFEDD5', 
    fontSize: 14,
    fontWeight: '500'
  },
  highlightText: {
    fontWeight: '800', 
    color: '#FFFFFF',
    textDecorationLine: 'underline'
  }
});