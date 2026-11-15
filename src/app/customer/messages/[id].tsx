import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../../Services/supabase';
import OrderMessageCard from '../../../components/OrderMessageCard';

type Message = { id: string; sender_id: string; body: string; created_at: string; is_system: boolean };

export default function CustomerMessageThreadScreen() {
  const router = useRouter();
  const { id, vendorName } = useLocalSearchParams<{ id: string; vendorName?: string }>();
  const conversationId = Array.isArray(id) ? id[0] : id;
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    if (!conversationId) return;
    try {
      setError(null);
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { router.replace('/login'); return; }
      setUserId(userData.user.id);
      const { data, error: messageError } = await supabase.from('messages').select('id, sender_id, body, created_at, is_system').eq('conversation_id', conversationId).order('created_at', { ascending: true });
      if (messageError) throw messageError;
      setMessages((data ?? []) as Message[]);
      await supabase.from('messages').update({ read_at: new Date().toISOString() }).eq('conversation_id', conversationId).neq('sender_id', userData.user.id).is('read_at', null);
    } catch (loadError: any) {
      setError(loadError.message ?? 'Unable to load this conversation. Run messaging.sql in Supabase first.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [conversationId, router]);

  useEffect(() => {
    let isMounted = true;
    const runLoad = async () => { await loadMessages(); if (!isMounted) return; };
    runLoad();
    if (!conversationId) return () => { isMounted = false; };
    const channel = supabase
      .channel(`conversation-${conversationId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, loadMessages)
      .subscribe();
    return () => { isMounted = false; void supabase.removeChannel(channel); };
  }, [conversationId, loadMessages]);

  const sendMessage = async () => {
    const body = draft.trim();
    if (!body || !conversationId || !userId || sending) return;
    setSending(true);
    try {
      const { data, error: sendError } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: userId, body }).select('id, sender_id, body, created_at').single();
      if (sendError) throw sendError;
      setMessages((current) => [...current, data as Message]);
      setDraft('');
    } catch (sendError: any) {
      setError(sendError.message ?? 'Unable to send your message.');
    } finally { setSending(false); }
  };

  return <View style={styles.container}><StatusBar barStyle="light-content" backgroundColor="#7C2D12" /><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboardArea}><SafeAreaView style={styles.safeArea}>
    <View style={styles.header}><TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Back"><Feather name="arrow-left" size={19} color="#292524" /></TouchableOpacity><View style={styles.headerCopy}><Text style={styles.eyebrow}>TOLEDOGO MESSAGES</Text><Text style={styles.title}>{vendorName || 'Vendor'}</Text><Text style={styles.subtitle}>Ask about custom orders, bookings, or bulk trays.</Text></View><Feather name="message-circle" size={25} color="#FED7AA" /></View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {loading ? <ActivityIndicator color="#C2410C" style={styles.loader} /> : <ScrollView style={styles.messageList} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMessages(); }} tintColor="#C2410C" />}>
      {messages.length === 0 ? <View style={styles.empty}><Feather name="send" size={28} color="#C2410C" /><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptyText}>Ask about availability, custom flavors, party trays, lead times, or pickup details.</Text></View> : messages.map((message) => message.is_system && message.body.startsWith('TOLEDOGO_ORDER_CARD:') ? <OrderMessageCard key={message.id} orderId={message.body.slice('TOLEDOGO_ORDER_CARD:'.length)} role="customer" /> : message.is_system ? <View key={message.id} style={styles.systemMessage}><Text style={styles.systemLabel}>TOLEDOGO UPDATE</Text><Text style={styles.systemMessageText}>{message.body}</Text><Text style={styles.systemTime}>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text></View> : <View key={message.id} style={[styles.messageBubble, message.sender_id === userId ? styles.myMessage : styles.theirMessage]}><Text style={[styles.messageText, message.sender_id === userId && styles.myMessageText]}>{message.body}</Text><Text style={[styles.messageTime, message.sender_id === userId && styles.myMessageTime]}>{new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text></View>)}
    </ScrollView>}
    <View style={styles.composer}><TextInput style={styles.input} value={draft} onChangeText={setDraft} placeholder="Write an inquiry..." placeholderTextColor="#A8A29E" multiline maxLength={2000} /><TouchableOpacity style={[styles.sendButton, !draft.trim() && styles.sendDisabled]} onPress={sendMessage} disabled={!draft.trim() || sending} accessibilityLabel="Send message"><Feather name="send" size={17} color="#FFFFFF" /></TouchableOpacity></View>
  </SafeAreaView></KeyboardAvoidingView></View>;
}

const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#FFF9F2' }, keyboardArea: { flex: 1 }, safeArea: { flex: 1 }, header: { padding: 18, backgroundColor: '#7C2D12', flexDirection: 'row', alignItems: 'center', gap: 12 }, backButton: { width: 39, height: 39, borderRadius: 13, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1 }, eyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 }, title: { color: '#FFFFFF', fontSize: 21, fontWeight: '900', marginTop: 3 }, subtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 11, lineHeight: 16, marginTop: 3 }, messageList: { flex: 1 }, messages: { flexGrow: 1, padding: 16, justifyContent: 'flex-end' }, empty: { alignItems: 'center', padding: 28 }, emptyTitle: { color: '#292524', fontSize: 17, fontWeight: '900', marginTop: 10 }, emptyText: { color: '#78716C', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 }, messageBubble: { maxWidth: '82%', padding: 11, borderRadius: 15, marginBottom: 9 }, myMessage: { alignSelf: 'flex-end', backgroundColor: '#C2410C', borderBottomRightRadius: 4 }, theirMessage: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3E8DC', borderBottomLeftRadius: 4 }, messageText: { color: '#57534E', fontSize: 13, lineHeight: 19 }, myMessageText: { color: '#FFFFFF' }, messageTime: { color: '#A8A29E', fontSize: 9, marginTop: 5, textAlign: 'right' }, myMessageTime: { color: '#FED7AA' }, systemMessage: { alignSelf: 'center', width: '100%', padding: 12, marginVertical: 7, borderRadius: 12, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FED7AA' }, systemLabel: { color: '#9A3412', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4 }, systemMessageText: { color: '#57534E', fontSize: 11, lineHeight: 17 }, systemTime: { color: '#A8A29E', fontSize: 9, marginTop: 5, textAlign: 'right' }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#F3E8DC' }, input: { flex: 1, minHeight: 44, maxHeight: 110, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, backgroundColor: '#FFF9F2', borderWidth: 1, borderColor: '#E7D9CC', color: '#292524', fontSize: 13, textAlignVertical: 'top' }, sendButton: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#C2410C', alignItems: 'center', justifyContent: 'center' }, sendDisabled: { backgroundColor: '#D6D3D1' }, loader: { marginVertical: 35 }, error: { margin: 12, padding: 10, borderRadius: 10, color: '#B91C1C', backgroundColor: '#FEF2F2', fontSize: 12 }, });
