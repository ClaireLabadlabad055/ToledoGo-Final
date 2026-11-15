import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../Services/supabase';

type ConfirmationParams = Record<string, string | string[]>;

const getRouteParam = (params: ConfirmationParams, key: string) => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

const hasConfirmationCredentials = (url: string | null, routeParams: ConfirmationParams) => {
  const parsedUrl = url ? new URL(url) : null;
  const query = new URLSearchParams(parsedUrl?.search ?? '');
  const hash = new URLSearchParams(parsedUrl?.hash.replace(/^#/, '') ?? '');
  return ['access_token', 'refresh_token', 'code', 'token_hash', 'error', 'error_description']
    .some((key) => Boolean(query.get(key) ?? hash.get(key) ?? getRouteParam(routeParams, key)));
};

const establishSession = async (url: string | null, routeParams: ConfirmationParams) => {
  const parsedUrl = url ? new URL(url) : null;
  const params = new URLSearchParams(parsedUrl?.search ?? '');
  const hashParams = new URLSearchParams(parsedUrl?.hash.replace(/^#/, '') ?? '');
  const getValue = (key: string) => params.get(key) ?? hashParams.get(key) ?? getRouteParam(routeParams, key);
  const accessToken = getValue('access_token');
  const refreshToken = getValue('refresh_token');
  const code = getValue('code');
  const tokenHash = getValue('token_hash');
  const tokenType = getValue('type');

  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return;
  }
  if (tokenHash && tokenType && ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'].includes(tokenType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: tokenType,
    });
    if (error) throw error;
    return;
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }
  const description = getValue('error_description') ?? getValue('error');
  throw new Error(description ?? 'The confirmation link is invalid or has expired.');
};

export default function ConfirmEmailScreen() {
  const router = useRouter();
  const routeParams = useLocalSearchParams<ConfirmationParams>();
  const [message, setMessage] = useState('Confirming your email...');
  const [isConfirming, setIsConfirming] = useState(true);
  const routeParamSignature = JSON.stringify(routeParams);

  useEffect(() => {
    let active = true;
    let handled = false;
    const currentRouteParams = JSON.parse(routeParamSignature) as ConfirmationParams;
    const hasRouteConfirmation = ['access_token', 'refresh_token', 'code', 'token_hash', 'error', 'error_description']
      .some((key) => Boolean(getRouteParam(currentRouteParams, key)));

    const completeConfirmation = async (url: string | null) => {
      if (handled) return;
      handled = true;
      try {
        const hasCredentials = hasConfirmationCredentials(url, currentRouteParams);
        if (hasCredentials) await establishSession(url, currentRouteParams);

        const { data, error } = await supabase.auth.getUser();
        if (error) throw error;
        const user = data.user;
        if (!user) {
          if (active) {
            setIsConfirming(false);
            setMessage('This link opened ToledoGo without signing the app in. If the email page said confirmation succeeded, sign in with that email and password to finish customer registration.');
          }
          return;
        }

        if (user.user_metadata?.role === 'vendor') {
          router.replace({ pathname: '/register-vendor', params: { emailConfirmed: 'true' } });
          return;
        }
        if (user.user_metadata?.role !== 'customer') {
          throw new Error('The confirmed account does not have a valid registration role.');
        }

        const metadata = user.user_metadata;
        const { error: profileError } = await supabase.from('customers').upsert({
          id: user.id,
          full_name: typeof metadata.full_name === 'string' ? metadata.full_name : '',
          email: user.email ?? '',
          phone: typeof metadata.phone === 'string' ? metadata.phone : '',
          is_verified: false,
        });
        if (profileError) throw profileError;
        router.replace('/pending-approval');
      } catch (error) {
        console.error('Email confirmation failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Could not confirm this email.';
        if (active) {
          setIsConfirming(false);
          setMessage(errorMessage);
        }
      }
    };

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void completeConfirmation(url);
    });
    const processInitialUrl = async () => {
      if (active) {
        setIsConfirming(true);
        setMessage('Confirming your email...');
      }
      try {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl || hasRouteConfirmation) {
          await completeConfirmation(initialUrl);
        } else if (active && !handled) {
          setIsConfirming(false);
          setMessage('The app opened without confirmation details. If you already tapped the email confirmation link, sign in with that email and password to finish customer registration.');
        }
      } catch (error) {
        if (active) {
          setIsConfirming(false);
          setMessage(error instanceof Error ? error.message : 'Could not read the confirmation link. Verify that toledogo://auth/confirm is allowed in Supabase Redirect URLs.');
        }
      }
    };
    void processInitialUrl();
    return () => {
      active = false;
      subscription.remove();
    };
  }, [routeParamSignature, router]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image source={require('../../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
        {isConfirming ? <ActivityIndicator color="#C2410C" size="large" /> : null}
        <Text style={styles.title}>{message}</Text>
        {!isConfirming ? (
          <TouchableOpacity style={styles.signInButton} onPress={() => router.replace('/login')}>
            <Text style={styles.signInButtonText}>Sign in to continue</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF9F2' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  logo: { width: 180, height: 180, marginBottom: 28 },
  title: { marginTop: 18, color: '#292524', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  signInButton: { marginTop: 20, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: '#C2410C' },
  signInButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
});
