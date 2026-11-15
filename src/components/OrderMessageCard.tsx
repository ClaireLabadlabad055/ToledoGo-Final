import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../Services/supabase';

type OrderItem = { name?: string; qty?: number; price?: number };
type ChatOrder = {
  id: string;
  status: string;
  total: number;
  items: OrderItem[] | null;
  payment_method: string | null;
  refund_amount: number | null;
  refund_status: string | null;
  refund_wallet_provider: string | null;
  refund_wallet_number: string | null;
  refund_transfer_reference: string | null;
  refund_transfer_proof_path: string | null;
  refund_due_at: string | null;
  refund_disputed_at: string | null;
  refund_dispute_reviewed_at: string | null;
};

type Props = {
  orderId: string;
  role: 'customer' | 'vendor';
};

export default function OrderMessageCard({ orderId, role }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState<ChatOrder | null>(null);
  const [transferProofUrl, setTransferProofUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [modal, setModal] = useState<'destination' | 'transfer' | null>(null);
  const [walletProvider, setWalletProvider] = useState('');
  const [walletNumber, setWalletNumber] = useState('');
  const [transferReference, setTransferReference] = useState('');
  const [transferProof, setTransferProof] = useState<{ uri: string; base64: string; mimeType: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const loadOrder = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, total, items, payment_method, refund_amount, refund_status, refund_wallet_provider, refund_wallet_number, refund_transfer_reference, refund_transfer_proof_path, refund_due_at, refund_disputed_at, refund_dispute_reviewed_at')
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw error;
    setOrder(data as ChatOrder | null);
    if (role === 'customer' && data?.refund_transfer_proof_path) {
      const { data: proofData, error: proofError } = await supabase.storage
        .from('refund-proof')
        .createSignedUrl(data.refund_transfer_proof_path, 3600);
      if (proofError) throw proofError;
      setTransferProofUrl(proofData.signedUrl);
    } else {
      setTransferProofUrl(null);
    }
    setCurrentTime(Date.now());
  }, [orderId, role]);

  useEffect(() => {
    let active = true;
    const initialLoad = async () => {
      try {
        await loadOrder();
      } catch (loadError) {
        if (active) setActionError(loadError instanceof Error ? loadError.message : 'Could not load this order.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void initialLoad();
    const channel = supabase
      .channel(`chat-order-${orderId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, () => {
        void loadOrder().catch((loadError: unknown) => {
          if (active) setActionError(loadError instanceof Error ? loadError.message : 'Could not refresh this order.');
        });
      })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [loadOrder, orderId]);

  const runAction = async (action: () => PromiseLike<{ error: { message: string } | null }>, successMessage: string): Promise<boolean> => {
    setWorking(true);
    setActionError(null);
    try {
      const { error } = await action();
      if (error) throw new Error(error.message);
      await loadOrder();
      setModal(null);
      Alert.alert('Refund updated', successMessage);
      return true;
    } catch (actionFailure) {
      setActionError(actionFailure instanceof Error ? actionFailure.message : 'The refund action failed.');
      return false;
    } finally {
      setWorking(false);
    }
  };

  const confirmRefund = () => runAction(
    () => supabase.rpc('confirm_vendor_direct_refund_request', { target_order_id: orderId }),
    'The customer has been asked to provide their e-wallet destination in this conversation.',
  );

  const submitDestination = () => {
    if (!walletProvider.trim() || !/^09\d{9}$/.test(walletNumber.replace(/\D/g, ''))) {
      setActionError('Enter an e-wallet name and a valid 11-digit Philippine mobile number.');
      return;
    }
    void runAction(
      () => supabase.rpc('submit_vendor_refund_destination', {
        target_order_id: orderId,
        target_wallet_provider: walletProvider.trim(),
        target_wallet_number: walletNumber.replace(/\D/g, ''),
      }),
      'Your e-wallet destination was sent to the vendor. Please wait patiently for the manual transfer.',
    );
  };

  const completeRefund = () => {
    const reference = transferReference.trim();
    if (reference.length < 6 || reference.length > 100) {
      setActionError('Enter a transfer reference between 6 and 100 characters.');
      return;
    }
    void (async () => {
      const success = await runAction(async () => {
        let proofPath: string | null = null;
        if (transferProof) {
          const { data: userData, error: userError } = await supabase.auth.getUser();
          if (userError || !userData.user) return { error: { message: userError?.message ?? 'Sign in again to upload transfer proof.' } };
          const extension = transferProof.mimeType === 'image/png' ? 'png' : transferProof.mimeType === 'image/webp' ? 'webp' : 'jpg';
          proofPath = `${userData.user.id}/${orderId}/proof-${Date.now()}.${extension}`;
          const { error: uploadError } = await supabase.storage
            .from('refund-proof')
            .upload(proofPath, decode(transferProof.base64), { contentType: transferProof.mimeType, upsert: false });
          if (uploadError) return { error: uploadError };
        }
        return supabase.rpc('complete_vendor_direct_refund', {
          target_order_id: orderId,
          transfer_reference: reference,
          proof_storage_path: proofPath,
        });
      },
        'The refund was recorded as sent. The customer can report it if it does not arrive.',
      );
      if (success) {
        setTransferReference('');
        setTransferProof(null);
      }
    })();
  };

  const chooseTransferProof = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      setActionError('Could not read that image. Choose another image or continue without proof.');
      return;
    }
    const mimeType = asset.mimeType ?? 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      setActionError('Choose a JPG, PNG, or WEBP image.');
      return;
    }
    setTransferProof({ uri: asset.uri, base64: asset.base64, mimeType });
    setActionError(null);
  };

  const reportRefund = () => {
    if (!order) return;
    const reason = order.refund_status === 'awaiting_vendor_confirmation'
      ? 'The vendor has not confirmed my refund request by the deadline.'
      : order.refund_status === 'pending_vendor'
        ? 'I have not received this refund by the deadline.'
        : 'The refund was marked as sent, but I have not received it.';
    Alert.alert('Report refund issue?', 'ToledoGo Support will review the order and follow up with the vendor.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report to support',
        onPress: () => void runAction(
          () => supabase.rpc('report_vendor_refund_not_received', { target_order_id: orderId, report_reason: reason }),
          'ToledoGo Support will review your report.',
        ),
      },
    ]);
  };

  const refundStatus = order?.refund_status;
  const overdue = Boolean(order?.refund_due_at && currentTime > 0 && new Date(order.refund_due_at).getTime() <= currentTime);
  const canReport = role === 'customer'
    && (refundStatus === 'settled'
      || (overdue && (refundStatus === 'pending_vendor' || refundStatus === 'awaiting_vendor_confirmation')));
  const canConfirm = role === 'vendor' && refundStatus === 'awaiting_vendor_confirmation';
  const canComplete = role === 'vendor' && refundStatus === 'pending_vendor';
  const canSubmitDestination = role === 'customer' && refundStatus === 'awaiting_customer_details';

  if (loading) {
    return <View style={styles.card}><ActivityIndicator color="#C2410C" /><Text style={styles.loadingText}>Loading order…</Text></View>;
  }
  if (!order) {
    return <View style={styles.card}><Text style={styles.errorText}>{actionError ?? 'This order is not available in this conversation.'}</Text></View>;
  }

  return (
    <View style={styles.card}>
      <View style={styles.heading}>
        <View style={styles.orderIcon}><Feather name="shopping-bag" size={16} color="#9A3412" /></View>
        <View style={styles.headingText}>
          <Text style={styles.eyebrow}>ORDER UPDATE</Text>
          <Text style={styles.orderId}>Order {order.id.slice(-8).toUpperCase()}</Text>
        </View>
        <Text style={styles.status}>{order.status.replaceAll('_', ' ')}</Text>
      </View>
      <View style={styles.items}>
        {(order.items ?? []).slice(0, 4).map((item, index) => (
          <Text key={`${item.name ?? 'item'}-${index}`} style={styles.itemText} numberOfLines={1}>
            {item.qty ?? 1} × {item.name ?? 'Item'}
          </Text>
        ))}
        {(order.items?.length ?? 0) > 4 ? <Text style={styles.moreItems}>and {(order.items?.length ?? 0) - 4} more</Text> : null}
      </View>
      <View style={styles.summary}>
        <Text style={styles.payment}>{order.payment_method ?? 'Payment'}</Text>
        <Text style={styles.total}>PHP {Number(order.total ?? 0).toFixed(2)}</Text>
      </View>
      {refundStatus && refundStatus !== 'not_applicable' ? (
        <Text style={styles.refundStatus}>
          Refund: {refundStatus.replaceAll('_', ' ')}
          {order.refund_due_at ? ` · Due ${new Date(order.refund_due_at).toLocaleDateString()}` : ''}
          {role === 'vendor' && order.refund_wallet_number
            ? `\n${order.refund_wallet_provider ?? 'E-wallet'} · ${order.refund_wallet_number}`
            : ''}
          {refundStatus === 'settled' && order.refund_transfer_reference
            ? `\nTransfer reference: ${order.refund_transfer_reference}`
            : ''}
        </Text>
      ) : null}
      {role === 'customer' && transferProofUrl ? (
        <View style={styles.transferProofSection}>
          <Text style={styles.transferProofLabel}>Vendor’s e-wallet transfer receipt</Text>
          <Image source={{ uri: transferProofUrl }} style={styles.customerProofImage} />
          <Text style={styles.transferProofNote}>
            The image is transfer evidence provided by the vendor. Check your e-wallet directly to confirm the refund arrived.
          </Text>
        </View>
      ) : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => role === 'customer'
            ? router.push({ pathname: '/customer/order-pass', params: { orderId } })
            : router.push('/vendor/orders')}
        >
          <Feather name="external-link" size={14} color="#9A3412" />
          <Text style={styles.secondaryButtonText}>{role === 'customer' ? 'View order & pickup QR' : 'Open orders'}</Text>
        </TouchableOpacity>
        {canConfirm ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => void confirmRefund()} disabled={working}>
            {working ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Confirm refund request</Text>}
          </TouchableOpacity>
        ) : null}
        {canSubmitDestination ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => { setActionError(null); setModal('destination'); }}>
            <Text style={styles.primaryButtonText}>Enter refund destination</Text>
          </TouchableOpacity>
        ) : null}
        {canComplete ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => { setActionError(null); setTransferReference(''); setTransferProof(null); setModal('transfer'); }}>
            <Text style={styles.primaryButtonText}>Record refund sent</Text>
          </TouchableOpacity>
        ) : null}
        {canReport ? (
          <TouchableOpacity style={styles.reportButton} onPress={reportRefund} disabled={working}>
            <Text style={styles.reportButtonText}>Report refund issue</Text>
          </TouchableOpacity>
        ) : null}
        {order.refund_disputed_at && !order.refund_dispute_reviewed_at ? (
          <Text style={styles.reportedText}>Reported to ToledoGo Support</Text>
        ) : null}
      </View>
      <Modal visible={modal !== null} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{modal === 'destination' ? 'Refund destination' : 'Record transfer'}</Text>
            {modal === 'destination' ? (
              <>
                <Text style={styles.modalHelp}>Enter where the vendor should send your refund. Never share your PIN or OTP.</Text>
                <TextInput style={styles.input} value={walletProvider} onChangeText={setWalletProvider} placeholder="E-wallet name (e.g. GCash)" maxLength={50} />
                <TextInput style={styles.input} value={walletNumber} onChangeText={(value) => setWalletNumber(value.replace(/\D/g, '').slice(0, 11))} placeholder="09XXXXXXXXX" keyboardType="phone-pad" maxLength={11} />
              </>
            ) : (
              <>
                <Text style={styles.modalHelp}>Send the refund manually first, then record its transfer reference.</Text>
                <TextInput style={styles.input} value={transferReference} onChangeText={setTransferReference} placeholder="Transfer reference" maxLength={100} autoCapitalize="characters" />
                <TouchableOpacity style={styles.proofButton} onPress={() => void chooseTransferProof()}>
                  <Feather name={transferProof ? 'check-circle' : 'image'} size={14} color="#9A3412" />
                  <Text style={styles.proofButtonText}>{transferProof ? 'Transfer proof attached' : 'Attach proof (optional)'}</Text>
                </TouchableOpacity>
                {transferProof ? <Image source={{ uri: transferProof.uri }} style={styles.proofPreview} /> : null}
              </>
            )}
            {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setModal(null)}><Text style={styles.cancelButtonText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={modal === 'destination' ? submitDestination : completeRefund} disabled={working}>
                {working ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{modal === 'destination' ? 'Send details' : 'Mark as sent'}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', padding: 13, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FED7AA', marginVertical: 7 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  orderIcon: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#FFF1E6', alignItems: 'center', justifyContent: 'center' },
  headingText: { flex: 1 },
  eyebrow: { color: '#9A3412', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  orderId: { color: '#292524', fontSize: 13, fontWeight: '900', marginTop: 2 },
  status: { color: '#57534E', fontSize: 10, fontWeight: '800', textTransform: 'capitalize' },
  items: { paddingVertical: 9, gap: 3 },
  itemText: { color: '#57534E', fontSize: 11 },
  moreItems: { color: '#78716C', fontSize: 10 },
  summary: { paddingTop: 8, borderTopWidth: 1, borderColor: '#F3E8DC', flexDirection: 'row', justifyContent: 'space-between' },
  payment: { color: '#78716C', fontSize: 10 },
  total: { color: '#292524', fontSize: 12, fontWeight: '900' },
  refundStatus: { color: '#9A3412', fontSize: 10, lineHeight: 15, marginTop: 8, textTransform: 'capitalize' },
  transferProofSection: { marginTop: 10, padding: 9, borderRadius: 10, backgroundColor: '#FFF7ED' },
  transferProofLabel: { color: '#9A3412', fontSize: 10, fontWeight: '900', marginBottom: 6 },
  customerProofImage: { width: '100%', height: 190, borderRadius: 8, resizeMode: 'contain', backgroundColor: '#FFFFFF' },
  transferProofNote: { color: '#78716C', fontSize: 10, lineHeight: 14, marginTop: 6 },
  loadingText: { color: '#78716C', fontSize: 11, textAlign: 'center', marginTop: 6 },
  errorText: { color: '#B91C1C', fontSize: 11, lineHeight: 15, marginTop: 7 },
  actions: { gap: 7, marginTop: 10 },
  secondaryButton: { minHeight: 36, borderRadius: 10, borderWidth: 1, borderColor: '#FED7AA', backgroundColor: '#FFF7ED', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#9A3412', fontSize: 11, fontWeight: '800' },
  primaryButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#C2410C', alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  reportButton: { minHeight: 35, borderRadius: 10, backgroundColor: '#FFF7ED', alignItems: 'center', justifyContent: 'center' },
  reportButtonText: { color: '#9A3412', fontSize: 10, fontWeight: '800' },
  reportedText: { color: '#78716C', fontSize: 10, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, padding: 18, borderRadius: 17, backgroundColor: '#FFFFFF' },
  modalTitle: { color: '#292524', fontSize: 18, fontWeight: '900' },
  modalHelp: { color: '#78716C', fontSize: 12, lineHeight: 18, marginVertical: 10 },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: '#E7E5E4', paddingHorizontal: 12, marginTop: 8, color: '#292524' },
  proofButton: { minHeight: 38, borderRadius: 10, backgroundColor: '#FFF7ED', flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  proofButtonText: { color: '#9A3412', fontSize: 11, fontWeight: '800' },
  proofPreview: { width: '100%', height: 120, borderRadius: 10, marginTop: 8, resizeMode: 'cover' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  cancelButton: { minHeight: 38, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#F5F5F4', alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: '#57534E', fontSize: 11, fontWeight: '800' },
});
