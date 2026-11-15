import Constants, { AppOwnership } from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

export const getAuthRedirectUrl = (path: 'auth/confirm' | 'reset-password') => {
  if (Constants.appOwnership === AppOwnership.Expo || Platform.OS === 'web') {
    return Linking.createURL(path);
  }

  return `toledogo://${path}`;
};
