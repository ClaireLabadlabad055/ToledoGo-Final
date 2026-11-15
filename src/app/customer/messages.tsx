import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../Services/supabase';

type Conversation = {
  id: string;
  vendor_id: string;
  subject: string | null;
  order_id: string | null;
  last_message_at: string;
  vendorName: string;
  lastMessage: string;
  unreadCount: number;
};

const orderCardPrefix = 'TOLEDOGO_ORDER_CARD:';

export default function CustomerMessagesScreen() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      setError(null);
      const { data: userData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!userData.user) {
        router.replace('/login');
        return;
      }
      const { data: rows, error: conversationError } = await supabase
        .from('conversations')
        .select('id, vendor_id, subject, order_id, last_message_at')
        .eq('customer_id', userData.user.id)
        .order('last_message_at', { ascending: false });
      if (conversationError) throw conversationError;

      const { data: customerMessages, error: customerMessagesError } = await supabase
        .from('messages')
        .select('conversation_id')
        .eq('sender_id', userData.user.id)
        .eq('is_system', false);
      if (customerMessagesError) throw customerMessagesError;
      const { data: unreadMessages, error: unreadMessagesError } = await supabase
        .from('messages')
        .select('conversation_id')
        .neq('sender_id', userData.user.id)
        .is('read_at', null);
      if (unreadMessagesError) throw unreadMessagesError;
      const unreadCounts = new Map<string, number>();
      for (const message of unreadMessages ?? []) {
        unreadCounts.set(
          message.conversation_id,
          (unreadCounts.get(message.conversation_id) ?? 0) + 1,
        );
      }
      const messagedConversationIds = new Set(
        (customerMessages ?? []).map((message) => message.conversation_id),
      );
      const customerStartedRows = (rows ?? []).filter((row) =>
        messagedConversationIds.has(row.id),
      );

      const vendorIds = Array.from(new Set(customerStartedRows.map((row) => row.vendor_id)));
      const { data: vendors, error: vendorsError } = vendorIds.length
        ? await supabase.from('vendors').select('id, business_name').in('id', vendorIds)
        : { data: [], error: null };
      if (vendorsError) throw vendorsError;
      const names = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor.business_name]));
      const mapped = await Promise.all(customerStartedRows.map(async (row) => {
        const { data: lastMessage, error: lastMessageError } = await supabase
          .from('messages')
          .select('body')
          .eq('conversation_id', row.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (lastMessageError) throw lastMessageError;
        const body = lastMessage?.body ?? '';
        return {
          ...row,
          vendorName: names.get(row.vendor_id) ?? 'Vendor',
          lastMessage: body.startsWith(orderCardPrefix) ? 'New order · View order details' : body,
          unreadCount: unreadCounts.get(row.id) ?? 0,
        } as Conversation;
      }));
      setConversations(mapped);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load your messages.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    const runLoad = async () => {
      await loadConversations();
    };
    void runLoad();
    const channel = supabase
      .channel('customer-conversations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => void loadConversations())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadConversations]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#7C2D12" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/customer/dashboard')} accessibilityLabel="Back">
            <Feather name="arrow-left" size={19} color="#292524" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>CUSTOMER MESSAGES</Text>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>Order updates and vendor conversations</Text>
          </View>
          <Feather name="message-circle" size={26} color="#FED7AA" />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? <ActivityIndicator color="#C2410C" style={styles.loader} /> : (
          <ScrollView
            contentContainerStyle={styles.content}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadConversations(); }} tintColor="#C2410C" />}
          >
            {!conversations.length ? (
              <View style={styles.empty}>
                <Feather name="inbox" size={34} color="#C2410C" />
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptyText}>Place an order or contact a vendor to start a private conversation.</Text>
              </View>
            ) : conversations.map((conversation) => (
              <TouchableOpacity
                key={conversation.id}
                style={styles.conversation}
                onPress={() => router.push({ pathname: '/customer/messages/[id]', params: { id: conversation.id, vendorName: conversation.vendorName } })}
              >
                <View style={styles.avatar}><Text style={styles.avatarText}>{conversation.vendorName.charAt(0).toUpperCase()}</Text></View>
                <View style={styles.copy}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.vendorName, conversation.unreadCount > 0 && styles.unreadText]}>{conversation.vendorName}</Text>
                    <Text style={[styles.date, conversation.unreadCount > 0 && styles.unreadText]}>{new Date(conversation.last_message_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={[styles.subject, conversation.unreadCount > 0 && styles.unreadText]}>{conversation.subject || 'Vendor conversation'}{conversation.order_id ? ' · Order linked' : ''}</Text>
                  <Text style={[styles.preview, conversation.unreadCount > 0 && styles.unreadText]} numberOfLines={1}>{conversation.lastMessage || 'No messages yet'}</Text>
                </View>
                {conversation.unreadCount > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadBadgeText}>
                      {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                    </Text>
                  </View>
                ) : null}
                <Feather name="chevron-right" size={17} color="#A8A29E" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF9F2' },
  safeArea: { flex: 1 },
  header: { padding: 18, backgroundColor: '#7C2D12', flexDirection: 'row', alignItems: 'center', gap: 12 },
  backButton: { width: 39, height: 39, borderRadius: 13, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#FFFFFF', fontSize: 23, fontWeight: '900', marginTop: 3 },
  subtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 11, marginTop: 3 },
  content: { padding: 16, paddingBottom: 35 },
  conversation: { padding: 14, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3E8DC', flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFF1E6', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#C2410C', fontSize: 15, fontWeight: '900' },
  copy: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  vendorName: { color: '#292524', fontSize: 14, fontWeight: '900' },
  unreadText: { color: '#451A03', fontWeight: '900' },
  date: { color: '#A8A29E', fontSize: 10 },
  subject: { color: '#C2410C', fontSize: 10, fontWeight: '900', marginTop: 5 },
  preview: { color: '#78716C', fontSize: 11, marginTop: 5 },
  unreadBadge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: '#C2410C', alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  empty: { alignItems: 'center', paddingVertical: 75, paddingHorizontal: 25 },
  emptyTitle: { color: '#292524', fontSize: 18, fontWeight: '900', marginTop: 12 },
  emptyText: { color: '#78716C', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 5 },
  loader: { marginVertical: 35 },
  error: { color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10, fontSize: 12, margin: 12 },
});
