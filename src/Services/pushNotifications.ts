import Constants, { AppOwnership } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

let registeredUserId: string | null = null;
let registrationInProgress: Promise<boolean> | null = null;
let registeredPushToken: string | null = null;
let notificationHandlerConfigured = false;
let expoGoWarningShown = false;

export const registerPushNotifications = async (userId: string) => {
  if (registeredUserId === userId) return true;
  if (registrationInProgress) return registrationInProgress;

  registrationInProgress = (async () => {
    if (!Device.isDevice || Platform.OS === 'web') return false;
    if (Constants.appOwnership === AppOwnership.Expo) {
      if (!expoGoWarningShown) {
        console.warn('Remote push notifications require a ToledoGo development build; Expo Go does not include the required native module.');
        expoGoWarningShown = true;
      }
      return false;
    }

    const Notifications = await import('expo-notifications');
    if (!notificationHandlerConfigured) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
      notificationHandlerConfigured = true;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'ToledoGo updates',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#C2410C',
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== 'granted') return false;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) throw new Error('Expo EAS project ID is missing from app configuration.');

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const { error } = await supabase.functions.invoke('push-notifications', {
      body: { event: 'register', expo_push_token: token },
    });
    if (error) throw error;

    registeredPushToken = token;
    registeredUserId = userId;
    return true;
  })();

  try {
    return await registrationInProgress;
  } finally {
    registrationInProgress = null;
  }
};

export const unregisterPushNotifications = async (accessToken: string) => {
  if (!registeredPushToken) return;
  const { error } = await supabase.functions.invoke('push-notifications', {
    body: { event: 'unregister', expo_push_token: registeredPushToken },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) throw error;
  registeredPushToken = null;
  registeredUserId = null;
};
