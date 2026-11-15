import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useEffect } from 'react';
import { 
  Dimensions, 
  ActivityIndicator,
  StatusBar, 
  StyleSheet, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  Image,
  KeyboardAvoidingView, 
  Platform,
  ScrollView,
  Alert 
} from 'react-native';
import Animated, { 
  FadeInDown, 
  useAnimatedStyle, 
  useSharedValue, 
  withRepeat, 
  withTiming, 
  Easing 
} from 'react-native-reanimated';

// Import location services and expo-location for manual capture
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
// Import the Supabase client
import { supabase } from '../Services/supabase';
import { sanitizePhilippineMobileNumber } from '../utils/phone';
import { getPasswordRequirementsMessage, isStrongPassword } from '../utils/password';

const { width } = Dimensions.get('window');

export default function RegisterVendorFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  
  const role = (params.role as string) || 'vendor';
  const isVendor = role === 'vendor';

  // Form states (Preserving all your original fields + GPS states)
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  
  // Registration step state for a cleaner 2-step flow
  const [step, setStep] = useState<'details' | 'documents'>('details');
  const [customerIdAsset, setCustomerIdAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const totalSteps = 2;
  const currentStep = step === 'details' ? 1 : 2;

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

  // Validate Philippine Mobile Number (Must start with 09 and be exactly 11 digits)
  const validatePhoneNumber = (number: string) => {
    const phMobileRegex = /^09\d{9}$/;
    return phMobileRegex.test(number);
  };

  const validateEmailAddress = (emailValue: string) => {
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/;
    return emailRegex.test(emailValue.trim());
  };

  const normalizePhoneNumber = (number: string) => {
    const digits = number.replace(/\D/g, '');
    return digits.startsWith('63') ? `0${digits.slice(2)}` : digits;
  };

  const checkForExistingContact = async (emailValue: string, phoneValue: string) => {
    const normalizedEmail = emailValue.trim().toLowerCase();
    const normalizedPhone = normalizePhoneNumber(phoneValue);

    const [customerEmailCheck, customerPhoneCheck, vendorEmailCheck, vendorPhoneCheck] = await Promise.all([
      supabase.from('customers').select('id').ilike('email', normalizedEmail).limit(1),
      supabase.from('customers').select('id').eq('phone', normalizedPhone).limit(1),
      supabase.from('vendors').select('id').ilike('email', normalizedEmail).limit(1),
      supabase.from('vendors').select('id').eq('phone', normalizedPhone).limit(1),
    ]);

    const foundExisting =
      (customerEmailCheck.data && customerEmailCheck.data.length > 0) ||
      (customerPhoneCheck.data && customerPhoneCheck.data.length > 0) ||
      (vendorEmailCheck.data && vendorEmailCheck.data.length > 0) ||
      (vendorPhoneCheck.data && vendorPhoneCheck.data.length > 0);

    if (customerEmailCheck.error) throw customerEmailCheck.error;
    if (customerPhoneCheck.error) throw customerPhoneCheck.error;
    if (vendorEmailCheck.error) throw vendorEmailCheck.error;
    if (vendorPhoneCheck.error) throw vendorPhoneCheck.error;

    return foundExisting;
  };

  // --- SAFE & NON-BLOCKING MANUAL GPS FETCH HANDLER ---
  const fetchCurrentLocation = async () => {
    try {
      setLocationLoading(true);
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is needed to map your kitchen location in Toledo City.');
        setLocationLoading(false);
        return;
      }

      // Try fetching live high-accuracy position with a safety catch/timeout
      let location = null;
      try {
        location = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
        ]) as Location.LocationObject;
      } catch {
        // Fallback to last known position if live GPS takes too long
        location = await Location.getLastKnownPositionAsync();
      }

      if (location && location.coords) {
        setLatitude(location.coords.latitude);
        setLongitude(location.coords.longitude);
        Alert.alert('GPS Captured Successfully!', `Lat: ${location.coords.latitude.toFixed(4)}, Lng: ${location.coords.longitude.toFixed(4)}`);
      } else {
        // Ultimate fallback to Toledo City center coordinates if GPS fails entirely
        setLatitude(10.3768);
        setLongitude(123.6384);
        Alert.alert('Default Pin Set', 'Could not lock precise GPS signal. Pinned to central Toledo City as a default.');
      }
    } catch {
      Alert.alert('Location Error', 'Unable to retrieve GPS coordinates. Please ensure device location is enabled.');
    } finally {
      setLocationLoading(false);
    }
  };

  const handleContinue = async () => {
    if (!fullName || !email || !phone || !password) {
      Alert.alert('Incomplete Fields', 'Please fill in all required fields to secure your account.');
      return;
    }

    if (!isStrongPassword(password)) {
      Alert.alert('Choose a stronger password', getPasswordRequirementsMessage(password) ?? 'Choose a stronger password.');
      return;
    }

    if (!validatePhoneNumber(phone)) {
      Alert.alert(
        'Invalid Phone Number',
        'To ensure scam prevention, please enter a valid 11-digit Philippine mobile number starting with 09 (e.g., 09123456789).'
      );
      return;
    }

    if (!validateEmailAddress(email)) {
      Alert.alert('Invalid Email Address', 'Please enter a valid email address, such as name@example.com.');
      return;
    }

    try {
      if (await checkForExistingContact(email, phone)) {
        Alert.alert('Contact Already in Use', 'This email address or mobile number is already registered. Please use a different one or sign in instead.');
        return;
      }
    } catch (error) {
      console.error('CONTACT CHECK ERROR:', error);
      Alert.alert('Registration Error', 'We could not verify whether this contact is already in use. Please try again.');
      return;
    }

    if (isVendor && (!latitude || !longitude)) {
      setLatitude(10.3768);
      setLongitude(123.6384);
    }

    setStep('documents');
  };

  const chooseCustomerId = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo access required', 'Allow ToledoGo to access your photos to upload a government-issued ID.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset || !['image/jpeg', 'image/png'].includes(asset.mimeType ?? '') || (asset.fileSize && asset.fileSize > 10 * 1024 * 1024)) {
        Alert.alert('Invalid ID image', 'Choose a valid JPG or PNG image under 10 MB.');
        return;
      }
      setCustomerIdAsset(asset);
    } catch (error) {
      console.error('Could not choose customer ID image:', error);
      Alert.alert('Could not select ID image', error instanceof Error ? error.message : 'Please try selecting the image again.');
    }
  };

  const uploadCustomerId = async (asset: ImagePicker.ImagePickerAsset, userId: string) => {
    if (!asset.base64 || !['image/jpeg', 'image/png'].includes(asset.mimeType ?? '')) {
      throw new Error('The selected ID image is invalid. Please select a JPG or PNG image again.');
    }
    const file = decode(asset.base64);
    if (file.byteLength < 100 || file.byteLength > 10 * 1024 * 1024) {
      throw new Error('The selected ID image must be between 100 bytes and 10 MB.');
    }
    const extension = asset.mimeType === 'image/png' ? 'png' : 'jpg';
    const path = `${userId}/government-id-${Date.now()}.${extension}`;
    const { error } = await supabase.storage
      .from('customer-verification')
      .upload(path, file, { contentType: asset.mimeType, upsert: false });
    if (error) throw new Error(`Could not upload the ID image: ${error.message}`);
    return path;
  };

  const handleCustomerSubmit = async () => {
    if (isSubmitting) return;
    if (!customerIdAsset) {
      Alert.alert('Government ID required', 'Upload at least one clear image of a valid government-issued ID to submit your application.');
      return;
    }

    setIsSubmitting(true);
    let uploadedIdPath: string | null = null;
    try {
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          data: {
            full_name: fullName.trim(),
            phone: phone.trim(),
            role: 'customer',
          },
        },
      });

      if (error) {
        throw error;
      }

      const user = signUpData.user;
      if (!user) {
        throw new Error('Supabase did not return the new account.');
      }

      if (!signUpData.session) {
        Alert.alert(
          'Email confirmation is still enabled',
          'To create the customer approval profile without email verification, ask the project administrator to turn off Confirm email in Supabase Authentication settings. This account was created but no approval profile was saved; remove this test user in Supabase before trying again.',
        );
        return;
      }

      uploadedIdPath = await uploadCustomerId(customerIdAsset, user.id);
      const { error: customerError } = await supabase.from('customers').insert({
        id: user.id,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        government_id_url: uploadedIdPath,
        is_verified: false,
      });
      if (customerError) throw customerError;
      router.replace('/pending-approval');
    } catch (submitError) {
      let cleanupMessage = '';
      if (uploadedIdPath) {
        const { error: cleanupError } = await supabase.storage.from('customer-verification').remove([uploadedIdPath]);
        if (cleanupError) {
          console.error('Could not remove incomplete customer ID upload:', cleanupError);
          cleanupMessage = ` The uploaded ID could not be removed automatically: ${cleanupError.message}`;
        }
      }
      const message = submitError instanceof Error ? submitError.message : 'Unexpected registration error.';
      console.error('CUSTOMER REGISTRATION FAILED:', submitError);
      Alert.alert('Registration failed', `${message}${cleanupMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  /* OTP verification temporarily disabled for testing.
  const handleVerifyOTP = async () => {
    if (otpCode.length < 6) {
      Alert.alert('Invalid Code', 'Please enter the full 6-digit verification code sent to your email and phone.');
      return;
    }

    try {
      const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: otpCode.trim(),
        type: 'signup',
      });

      if (otpError) {
        console.error('FULL CUSTOMER OTP ERROR:', JSON.stringify(otpError, null, 2));
        Alert.alert('Verification Error', otpError.message);
        return;
      }

      const user = otpData.user;
      if (!user) {
        console.error('CUSTOMER SAVE FAILED: No authenticated user was returned.');
        Alert.alert('Database Error', 'Your account was verified, but no authenticated user was available to save the customer record.');
        return;
      }

      const { error: customerUpsertError } = await supabase.from('customers').upsert({
        id: user.id,
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role: role,
        latitude: latitude || 10.3768,
        longitude: longitude || 123.6384,
        is_verified: true,
      });

      if (customerUpsertError) {
        console.error('FULL CUSTOMER UPSERT ERROR:', JSON.stringify(customerUpsertError, null, 2));
        Alert.alert('Database Error', `Failed to save customer record: ${customerUpsertError.message}`);
        return;
      }

      console.log('Customer record successfully saved!', user.id);
    } catch (err) {
      console.error('FULL CUSTOMER SAVE ERROR:', JSON.stringify(err, null, 2));
      Alert.alert('Database Error', 'An unexpected error occurred while saving your customer record.');
      return;
    }

    Alert.alert(
      'Success!',
      'Your account has been security-verified and registered.',
      [
        {
          text: 'GET STARTED',
          onPress: () => {
            router.replace('/pending-approval');
          },
        },
      ]
    );
  };
  */

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
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <ScrollView 
              contentContainerStyle={styles.scrollContent}
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
                    if (step === 'documents') setStep('details');
                    else if (router.canGoBack()) router.back();
                    else router.replace('/register');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>

                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>
                    {isVendor ? '🍳 Vendor Account' : '🛡️ Secure Customer Signup'}
                  </Text>
                </View>
              </Animated.View>

              <View style={styles.progressRow}>
                {Array.from({ length: totalSteps }).map((_, index) => (
                  <View
                    key={`step-${index + 1}`}
                    style={[
                      styles.progressDot,
                      index + 1 <= currentStep ? styles.progressDotActive : styles.progressDotInactive,
                    ]}
                  />
                ))}
              </View>

              {/* STEP 1: ACCOUNT DETAILS */}
              {step === 'details' ? (
                <>
                  <Animated.View 
                    entering={FadeInDown.delay(200).duration(800).springify()}
                    style={styles.headerSection}
                  >
                    <Text style={styles.title}>
                      {isVendor ? 'Create Vendor Account' : 'Create Customer Account'}
                    </Text>
                    <Text style={styles.subtitle}>
                      {isVendor 
                        ? 'Set up your vendor credentials and pin your store location.' 
                        : 'We verify mobile numbers and GPS location to protect customers and vendors.'}
                    </Text>
                  </Animated.View>

                  <View style={styles.formContainer}>
                    <Animated.View entering={FadeInDown.delay(300).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>
                        {isVendor ? 'Business Name' : 'Full Name'}
                      </Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder={isVendor ? "e.g., Aling Nena's Kitchen" : "e.g., Maria Santos"}
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={fullName}
                        onChangeText={setFullName}
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(400).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Email Address</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="name@example.com"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(500).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Mobile Number (11 Digits)</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="09123456789"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={phone}
                        onChangeText={(value) => setPhone(sanitizePhilippineMobileNumber(value))}
                        keyboardType="phone-pad"
                        maxLength={11}
                      />
                      <Text style={styles.helperText}>Must start with 09 (PH Standard)</Text>
                    </Animated.View>

                    {isVendor && (
                      <Animated.View entering={FadeInDown.delay(550).duration(800).springify()} style={styles.inputGroup}>
                        <Text style={styles.inputLabel}>Store / Kitchen GPS Location</Text>
                        <TouchableOpacity 
                          style={[styles.textInput, {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}]}
                          onPress={fetchCurrentLocation}
                          activeOpacity={0.8}
                        >
                          <Text style={{color: latitude ? '#FFFFFF' : 'rgba(255, 255, 255, 0.4)', fontSize: 15}}>
                            {latitude && longitude ? `Pinned: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}` : 'Tap to Capture Current GPS Location'}
                          </Text>
                          <Text style={{color: '#FED7AA', fontWeight: '700'}}>{locationLoading ? 'Locating...' : '📍 Pin'}</Text>
                        </TouchableOpacity>
                        <Text style={styles.helperText}>Required to place your store on the Toledo map.</Text>
                      </Animated.View>
                    )}

                    <Animated.View entering={FadeInDown.delay(600).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Password</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="Create a strong password"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                      />
                      <Text style={styles.helperText}>
                        {password
                          ? getPasswordRequirementsMessage(password) ?? 'Strong password requirements met.'
                          : 'Use 12+ characters, uppercase and lowercase letters, a number, and a symbol.'}
                      </Text>
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(750).duration(800).springify()} style={styles.buttonWrapper}>
                      <TouchableOpacity 
                        style={styles.submitBtn} 
                        activeOpacity={0.9}
                        onPress={handleContinue}
                      >
                        <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                          <Text style={styles.btnText}>Continue to ID Upload</Text>
                        </LinearGradient>
                      </TouchableOpacity>
                    </Animated.View>
                  </View>
                </>
              ) : (
                <Animated.View entering={FadeInDown.duration(600).springify()} style={styles.otpContainer}>
                  <Text style={styles.title}>Upload a Valid ID</Text>
                  <Text style={styles.subtitle}>
                    Upload at least one clear image of a valid government-issued photo ID. An administrator will review it with your application.
                  </Text>

                  <View style={[styles.inputGroup, {marginTop: 20}]}>
                    <Text style={styles.inputLabel}>Customer details</Text>
                    <View style={styles.reviewCard}>
                      <Text style={styles.reviewCardText}>• Name: {fullName}</Text>
                      <Text style={styles.reviewCardText}>• Email: {email}</Text>
                      <Text style={styles.reviewCardText}>• Phone: {phone}</Text>
                    </View>
                  </View>

                  <TouchableOpacity style={styles.idUploadButton} onPress={chooseCustomerId} disabled={isSubmitting}>
                    {customerIdAsset ? (
                      <Image source={{ uri: customerIdAsset.uri }} style={styles.idPreview} resizeMode="cover" />
                    ) : (
                      <Text style={styles.idUploadText}>Choose ID photo</Text>
                    )}
                  </TouchableOpacity>
                  <Text style={styles.helperText}>
                    {customerIdAsset ? `${customerIdAsset.fileName || 'ID image selected'} · ${customerIdAsset.mimeType}` : 'Image only · maximum 10 MB · ID will be stored privately for admin review'}
                  </Text>

                  <TouchableOpacity
                    style={[styles.submitBtn, {marginTop: 20}, isSubmitting && styles.disabledBtn]}
                    activeOpacity={0.9}
                    onPress={handleCustomerSubmit}
                    disabled={isSubmitting}
                  >
                    <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                      {isSubmitting ? <ActivityIndicator color="#451A03" /> : <Text style={styles.btnText}>Create Account</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {/* Footer Switch */}
              <Animated.View entering={FadeInDown.delay(900).duration(800).springify()} style={styles.footerSection}>
                <TouchableOpacity 
                  style={styles.switchLink}
                  activeOpacity={0.7}
                  onPress={() => router.push('/login')}
                >
                  <Text style={styles.switchLinkText}>
                    Already have an account? <Text style={styles.highlightText}>Sign In</Text>
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
  container: { flex: 1, backgroundColor: '#451A03' },
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
  scrollContent: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    flexGrow: 1,
    justifyContent: 'space-between',
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 10,
    marginBottom: 12
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  progressDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  progressDotActive: {
    backgroundColor: '#FFFFFF',
  },
  progressDotInactive: {
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  backButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  backButtonText: { color: '#FFFFFF', fontWeight: '600', fontSize: 13 },
  roleBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  roleBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  headerSection: { marginBottom: 20 },
  title: { fontSize: 30, fontWeight: '900', color: '#FFFFFF', marginBottom: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: '#FED7AA', lineHeight: 18 },
  formContainer: { marginBottom: 10 },
  otpContainer: { marginTop: 20, flex: 1, justifyContent: 'center' },
  idUploadButton: { height: 190, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  idPreview: { width: '100%', height: '100%' },
  idUploadText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  reviewCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 16,
  },
  reviewCardText: {
    color: '#FED7AA',
    fontSize: 13,
    lineHeight: 22,
  },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#FFEDD5', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  textInput: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 15,
  },
  helperText: { fontSize: 10, color: '#FED7AA', marginTop: 4, marginLeft: 4 },
  buttonWrapper: { marginTop: 10 },
  submitBtn: { 
    borderRadius: 18, 
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 6
  },
  disabledBtn: { opacity: 0.65 },
  resendButton: { alignItems: 'center', paddingVertical: 16 },
  resendText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  btnGradient: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#451A03', fontSize: 17, fontWeight: '800', letterSpacing: 0.5 },
  footerSection: { alignItems: 'center', paddingVertical: 10 },
  switchLink: { paddingVertical: 6 },
  switchLinkText: { color: '#FFEDD5', fontSize: 14, fontWeight: '500' },
  highlightText: { fontWeight: '800', color: '#FFFFFF', textDecorationLine: 'underline' }
});