import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { supabase } from '../Services/supabase';
import { registerPushNotifications, unregisterPushNotifications } from '../Services/pushNotifications';

export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  const registeredUserId = useRef<string | null>(null);
  const accessToken = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const registerSession = (session: { access_token: string; user: { id: string } } | null) => {
      if (!session) return;
      accessToken.current = session.access_token;
      if (registeredUserId.current === session.user.id) return;

      registeredUserId.current = session.user.id;
      void registerPushNotifications(session.user.id).then((registered) => {
        if (!registered && registeredUserId.current === session.user.id) registeredUserId.current = null;
      }).catch((error: unknown) => {
        console.error('Could not register device push notifications:', error);
        if (registeredUserId.current === session.user.id) registeredUserId.current = null;
      });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        const previousAccessToken = accessToken.current;
        accessToken.current = null;
        registeredUserId.current = null;
        if (previousAccessToken) {
          setTimeout(() => {
            void unregisterPushNotifications(previousAccessToken).catch((error: unknown) => {
              console.error('Could not unregister device push notifications:', error);
            });
          }, 0);
        }
        return;
      }

      setTimeout(() => {
        if (mounted) registerSession(session);
      }, 0);
    });

    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        console.error('Could not load session for push notifications:', error);
        return;
      }
      if (mounted) registerSession(data.session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <Stack
        initialRouteName="index"
        screenOptions={{ 
          headerShown: false, // Hides the default header bar on all screens
          animation: 'fade',
          contentStyle: { backgroundColor: '#451A03' } // Matches your warm brown theme
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="auth/confirm" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="reset-password" />
      </Stack>
    </>
  );
}