import { useLocalSearchParams, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import React, { useState, useEffect } from 'react';
import { 
  Dimensions, 
  StatusBar, 
  StyleSheet, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  KeyboardAvoidingView, 
  Platform,
  ScrollView,
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
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { decode } from 'base64-arraybuffer';
// Import the Supabase client
import { supabase } from '../Services/supabase';
import { sanitizePhilippineMobileNumber } from '../utils/phone';
import { getPasswordRequirementsMessage, isStrongPassword } from '../utils/password';
import { getAuthRedirectUrl } from '../utils/authRedirect';
import { vendorSubscriptionPlans, type VendorSubscriptionTier } from '../constants/vendor-subscriptions';

const { width } = Dimensions.get('window');

// Toledo City Center Coordinates & Service Boundary Setup
const TOLEDO_CITY_CENTER = {
  latitude: 10.3788,
  longitude: 123.6425,
};
const MAX_RADIUS_KM = 15;

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of Earth in KM
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

export default function RegisterVendorScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ emailConfirmed?: string }>();

  // Vendor Form States
  const [businessName, setBusinessName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [cuisineSpecialty, setCuisineSpecialty] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [registrationUserId, setRegistrationUserId] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<VendorSubscriptionTier | null>(null);
  
  // Store Type & verification document states
  const [storeType, setStoreType] = useState<'home' | 'physical'>('home');
  const [physicalAddress, setPhysicalAddress] = useState('');
  const [ownerIdImage, setOwnerIdImage] = useState<string | null>(null);
  const [businessIdImage, setBusinessIdImage] = useState<string | null>(null);
  const [permitImage, setPermitImage] = useState<string | null>(null);
  const [storePhoto, setStorePhoto] = useState<string | null>(null);
  const [ownerIdAsset, setOwnerIdAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [businessIdAsset, setBusinessIdAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [permitAsset, setPermitAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [storePhotoAsset, setStorePhotoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [ownerIdType, setOwnerIdType] = useState('image/jpeg');
  const [businessIdType, setBusinessIdType] = useState('image/jpeg');
  const [permitType, setPermitType] = useState('image/jpeg');
  const [storePhotoType, setStorePhotoType] = useState('image/jpeg');

  // Fulfillment capability is selected during registration; admins and vendors
  // configure official meetup hubs and batch times after approval.
  const [fulfillmentMode, setFulfillmentMode] = useState<'instore' | 'meetup' | 'both'>('instore');

  const [step, setStep] = useState<'type' | 'details' | 'documents' | 'plan' | 'email' | 'pending'>('type');

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

  useEffect(() => {
    if (params.emailConfirmed !== 'true') return;
    let active = true;
    const restoreConfirmedRegistration = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error || !data.user || data.user.user_metadata?.role !== 'vendor') {
        Alert.alert('Could not continue registration', 'The confirmed vendor account could not be restored. Please sign in and contact support if needed.');
        router.replace('/login');
        return;
      }
      const metadata = data.user.user_metadata;
      setRegistrationUserId(data.user.id);
      setEmailVerified(true);
      setBusinessName(typeof metadata.business_name === 'string' ? metadata.business_name : '');
      setOwnerName(typeof metadata.owner_name === 'string' ? metadata.owner_name : '');
      setEmail(data.user.email ?? '');
      setPhone(typeof metadata.phone === 'string' ? metadata.phone : '');
      setPhysicalAddress(typeof metadata.physical_address === 'string' ? metadata.physical_address : '');
      setCuisineSpecialty(typeof metadata.cuisine_specialty === 'string' ? metadata.cuisine_specialty : '');
      setSelectedPlan(metadata.registration_plan === 'pro' ? 'pro' : 'free');
      setStoreType(metadata.store_type === 'physical' ? 'physical' : 'home');
      setFulfillmentMode(metadata.fulfillment_mode === 'instore' || metadata.fulfillment_mode === 'both' ? metadata.fulfillment_mode : 'meetup');
      setOwnerIdImage(null);
      setOwnerIdAsset(null);
      setBusinessIdImage(null);
      setBusinessIdAsset(null);
      setPermitImage(null);
      setPermitAsset(null);
      setStorePhoto(null);
      setStorePhotoAsset(null);
      setStep('documents');
      Alert.alert('Email confirmed', 'Please reselect your verification photos, then submit your vendor application.');
    };
    void restoreConfirmedRegistration();
    return () => { active = false; };
  }, [params.emailConfirmed, router]);

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

  const pickOwnerId = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setOwnerIdImage(result.assets[0].uri);
      setOwnerIdAsset(result.assets[0]);
      setOwnerIdType(result.assets[0].mimeType ?? 'image/jpeg');
    }
  };

  const pickBusinessId = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets?.[0]) {
      setBusinessIdImage(result.assets[0].uri);
      setBusinessIdAsset(result.assets[0]);
      setBusinessIdType(result.assets[0].mimeType ?? 'image/jpeg');
    }
  };

  const pickPermit = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setPermitImage(result.assets[0].uri);
      setPermitAsset(result.assets[0]);
      setPermitType(result.assets[0].mimeType ?? 'image/jpeg');
    }
  };

  const pickStorePhoto = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      setStorePhoto(result.assets[0].uri);
      setStorePhotoAsset(result.assets[0]);
      setStorePhotoType(result.assets[0].mimeType ?? 'image/jpeg');
    }
  };

  const uploadVerificationFile = async (asset: ImagePicker.ImagePickerAsset, userId: string, fileType: string, contentType: string) => {
    if (!asset) {
      throw new Error(`${fileType} image was not selected. Please choose the image again.`);
    }

    let file: Blob | ArrayBuffer;
    if (asset.file) {
      file = asset.file;
    } else if (asset.base64) {
      file = decode(asset.base64);
    } else {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error('The selected image could not be read. Please choose it again.');
      file = await response.blob();
    }

    const fileSize = file instanceof Blob ? file.size : file.byteLength;
    if (!contentType.startsWith('image/') || fileSize < 100) {
      throw new Error('The selected file is not a valid image. Please choose a JPG or PNG photo.');
    }

    const extension = contentType.split('/')[1] || 'jpg';
    const path = `${userId}/${fileType}-${Date.now()}.${extension}`;
    const { error } = await supabase.storage.from('vendor-verification').upload(path, file, {
      contentType,
      upsert: false,
    });

    if (error) {
      throw new Error(`Storage upload failed for ${fileType}: ${error.message} (code: ${error.name || 'unknown'})`);
    }
    return path;
  };

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message);
    return String(error);
  };

  const finishVendorApplication = async (userId: string) => {
    if (!ownerIdAsset || !businessIdAsset || (storeType === 'physical' && (!permitAsset || !storePhotoAsset))) {
      setStep('documents');
      Alert.alert(
        'Verification documents required',
        'Please select the owner ID and business registration document again, plus the permit and store photo for a physical store.',
      );
      return;
    }
    const ownerIdDocument = ownerIdAsset;
    const businessIdDocument = businessIdAsset;
    const permitDocument = permitAsset;
    const storePhotoDocument = storePhotoAsset;

    let registrationStep = 'saving your selected plan';
    const uploadedVerificationPaths: string[] = [];
    setIsSubmitting(true);
    try {
      if (!selectedPlan) throw new Error('Please choose a vendor plan before submitting your application.');
      const { error: planError } = await supabase.auth.updateUser({
        data: { registration_plan: selectedPlan },
      });
      if (planError) throw planError;

      registrationStep = 'uploading your verification document';
      const ownerIdPath = await uploadVerificationFile(ownerIdDocument, userId, 'owner-id', ownerIdType);
      uploadedVerificationPaths.push(ownerIdPath);
      const businessIdPath = await uploadVerificationFile(businessIdDocument, userId, 'business-id', businessIdType);
      uploadedVerificationPaths.push(businessIdPath);
      let permitPath: string | null = null;
      if (storeType === 'physical') {
        if (!permitDocument) throw new Error('Please select the business permit again.');
        permitPath = await uploadVerificationFile(permitDocument, userId, 'permit', permitType);
      }
      if (permitPath) uploadedVerificationPaths.push(permitPath);
      const storePhotoPath = storePhotoDocument
        ? await uploadVerificationFile(storePhotoDocument, userId, 'store-photo', storePhotoType)
        : null;
      if (storePhotoPath) uploadedVerificationPaths.push(storePhotoPath);

      registrationStep = 'saving your vendor application';
      const { error: vendorInsertError } = await supabase.from('vendors').insert({
        id: userId,
        business_name: businessName.trim(),
        owner_name: ownerName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        store_type: storeType,
        physical_address: physicalAddress.trim() || null,
        fulfillment_mode: fulfillmentMode,
        meetup_details: null,
        cuisine_specialty: cuisineSpecialty.trim(),
        owner_id_url: ownerIdPath,
        business_id_url: businessIdPath,
        permit_url: permitPath,
        store_photo_url: storePhotoPath,
        verification_status: 'pending',
        admin_notes: null,
        is_verified: false,
      });
      if (vendorInsertError) throw vendorInsertError;

      setEmailVerified(true);
      setStep('pending');
    } catch (error) {
      if (uploadedVerificationPaths.length > 0) {
        const { error: cleanupError } = await supabase.storage.from('vendor-verification').remove(uploadedVerificationPaths);
        if (cleanupError) console.error('Could not remove incomplete vendor verification uploads:', cleanupError);
      }
      setRegistrationUserId(userId);
      setEmailVerified(true);
      setStep('plan');
      console.error(`VENDOR REGISTRATION FAILED while ${registrationStep}:`, error);
      Alert.alert('Registration Error', `Could not finish ${registrationStep}. ${getErrorMessage(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendConfirmation = async () => {
    setIsSubmitting(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
        options: { emailRedirectTo: getAuthRedirectUrl('auth/confirm') },
      });
      if (error) throw error;
      Alert.alert('Confirmation email sent', `A new confirmation link was sent to ${email.trim()}.`);
    } catch (error) {
      Alert.alert('Could not resend confirmation', getErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInitialSubmit = async () => {
    if (isSubmitting) return;
    if (!selectedPlan) {
      Alert.alert('Choose a Plan', 'Select either Free / Basic or Pro / Storefront to continue.');
      return;
    }
    if (registrationUserId) {
      if (emailVerified) void finishVendorApplication(registrationUserId);
      else setStep('email');
      return;
    }

    if (!businessName || !ownerName || !email || !phone || !password || !cuisineSpecialty) {
      Alert.alert('Incomplete Fields', 'Please complete all required business details.');
      return;
    }

    if (!isStrongPassword(password)) {
      Alert.alert(
        'Choose a stronger password',
        getPasswordRequirementsMessage(password) ?? 'Choose a stronger password to protect your vendor account.'
      );
      return;
    }

    if (!physicalAddress) {
      Alert.alert(
        'Address Required',
        storeType === 'home'
          ? 'Please enter your home kitchen address in Toledo City.'
          : 'Please enter your physical store address or market stall in Toledo City.'
      );
      return;
    }

    if (!validatePhoneNumber(phone)) {
      Alert.alert('Invalid Phone Number', 'Please enter a valid 11-digit Philippine mobile number starting with 09.');
      return;
    }

    if (!validateEmailAddress(email)) {
      Alert.alert('Invalid Email Address', 'Please enter a valid email address, such as name@example.com.');
      return;
    }

    try {
      const existingContact = await checkForExistingContact(email, phone);
      if (existingContact) {
        Alert.alert('Contact Already in Use', 'This email address or mobile number is already registered. Please use a different one or sign in instead.');
        return;
      }
    } catch (error: any) {
      console.error('CONTACT CHECK ERROR:', error);
      Alert.alert('Registration Error', 'We could not verify whether this contact is already in use. Please try again.');
      return;
    }

    if (storeType === 'physical') {
      if (!storePhoto) {
        Alert.alert('Store Photo Required', 'Please upload a photo of your physical store/stall for admin verification.');
        return;
      }
    }

    if (!ownerIdImage) {
      Alert.alert('Owner ID Required', 'Please upload a valid government-issued ID for the owner.');
      return;
    }

    if (!businessIdImage) {
      Alert.alert('Business ID Required', 'Please upload your business registration document, such as a DTI, SEC, or CDA certificate.');
      return;
    }

    if (storeType === 'physical' && !permitImage) {
      Alert.alert('Business Permit Required', 'Please upload your Toledo business permit or DTI certificate.');
      return;
    }

    if (!validatePhoneNumber(phone)) {
      Alert.alert('Invalid Phone Number', 'Please enter a valid 11-digit Philippine mobile number starting with 09.');
      return;
    }

    setIsSubmitting(true);

    // --- AUTOMATIC LOCATION VERIFICATION ---
    let currentLat = 10.3768;
    let currentLng = 123.6384;

    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location access is required to verify that your kitchen is within Toledo City.');
        setIsSubmitting(false);
        return;
      }

      let location = null;
      try {
        location = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 6000))
        ]) as Location.LocationObject;
      } catch {
        location = await Location.getLastKnownPositionAsync();
      }

      if (location && location.coords) {
        currentLat = location.coords.latitude;
        currentLng = location.coords.longitude;
      }
    } catch {
      Alert.alert('Location Warning', 'Could not detect exact GPS. Using default Toledo service zone center.');
    }

    // --- TOLEDO CITY BOUNDARY RADIUS VERIFICATION ---
    const distance = calculateDistance(
      currentLat, 
      currentLng, 
      TOLEDO_CITY_CENTER.latitude, 
      TOLEDO_CITY_CENTER.longitude
    );

    if (distance > MAX_RADIUS_KM) {
      Alert.alert(
        'Outside Service Area',
        `Your current location is about ${distance.toFixed(1)}km away from Toledo City center. ToledoGo vendor accounts are restricted to local service zones within ${MAX_RADIUS_KM}km.`
      );
      setIsSubmitting(false);
      return;
    }

    console.log('GPS location verified:', JSON.stringify({
      latitude: currentLat,
      longitude: currentLng,
      distanceFromToledoCenterKm: Number(distance.toFixed(2)),
      maxAllowedDistanceKm: MAX_RADIUS_KM,
    }, null, 2));

    try {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
        options: {
          emailRedirectTo: getAuthRedirectUrl('auth/confirm'),
          data: {
            role: 'vendor',
            business_name: businessName.trim(),
            owner_name: ownerName.trim(),
            phone: phone.trim(),
            store_type: storeType,
            physical_address: physicalAddress.trim(),
            fulfillment_mode: fulfillmentMode,
            cuisine_specialty: cuisineSpecialty.trim(),
            registration_plan: selectedPlan,
          },
        },
      });

      if (signUpError) {
        Alert.alert('Registration Error', signUpError.message);
        return;
      }

      const user = signUpData.user;
      if (!user) {
        Alert.alert('Error', 'No user session returned.');
        return;
      }

      setRegistrationUserId(user.id);
      if (!signUpData.session) {
        setStep('email');
        return;
      }

      setEmailVerified(true);
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: signUpData.session.access_token,
        refresh_token: signUpData.session.refresh_token,
      });
      if (sessionError) {
        throw new Error(`Could not establish the new account session: ${sessionError.message}`);
      }

      const { data: activeUser } = await supabase.auth.getUser();
      if (activeUser.user?.id !== user.id) {
        throw new Error('The new account session is not ready. Please try registration again.');
      }

      await finishVendorApplication(user.id);
    } catch (err: any) {
      const errorMessage = getErrorMessage(err);
      console.error('VENDOR SIGNUP FAILED:', errorMessage, err);
      Alert.alert('Registration Error', errorMessage);
    } finally {
      setIsSubmitting(false);
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

        <SafeAreaView style={{ flex: 1 }}>
          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={{ flex: 1 }}
          >
            <ScrollView 
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              
              <Animated.View
                entering={FadeInDown.delay(100).duration(600).springify()}
                style={styles.topHeader}
              >
                <TouchableOpacity 
                  style={styles.backButton}
                  onPress={() => {
                    if (step === 'type') {
                      if (router.canGoBack()) router.back();
                      else router.replace('/register');
                    } else if (step === 'details') setStep('type');
                    else if (step === 'documents') setStep('details');
                    else if (step === 'plan') setStep('documents');
                    else if (step === 'email') setStep('documents');
                    else if (step === 'pending') router.replace('/login');
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>

                <View style={styles.roleBadge}>
                  <Text style={styles.roleBadgeText}>🍳 Secure Vendor Partner</Text>
                </View>
              </Animated.View>

              <View style={styles.progressRow}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <View
                    key={`vendor-step-${index + 1}`}
                    style={[
                      styles.progressDot,
                      step === 'type' && index === 0 ? styles.progressDotActive :
                      step === 'details' && index <= 1 ? styles.progressDotActive :
                      step === 'documents' && index <= 2 ? styles.progressDotActive :
                      step === 'plan' && index <= 3 ? styles.progressDotActive :
                      step === 'email' && index <= 3 ? styles.progressDotActive :
                      step === 'pending' && index <= 3 ? styles.progressDotActive : styles.progressDotInactive,
                    ]}
                  />
                ))}
              </View>

              {step === 'type' && (
                <>
                  <Animated.View
                    entering={FadeInDown.delay(200).duration(800).springify()}
                    style={styles.headerSection}
                  >
                    <Text style={styles.title}>Choose Your Shop Setup</Text>
                    <Text style={styles.subtitle}>
                      Select whether you operate from home or a physical storefront before moving into your profile details.
                    </Text>
                  </Animated.View>

                  <View style={styles.formContainer}>
                    <Animated.View entering={FadeInDown.delay(220).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Kitchen Operation Type</Text>
                      <View style={styles.cardsContainer}>
                        <TouchableOpacity
                          style={[styles.roleCard, storeType === 'home' && styles.selectedCard]}
                          activeOpacity={0.85}
                          onPress={() => {
                            setStoreType('home');
                            setFulfillmentMode('meetup');
                            setStorePhoto(null);
                            setStorePhotoAsset(null);
                          }}
                        >
                          <View style={styles.iconWrapper}>
                            <Text style={styles.cardEmoji}>🏠</Text>
                          </View>
                          <View style={styles.cardTextContainer}>
                            <Text style={styles.cardTitle}>Home-Based Kitchen</Text>
                            <Text style={styles.cardDesc}>Perfect for registered home kitchens and local batch pickups.</Text>
                          </View>
                          <View style={[styles.radioButton, storeType === 'home' && styles.radioSelected]} />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.roleCard, storeType === 'physical' && styles.selectedCard]}
                          activeOpacity={0.85}
                          onPress={() => {
                            setStoreType('physical');
                            setFulfillmentMode((current) => current === 'meetup' ? 'instore' : current);
                          }}
                        >
                          <View style={styles.iconWrapper}>
                            <Text style={styles.cardEmoji}>🏪</Text>
                          </View>
                          <View style={styles.cardTextContainer}>
                            <Text style={styles.cardTitle}>Physical Store</Text>
                            <Text style={styles.cardDesc}>For storefronts, stalls, or fixed local pickup locations.</Text>
                          </View>
                          <View style={[styles.radioButton, storeType === 'physical' && styles.radioSelected]} />
                        </TouchableOpacity>
                      </View>
                    </Animated.View>
                  </View>

                  <Animated.View entering={FadeInDown.delay(400).duration(800).springify()} style={styles.footerSection}>
                    <TouchableOpacity
                      style={[styles.submitBtn, styles.continueBtn, !storeType && styles.disabledBtn]}
                      activeOpacity={storeType ? 0.9 : 1}
                      onPress={() => setStep('details')}
                      disabled={!storeType}
                    >
                      <LinearGradient
                        colors={storeType ? ['#FFFFFF', '#FFF7ED'] : ['rgba(255,255,255,0.3)', 'rgba(255,255,255,0.2)']}
                        style={[styles.btnGradient, styles.continueGradient]}
                      >
                        <Text style={[styles.btnText, !storeType && styles.disabledBtnText]}>Continue</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </Animated.View>
                </>
              )}

              {step === 'details' && (
                <>
                  <Animated.View
                    entering={FadeInDown.delay(200).duration(800).springify()}
                    style={styles.headerSection}
                  >
                    <Text style={styles.title}>Business Information</Text>
                    <Text style={styles.subtitle}>
                      Add the core details for your {storeType === 'home' ? 'home kitchen' : 'physical shop'} and fulfillment options.
                    </Text>
                  </Animated.View>

                  <View style={styles.formContainer}>
                    <Animated.View entering={FadeInDown.delay(250).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Business / Kitchen Name</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="e.g., Aling Nena's Lutong Bahay"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={businessName}
                        onChangeText={setBusinessName}
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.duration(400).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>
                        {storeType === 'home' ? 'Home Kitchen Address' : 'Physical Store Address / Landmark'}
                      </Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder={storeType === 'home' ? 'e.g., Barangay Tubod, Toledo City' : 'e.g., Stall 12, Toledo Public Market'}
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={physicalAddress}
                        onChangeText={setPhysicalAddress}
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(280).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Order Fulfillment Method</Text>
                      <View style={styles.toggleRow}>
                        <TouchableOpacity 
                          style={[
                            styles.toggleBtn,
                            fulfillmentMode === 'instore' && styles.toggleBtnActive,
                            storeType === 'home' && styles.disabledToggleBtn,
                          ]}
                          onPress={() => {
                            if (storeType === 'home') {
                              Alert.alert('Home kitchen rule', 'Home-based vendors must use meet-up pickup only.');
                              return;
                            }
                            setFulfillmentMode('instore');
                          }}
                          activeOpacity={0.8}
                          disabled={storeType === 'home'}
                        >
                          <Text style={[styles.toggleText, fulfillmentMode === 'instore' && styles.toggleTextActive, storeType === 'home' && styles.disabledToggleText]}>In-Store Pickup</Text>
                          <View style={[styles.fulfillmentRadio, fulfillmentMode === 'instore' && styles.fulfillmentRadioActive]} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={[
                            styles.toggleBtn,
                            fulfillmentMode === 'meetup' && styles.toggleBtnActive,
                            storeType === 'physical' && styles.disabledToggleBtn,
                          ]}
                          onPress={() => {
                            if (storeType === 'physical') {
                              Alert.alert('Physical shop rule', 'Physical stores can choose in-store pickup or both options, not meetup-only.');
                              return;
                            }
                            setFulfillmentMode('meetup');
                          }}
                          activeOpacity={0.8}
                          disabled={storeType === 'physical'}
                        >
                          <Text style={[styles.toggleText, fulfillmentMode === 'meetup' && styles.toggleTextActive, storeType === 'physical' && styles.disabledToggleText]}>Meet-Up Pickup</Text>
                          <View style={[styles.fulfillmentRadio, fulfillmentMode === 'meetup' && styles.fulfillmentRadioActive]} />
                        </TouchableOpacity>

                        <TouchableOpacity 
                          style={[
                            styles.toggleBtn,
                            fulfillmentMode === 'both' && styles.toggleBtnActive,
                            storeType === 'home' && styles.disabledToggleBtn,
                          ]}
                          onPress={() => {
                            if (storeType === 'home') {
                              Alert.alert('Home kitchen rule', 'Home-based vendors must use meet-up pickup only.');
                              return;
                            }
                            setFulfillmentMode('both');
                          }}
                          activeOpacity={0.8}
                          disabled={storeType === 'home'}
                        >
                          <Text style={[styles.toggleText, fulfillmentMode === 'both' && styles.toggleTextActive, storeType === 'home' && styles.disabledToggleText]}>Both Options</Text>
                          <View style={[styles.fulfillmentRadio, fulfillmentMode === 'both' && styles.fulfillmentRadioActive]} />
                        </TouchableOpacity>
                      </View>
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(350).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Owner / Head Chef Full Name</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="e.g., Maria Santos"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={ownerName}
                        onChangeText={setOwnerName}
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(450).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Primary Food Specialty</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="e.g., Humba, Kakanin, Fresh Seafood"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={cuisineSpecialty}
                        onChangeText={setCuisineSpecialty}
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(550).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Business Email (For Verification)</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="kitchen@example.com"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(650).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Contact Mobile Number (11 Digits)</Text>
                      <TextInput 
                        style={styles.textInput}
                        placeholder="09123456789"
                        placeholderTextColor="rgba(255, 255, 255, 0.4)"
                        value={phone}
                        onChangeText={(value) => setPhone(sanitizePhilippineMobileNumber(value))}
                        keyboardType="phone-pad"
                        maxLength={11}
                      />
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(750).duration(800).springify()} style={styles.inputGroup}>
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
                          : 'Protect your store and customer data: use 12+ characters, uppercase and lowercase letters, a number, and a symbol.'}
                      </Text>
                    </Animated.View>

                  </View>

                  <Animated.View entering={FadeInDown.delay(850).duration(800).springify()} style={styles.multiActionRow}>
                    <TouchableOpacity
                      style={[styles.secondaryActionBtn, { marginRight: 10 }]}
                      activeOpacity={0.85}
                      onPress={() => setStep('type')}
                    >
                      <Text style={styles.secondaryActionText}>Back</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.submitBtn}
                      activeOpacity={0.9}
                      onPress={() => {
                        if (!businessName.trim() || !ownerName.trim() || !email.trim() || !phone.trim() || !password.trim()) {
                          Alert.alert('Incomplete Details', 'Please complete all business and owner information before continuing.');
                          return;
                        }

                        if (!validatePhoneNumber(phone)) {
                          Alert.alert('Invalid Phone Number', 'Please enter a valid 11-digit Philippine mobile number starting with 09.');
                          return;
                        }

                        if (!physicalAddress.trim()) {
                          Alert.alert(
                            'Address Required',
                            storeType === 'home'
                              ? 'Please enter your home kitchen address in Toledo City.'
                              : 'Please enter your physical store address or stall landmark.'
                          );
                          return;
                        }

                        if (!isStrongPassword(password)) {
                          Alert.alert(
                            'Choose a stronger password',
                            getPasswordRequirementsMessage(password) ?? 'Choose a stronger password to protect your vendor account.'
                          );
                          return;
                        }

                        setStep('documents');
                      }}
                    >
                      <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                        <Text style={styles.btnText}>Next: Verification</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </Animated.View>
                </>
              )}

              {step === 'documents' && (
                <>
                  <Animated.View
                    entering={FadeInDown.delay(200).duration(800).springify()}
                    style={styles.headerSection}
                  >
                    <Text style={styles.title}>Verification Photos</Text>
                    <Text style={styles.subtitle}>
                      Upload the photos needed for review. After choosing a plan, confirm your email and admins will review your application.
                    </Text>
                  </Animated.View>

                  <View style={styles.formContainer}>
                    <Animated.View entering={FadeInDown.delay(260).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Owner Government ID</Text>
                      <TouchableOpacity
                        style={styles.uploadBox}
                        onPress={pickOwnerId}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.uploadBoxText}>
                          {ownerIdImage ? '✅ Owner ID Attached (Tap to Change)' : '📁 Upload Owner ID'}
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>

                    <Animated.View entering={FadeInDown.delay(300).duration(800).springify()} style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Business Registration ID / Certificate</Text>
                      <TouchableOpacity style={styles.uploadBox} onPress={pickBusinessId} activeOpacity={0.8}>
                        <Text style={styles.uploadBoxText}>
                          {businessIdImage ? '✅ Business ID Attached (Tap to Change)' : '📁 Upload DTI, SEC, or CDA Certificate'}
                        </Text>
                      </TouchableOpacity>
                    </Animated.View>

                    {storeType === 'physical' && (
                      <>
                        <Animated.View entering={FadeInDown.delay(330).duration(800).springify()} style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>Store / Stall Photo</Text>
                          <TouchableOpacity
                            style={styles.uploadBox}
                            onPress={pickStorePhoto}
                            activeOpacity={0.8}
                          >
                            <Text style={styles.uploadBoxText}>
                              {storePhoto ? '✅ Store Photo Attached (Tap to Change)' : '📸 Upload Exterior / Stall Photo'}
                            </Text>
                          </TouchableOpacity>
                        </Animated.View>

                        <Animated.View entering={FadeInDown.delay(390).duration(800).springify()} style={styles.inputGroup}>
                          <Text style={styles.inputLabel}>Business Permit / DTI Certificate</Text>
                          <TouchableOpacity style={styles.uploadBox} onPress={pickPermit} activeOpacity={0.8}>
                            <Text style={styles.uploadBoxText}>
                              {permitImage ? '✅ Business Permit Attached (Tap to Change)' : '📁 Upload Business Permit'}
                            </Text>
                          </TouchableOpacity>
                        </Animated.View>
                      </>
                    )}

                    <Animated.View entering={FadeInDown.delay(460).duration(800).springify()} style={styles.infoCard}>
                      <Text style={styles.infoCardTitle}>Review before submit</Text>
                      <Text style={styles.infoCardText}>• Shop type: {storeType === 'home' ? 'Home-based kitchen' : 'Physical store'}</Text>
                      <Text style={styles.infoCardText}>• Address: {physicalAddress || 'Not added yet'}</Text>
                      <Text style={styles.infoCardText}>• Fulfillment: {fulfillmentMode}</Text>
                    </Animated.View>
                  </View>

                  <Animated.View entering={FadeInDown.delay(550).duration(800).springify()} style={styles.multiActionRow}>
                    <TouchableOpacity
                      style={[styles.secondaryActionBtn, { marginRight: 10 }]}
                      activeOpacity={0.85}
                      onPress={() => setStep('details')}
                    >
                      <Text style={styles.secondaryActionText}>Back</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.submitBtn}
                      activeOpacity={0.9}
                      onPress={() => setStep('plan')}
                    >
                      <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                        <Text style={styles.btnText}>Next: Choose a Plan</Text>
                      </LinearGradient>
                    </TouchableOpacity>
                  </Animated.View>
                </>
              )}

              {step === 'plan' && (
                <>
                  <Animated.View
                    entering={FadeInDown.delay(200).duration(800).springify()}
                    style={styles.headerSection}
                  >
                    <Text style={styles.title}>Choose Your Vendor Plan</Text>
                    <Text style={styles.subtitle}>
                      Select the plan that fits your shop. New vendor accounts start on Free while your application is reviewed.
                    </Text>
                  </Animated.View>

                  <View style={styles.planCardsContainer}>
                    <TouchableOpacity
                      style={[styles.planChoiceCard, selectedPlan === 'free' && styles.selectedPlanCard]}
                      activeOpacity={0.85}
                      onPress={() => setSelectedPlan('free')}
                    >
                      <View style={styles.planChoiceHeader}>
                        <View style={styles.planChoiceIcon}><Text style={styles.cardEmoji}>🆓</Text></View>
                        <View style={styles.planChoiceHeading}>
                          <Text style={styles.cardTitle}>{vendorSubscriptionPlans.free.name}</Text>
                          <Text style={styles.planPrice}>₱0 <Text style={styles.planPeriod}>/ month</Text></Text>
                        </View>
                        <View style={[styles.radioButton, selectedPlan === 'free' && styles.radioSelected]} />
                      </View>
                      <Text style={styles.planDescription}>{vendorSubscriptionPlans.free.description}</Text>
                      <Text style={styles.planFeature}>✓ Up to {vendorSubscriptionPlans.free.maxItems} menu listings</Text>
                      <Text style={styles.planFeature}>✓ {vendorSubscriptionPlans.free.batchCapacity} active pickup schedule</Text>
                      <Text style={styles.planFeature}>✓ Standard marketplace listing</Text>
                      <Text style={styles.planFeature}>✓ Upgrade to Pro after approval for Quick POS</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.planChoiceCard, selectedPlan === 'pro' && styles.selectedPlanCard]}
                      activeOpacity={0.85}
                      onPress={() => setSelectedPlan('pro')}
                    >
                      <View style={styles.planChoiceHeader}>
                        <View style={styles.planChoiceIcon}><Text style={styles.cardEmoji}>⭐</Text></View>
                        <View style={styles.planChoiceHeading}>
                          <Text style={styles.cardTitle}>{vendorSubscriptionPlans.pro.name}</Text>
                          <Text style={styles.planPrice}>₱{vendorSubscriptionPlans.pro.monthlyPrice} <Text style={styles.planPeriod}>/ month</Text></Text>
                        </View>
                        <View style={[styles.radioButton, selectedPlan === 'pro' && styles.radioSelected]} />
                      </View>
                      <Text style={styles.planDescription}>{vendorSubscriptionPlans.pro.description}</Text>
                      <Text style={styles.planFeature}>✓ Up to {vendorSubscriptionPlans.pro.maxItems} menu listings</Text>
                      <Text style={styles.planFeature}>✓ Quick POS for in-store sales</Text>
                      <Text style={styles.planFeature}>✓ Priority marketplace listing</Text>
                      <Text style={styles.planFeature}>✓ Up to {vendorSubscriptionPlans.pro.batchCapacity} active pickup schedules</Text>
                      <Text style={styles.planPaymentNote}>
                        No payment is taken during registration. After approval, upgrade for ₱{vendorSubscriptionPlans.pro.monthlyPrice}/month with manual renewal and no automatic charges.
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Animated.View entering={FadeInDown.delay(550).duration(800).springify()} style={styles.multiActionRow}>
                    <TouchableOpacity
                      style={[styles.secondaryActionBtn, { marginRight: 10 }]}
                      activeOpacity={0.85}
                      onPress={() => setStep('documents')}
                    >
                      <Text style={styles.secondaryActionText}>Back</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.submitBtn, (!selectedPlan || isSubmitting) && styles.disabledBtn]}
                      activeOpacity={selectedPlan && !isSubmitting ? 0.9 : 1}
                      onPress={handleInitialSubmit}
                      disabled={!selectedPlan || isSubmitting}
                    >
                      <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                        {isSubmitting
                          ? <ActivityIndicator color="#451A03" />
                          : <Text style={styles.btnText}>{selectedPlan === 'pro' ? 'Continue with Pro' : 'Continue with Free'}</Text>}
                      </LinearGradient>
                    </TouchableOpacity>
                  </Animated.View>
                </>
              )}

              {step === 'email' && (
                <Animated.View entering={FadeInDown.duration(600).springify()} style={styles.emailContainer}>
                  <View style={styles.emailIcon}>
                    <Feather name="mail" size={30} color="#9A3412" />
                  </View>
                  <Text style={[styles.title, styles.emailTitle]}>Confirm your email</Text>
                  <Text style={[styles.subtitle, styles.emailSubtitle]}>
                    Open the confirmation link sent to{' '}
                    <Text style={styles.emailAddress}>{email.trim()}</Text>. ToledoGo will return here after your email is confirmed.
                  </Text>
                  <View style={styles.pendingCard}>
                    <Text style={styles.pendingCardTitle}>Your selected plan</Text>
                    <Text style={styles.pendingCardText}>
                      {selectedPlan === 'pro' ? 'Pro / Storefront — ₱199 per month' : 'Free / Basic — no monthly fee'}
                    </Text>
                    <Text style={[styles.pendingCardText, styles.emailPlanNote]}>
                      {selectedPlan === 'pro'
                        ? 'No payment is taken now. After your vendor application is approved, you can subscribe from the Subscription screen.'
                        : 'Your application will start on the Free / Basic plan.'}
                    </Text>
                  </View>
                  <Text style={styles.emailHelpText}>If you don&apos;t see the email, check your spam or junk folder.</Text>
                  <TouchableOpacity
                    style={[styles.submitBtn, styles.emailSubmitBtn, isSubmitting && styles.disabledBtn]}
                    activeOpacity={0.9}
                    onPress={resendConfirmation}
                    disabled={isSubmitting}
                  >
                    <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                      {isSubmitting ? <ActivityIndicator color="#451A03" /> : <Text style={styles.btnText}>Resend confirmation link</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {step === 'pending' && (
                <Animated.View entering={FadeInDown.duration(600).springify()} style={styles.pendingContainer}>
                  <Text style={styles.pendingEmoji}>⏳</Text>
                  <Text style={styles.title}>Pending Admin Approval</Text>
                  <Text style={styles.subtitle}>
                    Thank you for registering <Text style={{color: '#FFF', fontWeight: '700'}}>{businessName}</Text>! Your kitchen zone within Toledo City has been successfully verified. Our administrators are reviewing your permits for marketplace compliance.
                  </Text>
                  {selectedPlan === 'pro' ? (
                    <Text style={styles.selectedPlanNotice}>
                      You selected Pro / Storefront. No payment was taken during registration; after approval, you can upgrade for ₱199/month from your Subscription screen.
                    </Text>
                  ) : null}

                  <View style={styles.pendingCard}>
                    <Text style={styles.pendingCardTitle}>What happens next?</Text>
                    <Text style={styles.pendingCardText}>• Admins verify your permits or clearance.</Text>
                    <Text style={styles.pendingCardText}>• Your store location is auto-mapped.</Text>
                    <Text style={styles.pendingCardText}>• You will receive an email once approved to start listing your specialties.</Text>
                  </View>

                  <TouchableOpacity 
                    style={[styles.submitBtn, {marginTop: 25}]} 
                    activeOpacity={0.9}
                    onPress={() => router.replace('/login')}
                  >
                    <LinearGradient colors={['#FFFFFF', '#FFF7ED']} style={styles.btnGradient}>
                      <Text style={styles.btnText}>Back to Sign In</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </Animated.View>
              )}

              {(step === 'type' || step === 'details' || step === 'documents' || step === 'plan') && (
                <Animated.View entering={FadeInDown.delay(950).duration(800).springify()} style={styles.footerSection}>
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
              )}

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
  title: { fontSize: 28, fontWeight: '900', color: '#FFFFFF', marginBottom: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: '#FED7AA', lineHeight: 18 },
  formContainer: { marginBottom: 10 },
  cardsContainer: {
    gap: 12,
    width: '100%',
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(69, 26, 3, 0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 18,
    padding: 16,
    width: '100%',
  },
  planCardsContainer: {
    gap: 12,
    width: '100%',
    marginBottom: 10,
  },
  planChoiceCard: {
    backgroundColor: 'rgba(69, 26, 3, 0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 18,
    padding: 16,
    width: '100%',
  },
  selectedPlanCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: '#FFFFFF',
  },
  planChoiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  planChoiceIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: 'rgba(69, 26, 3, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  planChoiceHeading: {
    flex: 1,
  },
  planPrice: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    marginTop: 3,
  },
  planPeriod: {
    color: '#FDE7D3',
    fontSize: 12,
    fontWeight: '600',
  },
  planDescription: {
    color: '#FDE7D3',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 9,
  },
  planFeature: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 20,
  },
  planPaymentNote: {
    color: '#FED7AA',
    fontSize: 11,
    lineHeight: 17,
    marginTop: 9,
  },
  selectedPlanNotice: {
    color: '#FFFFFF',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
  },
  selectedCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderColor: '#FFFFFF',
  },
  iconWrapper: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(69, 26, 3, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  cardEmoji: {
    fontSize: 24,
  },
  cardTextContainer: {
    flex: 1,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  cardDesc: {
    color: '#FDE7D3',
    fontSize: 12,
    lineHeight: 18,
  },
  radioButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.75)',
    backgroundColor: 'transparent',
    marginLeft: 10,
  },
  radioSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 10,
  },
  toggleBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 7,
  },
  toggleBtnActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  disabledToggleBtn: {
    opacity: 0.45,
  },
  toggleText: {
    color: '#FED7AA',
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },
  toggleTextActive: {
    color: '#451A03',
  },
  disabledToggleText: {
    color: '#FCD9BA',
  },
  fulfillmentRadio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
    backgroundColor: 'transparent',
  },
  fulfillmentRadioActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#451A03',
  },
  uploadBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    borderStyle: 'dashed'
  },
  uploadBoxText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14,
  },
  otpContainer: { marginTop: 20, flex: 1, justifyContent: 'center' },
  pendingContainer: { marginTop: 20, flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 20 },
  emailContainer: { marginTop: 18, alignItems: 'center', paddingVertical: 12 },
  emailIcon: {
    width: 62,
    height: 62,
    borderRadius: 21,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 15,
  },
  emailTitle: { textAlign: 'center' },
  emailSubtitle: { textAlign: 'center', marginBottom: 16 },
  emailAddress: { color: '#FFFFFF', fontWeight: '800' },
  emailPlanNote: { marginTop: 5 },
  emailHelpText: { color: '#FED7AA', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 14 },
  emailSubmitBtn: { flex: 0, alignSelf: 'stretch', marginTop: 16 },
  pendingEmoji: { fontSize: 50, marginBottom: 15, textAlign: 'center' },
  pendingCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    marginTop: 20,
  },
  pendingCardTitle: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginBottom: 8 },
  pendingCardText: { color: '#FED7AA', fontSize: 13, lineHeight: 20 },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 11, fontWeight: '700', color: '#FFEDD5', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#FFFFFF',
    fontSize: 15,
  },
  helperText: { fontSize: 10, color: '#FED7AA', marginTop: 6, marginLeft: 4, textAlign: 'center' },
  buttonWrapper: { marginTop: 10 },
  multiActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 10,
  },
  secondaryActionBtn: {
    flex: 0.32,
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
  },
  infoCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
  },
  infoCardTitle: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
    marginBottom: 8,
  },
  infoCardText: {
    color: '#FDE68A',
    fontSize: 12,
    lineHeight: 20,
  },
  disabledBtn: {
    opacity: 0.5,
  },
  disabledBtnText: {
    color: '#E7E5E4',
  },
  submitBtn: { 
    flex: 1,
    borderRadius: 18, 
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 6
  },
  continueBtn: {
    width: '100%',
    minHeight: 0,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.24,
    shadowRadius: 9,
    elevation: 5,
  },
  btnGradient: { paddingVertical: 18, alignItems: 'center', justifyContent: 'center' },
  continueGradient: { paddingVertical: 12 },
  btnText: { color: '#451A03', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  footerSection: { alignItems: 'center', paddingVertical: 10 },
  switchLink: { paddingVertical: 6 },
  switchLinkText: { color: '#FFEDD5', fontSize: 14, fontWeight: '500' },
  highlightText: { fontWeight: '800', color: '#FFFFFF', textDecorationLine: 'underline' }
});