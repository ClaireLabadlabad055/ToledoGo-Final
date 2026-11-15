import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { supabase } from '../../Services/supabase';

type OrderStatus = 'pending' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type VendorTab = OrderStatus | 'summary';

interface OrderItem {
  name: string;
  qty: number;
  price: number;
}

interface Order {
  id: string;
  qr_code_string?: string | null;
  batch_id?: string | null;
  batch_slot?: string | null;
  pickup_at?: string | null;
  pickup_window_end?: string | null;
  meetup_location?: string | null;
  customer_name: string;
  customer_phone?: string | null;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  refund_amount?: number | null;
  refund_status?: string | null;
  refund_wallet_provider?: string | null;
  refund_wallet_number?: string | null;
  refund_transfer_reference?: string | null;
  refund_due_at?: string | null;
  fulfillment_mode: 'instore' | 'meetup';
  pickup_details?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  payment_status?: 'not_required' | 'awaiting_verification' | 'verified' | 'rejected';
  payment_amount?: number | null;
  payment_verification_expires_at?: string | null;
  payment_verified_at?: string | null;
  delivery_address?: string | null;
  delivery_notes?: string | null;
  special_instructions?: string | null;
  created_at: string;
}

interface BatchSummary {
  batch_id?: string | null;
  batch_slot: string;
  meetup_location?: string | null;
  pickup_at?: string | null;
  pickup_window_end?: string | null;
  max_orders?: number | null;
  cutoff_time?: string | null;
  batch_status: 'open' | 'locked' | 'completed';
  order_count: number;
  item_totals: Record<string, number>;
}

const orderTabs: { key: OrderStatus; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
  { key: 'pending', label: 'Incoming', icon: 'inbox' },
  { key: 'preparing', label: 'Preparing', icon: 'coffee' },
  { key: 'ready', label: 'Ready', icon: 'shopping-bag' },
  { key: 'completed', label: 'History', icon: 'check-circle' },
  { key: 'cancelled', label: 'Refunds', icon: 'rotate-ccw' },
];

const statusLabels: Record<OrderStatus, string> = {
  pending: 'New order',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const statusColors: Record<OrderStatus, { background: string; foreground: string }> = {
  pending: { background: '#FFF1E6', foreground: '#C2410C' },
  preparing: { background: '#FEF3C7', foreground: '#92400E' },
  ready: { background: '#DBEAFE', foreground: '#1D4ED8' },
  completed: { background: '#DCFCE7', foreground: '#166534' },
  cancelled: { background: '#FEE2E2', foreground: '#B91C1C' },
};

const nextStatus: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: 'preparing', label: 'Start preparing' },
  preparing: { status: 'ready', label: 'Mark ready' },
  ready: { status: 'completed', label: 'Complete order' },
};

const formatDateTime = (date: string) => new Date(date).toLocaleString([], {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const isOnlineWallet = (method?: string | null) => method === 'GCash' || method === 'Maya';

const isPaymentReferenceExpired = (expiresAt?: string | null) =>
  Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now());

export default function VendorOrdersScreen() {
  const router = useRouter();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<BatchSummary[]>([]);
  const [activeTab, setActiveTab] = useState<VendorTab>('pending');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [scanLocked, setScanLocked] = useState(false);
  const [scannedOrder, setScannedOrder] = useState<Order | null>(null);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [manualEntryVisible, setManualEntryVisible] = useState(false);
  const [manualOrderNumber, setManualOrderNumber] = useState('');

  const loadOrders = useCallback(async () => {
    try {
      setError(null);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) {
        router.replace('/login');
        return;
      }

      setVendorId(userData.user.id);
      const { data, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('vendor_id', userData.user.id)
        .order('created_at', { ascending: false });
      if (ordersError) throw ordersError;

      const orderRows = (data ?? []) as Order[];
      const batchIds = Array.from(new Set(
        orderRows.map((order) => order.batch_id).filter((id): id is string => Boolean(id)),
      ));
      let batchesById = new Map<string, {
        pickup_at: string;
        pickup_window_end: string;
        meetup_location: string | null;
      }>();

      if (batchIds.length > 0) {
        const { data: batchRows, error: batchError } = await supabase
          .from('vendor_batches')
          .select('id, pickup_at, pickup_window_end, meetup_location')
          .in('id', batchIds);
        if (batchError) throw batchError;
        batchesById = new Map((batchRows ?? []).map((batch) => [batch.id, batch]));
      }

      const scheduledOrders = orderRows.map((order) => {
        const batch = order.batch_id ? batchesById.get(order.batch_id) : null;
        return {
          ...order,
          pickup_at: batch?.pickup_at ?? null,
          pickup_window_end: batch?.pickup_window_end ?? null,
          meetup_location: batch?.meetup_location ?? null,
        };
      });
      scheduledOrders.sort((first, second) => (
        (first.pickup_at ?? first.created_at).localeCompare(second.pickup_at ?? second.created_at)
      ));
      setOrders(scheduledOrders);

      const { data: summaryData, error: summaryError } = await supabase.rpc(
        'get_vendor_batch_summary',
        { target_vendor_id: userData.user.id },
      );
      if (summaryError?.code === 'PGRST202') {
        setSummary([]);
      } else if (summaryError) {
        throw summaryError;
      } else {
        setSummary((summaryData ?? []) as BatchSummary[]);
      }
    } catch (loadError: unknown) {
      setError(loadError instanceof Error
        ? loadError.message
        : 'Unable to load orders. Please refresh and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    let isMounted = true;
    const channel = supabase
      .channel(`vendor-orders-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        if (isMounted) void loadOrders();
      })
      .subscribe();

    const safeLoad = async () => {
      await loadOrders();
      if (!isMounted) return;
    };
    void safeLoad();
    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [loadOrders]);

  useFocusEffect(useCallback(() => {
    void loadOrders();
  }, [loadOrders]));

  const verifyPayment = async (order: Order) => {
    if (!vendorId) return false;
    const { data: verifiedOrder, error: paymentError } = await supabase
      .from('orders')
      .update({ payment_status: 'verified', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('vendor_id', vendorId)
      .eq('payment_status', 'awaiting_verification')
      .select('id')
      .maybeSingle();

    if (paymentError) {
      Alert.alert('Could not verify payment', paymentError.message);
      return false;
    }
    if (!verifiedOrder) {
      Alert.alert('Could not verify payment', 'The payment status changed. Refresh the order and try again.');
      return false;
    }
    setOrders((current) => current.map((item) => item.id === order.id
      ? { ...item, payment_status: 'verified' }
      : item));
    return true;
  };

  const rejectPayment = async (order: Order) => {
    if (!vendorId) return;
    const { data: rejectedOrder, error: paymentError } = await supabase
      .from('orders')
      .update({ payment_status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('vendor_id', vendorId)
      .eq('payment_status', 'awaiting_verification')
      .select('id')
      .maybeSingle();

    if (paymentError) {
      Alert.alert('Could not reject payment', paymentError.message);
      return;
    }
    if (!rejectedOrder) {
      Alert.alert('Could not reject payment', 'The payment status changed. Refresh the order and try again.');
      return;
    }
    setOrders((current) => current.map((item) => item.id === order.id
      ? { ...item, payment_status: 'rejected' }
      : item));
  };

  const requestPaymentVerification = (order: Order, continueToPreparing: boolean) => {
    const expiresAt = order.payment_verification_expires_at
      ? new Date(order.payment_verification_expires_at)
      : null;
    const referenceExpired = isPaymentReferenceExpired(order.payment_verification_expires_at);
    const rejectAction = {
      text: 'Reject payment',
      style: 'destructive' as const,
      onPress: () => { void rejectPayment(order); },
    };
    if (referenceExpired) {
      Alert.alert(
        'Payment reference expired',
        'The reference expired. Reject it if the payment was not received, or contact the customer to resolve it.',
        [
          { text: 'Not yet', style: 'cancel' },
          rejectAction,
        ],
      );
      return;
    }

    Alert.alert(
      'Confirm payment received',
      `Verify ${order.payment_method} payment of PHP ${Number(order.payment_amount ?? order.total).toFixed(2)} before preparing this order.\n\nReference: ${order.payment_reference || 'Not provided'}${expiresAt ? `\nExpires: ${expiresAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`,
      [
        { text: 'Not yet', style: 'cancel' },
        rejectAction,
        {
          text: 'Payment received',
          onPress: async () => {
            if (await verifyPayment(order) && continueToPreparing) {
              await advanceOrder({ ...order, payment_status: 'verified' });
            }
          },
        },
      ],
    );
  };

  const advanceOrder = async (order: Order) => {
    const transition = nextStatus[order.status];
    if (!transition || !vendorId) return;

    if (transition.status === 'preparing' && isOnlineWallet(order.payment_method)
      && order.payment_status === 'rejected') {
      Alert.alert(
        'Payment rejected',
        'This order must remain pending until payment is resolved. Contact the customer or cancel the order.',
      );
      return;
    }

    if (transition.status === 'preparing' && isOnlineWallet(order.payment_method)
      && order.payment_status !== 'verified') {
      requestPaymentVerification(order, true);
      return;
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status: transition.status, updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('vendor_id', vendorId)
      .eq('status', order.status);
    if (updateError) {
      Alert.alert('Could not update order', updateError.message);
      return;
    }
    setOrders((current) => current.map((item) => item.id === order.id
      ? { ...item, status: transition.status }
      : item));

    if (transition.status === 'ready') {
      const { data: notificationResult, error: notificationError } = await supabase.functions.invoke('push-notifications', {
        body: { event: 'order_ready', order_id: order.id },
      });
      if (notificationError || notificationResult?.sent === 0) {
        Alert.alert(
          'Order updated, notification not sent',
          `The order is ready, but its customer could not be notified by phone. They can still check My Orders.\n\n${notificationError?.message ?? 'No registered phone was found. The customer must sign in on a physical device first.'}`,
        );
      }
    }
  };

  const cancelOrder = (order: Order) => {
    if (!vendorId || !['pending', 'preparing'].includes(order.status)) return;
    const externalPayment = isOnlineWallet(order.payment_method);
    Alert.alert(
      'Cancel this order?',
      externalPayment
        ? 'The order will be cancelled. The customer will enter their e-wallet details, then you can send and record the refund.'
        : 'Cash on pickup has not been collected yet, so no cash refund will be issued. Any redeemed loyalty coins will be restored.',
      [
        { text: 'Keep order', style: 'cancel' },
        {
          text: externalPayment ? 'Cancel + refund request' : 'Cancel order',
          style: 'destructive',
          onPress: async () => {
            const { data: cancelledOrder, error: cancelError } = await supabase
              .from('orders')
              .update({
                status: 'cancelled',
                cancellation_reason: 'Vendor emergency or out of stock',
                updated_at: new Date().toISOString(),
              })
              .eq('id', order.id)
              .eq('vendor_id', vendorId)
              .in('status', ['pending', 'preparing'])
              .select('id, status, refund_status')
              .maybeSingle();

            if (cancelError || !cancelledOrder) {
              Alert.alert(
                'Could not cancel order',
                cancelError?.message ?? 'The order was not changed. Refresh and try again.',
              );
              await loadOrders();
              return;
            }
            setOrders((current) => current.map((item) => item.id === order.id
              ? { ...item, ...cancelledOrder }
              : item));
            Alert.alert(
              'Order cancelled',
              externalPayment
                ? 'The refund request will appear in your Refunds tab. Confirm it there to ask the customer for their wallet details.'
                : 'The order was cancelled before payment was collected, so no cash refund was due.',
            );
          },
        },
      ],
    );
  };

  const openRefundConversation = async (order: Order) => {
    const { data: conversationId, error: conversationError } = await supabase.rpc('publish_order_chat_card', {
      target_order_id: order.id,
    });
    if (conversationError) {
      Alert.alert('Could not open refund conversation', conversationError.message);
      return;
    }
    router.push({
      pathname: '/vendor/messages/[id]',
      params: { id: conversationId, customerName: order.customer_name },
    });
  };

  const updateStatus = (order: Order) => {
    const transition = nextStatus[order.status];
    if (!transition) return;

    if (order.status === 'pending' || order.status === 'preparing') {
      Alert.alert(
        statusLabels[order.status],
        order.status === 'pending'
          ? 'Start preparing this order, or cancel it and issue a refund.'
          : 'Mark this order ready, or cancel it and issue a refund.',
        [
          { text: 'Keep order', style: 'cancel' },
          { text: transition.label, onPress: () => { void advanceOrder(order); } },
          { text: 'Cancel + refund', style: 'destructive', onPress: () => cancelOrder(order) },
        ],
      );
      return;
    }
    void advanceOrder(order);
  };

  const visibleOrders = useMemo(
    () => activeTab === 'summary' ? [] : orders.filter((order) => order.status === activeTab),
    [activeTab, orders],
  );
  const countFor = (status: OrderStatus) => orders.filter((order) => order.status === status).length;
  const activeOrderCount = countFor('pending') + countFor('preparing') + countFor('ready');

  const openScanner = async () => {
    let canScan = Boolean(cameraPermission?.granted);
    if (!canScan) {
      const permission = await requestCameraPermission();
      canScan = permission.granted;
    }
    setScanLocked(false);
    setScannedOrder(null);
    setManualOrderNumber('');
    setManualEntryVisible(!canScan);
    setScannerVisible(true);
  };

  const completePickupOrder = async (order: Order) => {
    if (!vendorId) return;
    const { data: completedRow, error: completeError } = await supabase
      .from('orders')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', order.id)
      .eq('vendor_id', vendorId)
      .eq('status', 'ready')
      .select('id')
      .maybeSingle();
    setScanLocked(false);
    if (completeError) {
      Alert.alert('Could not confirm pickup', completeError.message);
      return;
    }
    if (!completedRow) {
      Alert.alert('Could not confirm pickup', 'The order status changed. Refresh the orders list and try again.');
      void loadOrders();
      return;
    }

    const completedOrder = { ...order, status: 'completed' as const };
    setOrders((current) => current.map((item) => item.id === order.id ? completedOrder : item));
    setScannerVisible(false);
    setManualEntryVisible(false);
    setScannedOrder(completedOrder);
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanLocked || !vendorId) return;
    setScanLocked(true);
    const { data: order, error: lookupError } = await supabase
      .from('orders')
      .select('*')
      .eq('vendor_id', vendorId)
      .eq('qr_code_string', data.trim())
      .maybeSingle();

    if (lookupError) {
      setScannerVisible(false);
      setScanLocked(false);
      Alert.alert('Could not look up order', lookupError.message);
      return;
    }
    if (!order) {
      setScannerVisible(false);
      setScanLocked(false);
      Alert.alert('Receipt not recognized', 'This QR code is not linked to one of your orders.');
      return;
    }
    if (order.status !== 'ready') {
      setScannerVisible(false);
      setScanLocked(false);
      Alert.alert(
        'Order not ready',
        `${order.customer_name || 'This customer'}’s order is currently ${order.status}.`,
      );
      return;
    }

    await completePickupOrder(order as Order);
  };

  const findOrderByNumber = async () => {
    if (scanLocked || !vendorId) return;
    const orderNumber = manualOrderNumber
      .trim()
      .replace(/^ORD[-\s#]*/i, '')
      .replace(/\s/g, '')
      .toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(orderNumber)) {
      Alert.alert('Check order number', 'Enter the 8-character code shown after ORD- in the customer’s Orders list.');
      return;
    }

    setScanLocked(true);
    const { data: matches, error: lookupError } = await supabase
      .from('orders')
      .select('*')
      .eq('vendor_id', vendorId)
      .ilike('id', `${orderNumber}%`)
      .limit(2);
    setScanLocked(false);
    if (lookupError) {
      Alert.alert('Could not look up order', lookupError.message);
      return;
    }
    if (!matches?.length) {
      Alert.alert('Order not found', 'Check the number with the customer and try again.');
      return;
    }
    if (matches.length > 1) {
      Alert.alert('Order number is not unique', 'Please verify the customer’s order details before confirming pickup.');
      return;
    }

    const order = matches[0] as Order;
    if (order.status !== 'ready') {
      Alert.alert(
        'Order not ready',
        `${order.customer_name || 'This customer'}’s order is currently ${order.status}.`,
      );
      return;
    }

    Alert.alert(
      'Confirm pickup',
      `Mark order ORD-${order.id.slice(0, 8).toUpperCase()} for ${order.customer_name || 'this customer'} as picked up?`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Confirm pickup', onPress: () => { void completePickupOrder(order); } },
      ],
    );
  };

  const renderOrderCard = (order: Order) => {
    const transition = nextStatus[order.status];
    const statusColor = statusColors[order.status];
    const walletNeedsVerification = order.status !== 'cancelled'
      && isOnlineWallet(order.payment_method)
      && order.payment_status === 'awaiting_verification';
    const paymentRejected = order.payment_status === 'rejected' && order.status !== 'cancelled';

    return (
      <View key={order.id} style={styles.orderCard}>
        <View style={styles.cardTop}>
          <View style={styles.orderIdentity}>
            <Text style={styles.orderNumber}>ORDER #{order.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={styles.customerName}>{order.customer_name || 'Customer'}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: statusColor.background }]}>
            <Text style={[styles.statusPillText, { color: statusColor.foreground }]}>
              {statusLabels[order.status]}
            </Text>
          </View>
        </View>

        <View style={styles.detailLine}>
          <Feather name="clock" size={14} color="#78716C" />
          <Text style={styles.detailText}>{formatDateTime(order.created_at)}</Text>
        </View>
        <View style={styles.detailLine}>
          <Feather
            name={order.fulfillment_mode === 'meetup' ? 'map-pin' : 'shopping-bag'}
            size={14}
            color="#78716C"
          />
          <Text style={styles.detailText}>
            {order.fulfillment_mode === 'meetup' ? 'Location meet-up' : 'In-store pickup'}
            {order.pickup_details ? ` · ${order.pickup_details}` : ''}
          </Text>
        </View>
        {order.pickup_at ? (
          <View style={styles.detailLine}>
            <Feather name="calendar" size={14} color="#78716C" />
            <Text style={styles.detailText}>
              Pickup {formatDateTime(order.pickup_at)}
              {order.pickup_window_end
                ? ` – ${new Date(order.pickup_window_end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                : ''}
            </Text>
          </View>
        ) : null}
        {order.meetup_location ? (
          <View style={styles.detailLine}>
            <Feather name="map-pin" size={14} color="#78716C" />
            <Text style={styles.detailText}>{order.meetup_location}</Text>
          </View>
        ) : null}
        {order.delivery_address ? (
          <View style={styles.detailLine}>
            <Feather name="navigation" size={14} color="#78716C" />
            <Text style={styles.detailText}>{order.delivery_address}</Text>
          </View>
        ) : null}

        <View style={styles.itemsPanel}>
          <Text style={styles.panelHeading}>ORDER ITEMS</Text>
          {(order.items ?? []).map((item, index) => (
            <View key={`${order.id}-${index}`} style={styles.itemRow}>
              <Text style={styles.itemName}>{item.qty} × {item.name}</Text>
              <Text style={styles.itemPrice}>
                PHP {Number(item.price * item.qty).toFixed(2)}
              </Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Order total</Text>
            <Text style={styles.totalValue}>PHP {Number(order.total).toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.paymentRow}>
          <View style={styles.detailLine}>
            <Feather name="credit-card" size={14} color="#78716C" />
            <Text style={styles.detailText}>{order.payment_method || 'Payment method not specified'}</Text>
          </View>
          {walletNeedsVerification ? (
            <TouchableOpacity
              style={styles.paymentVerifyButton}
              onPress={() => requestPaymentVerification(order, order.status === 'pending')}
              accessibilityRole="button"
              accessibilityLabel="Verify customer payment"
            >
              <Feather name="check" size={13} color="#FFFFFF" />
              <Text style={styles.paymentVerifyButtonText}>Verify payment</Text>
            </TouchableOpacity>
          ) : paymentRejected ? (
            <View style={styles.paymentRejected}>
              <Feather name="x-circle" size={13} color="#B91C1C" />
              <Text style={styles.paymentRejectedText}>Payment rejected</Text>
            </View>
          ) : order.payment_status === 'verified' && order.status !== 'cancelled' ? (
            <View style={styles.paymentVerified}>
              <Feather name="check-circle" size={13} color="#166534" />
              <Text style={styles.paymentVerifiedText}>Paid</Text>
            </View>
          ) : null}
        </View>
        {(walletNeedsVerification || paymentRejected) && order.payment_reference ? (
          <Text style={styles.paymentReference}>Reference: {order.payment_reference}</Text>
        ) : null}

        {order.special_instructions ? (
          <View style={styles.notePanel}>
            <Feather name="message-square" size={14} color="#9A3412" />
            <View style={styles.noteCopy}>
              <Text style={styles.noteLabel}>CUSTOMER NOTE</Text>
              <Text style={styles.noteText}>{order.special_instructions}</Text>
            </View>
          </View>
        ) : null}
        {order.delivery_notes ? (
          <View style={styles.notePanel}>
            <Feather name="info" size={14} color="#9A3412" />
            <View style={styles.noteCopy}>
              <Text style={styles.noteLabel}>PICKUP DETAILS</Text>
              <Text style={styles.noteText}>{order.delivery_notes}</Text>
            </View>
          </View>
        ) : null}

        {transition ? (
          <View style={styles.cardActions}>
            {order.status !== 'ready' ? (
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => cancelOrder(order)}
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.primaryAction, order.status === 'ready' && styles.primaryActionFull]}
              onPress={() => updateStatus(order)}
              accessibilityRole="button"
            >
              <Text style={styles.primaryActionText}>{transition.label}</Text>
              <Feather
                name={order.status === 'ready' ? 'check-circle' : 'arrow-right'}
                size={16}
                color="#FFFFFF"
              />
            </TouchableOpacity>
          </View>
        ) : order.status === 'cancelled' ? (
          <>
            <View style={styles.refundInfo}>
              <Feather name="info" size={14} color="#9A3412" />
              <Text style={styles.refundInfoText}>
                {order.refund_status === 'awaiting_vendor_confirmation'
                  ? `Review the PHP ${Number(order.refund_amount ?? 0).toFixed(2)} e-wallet refund request. Confirm to ask the customer for their destination.${order.refund_due_at ? ` Respond by ${new Date(order.refund_due_at).toLocaleString()}.` : ''}`
                  : order.refund_status === 'pending_vendor'
                  ? `Send PHP ${Number(order.refund_amount ?? 0).toFixed(2)} to the customer’s ${order.refund_wallet_provider ?? 'e-wallet'}: ${order.refund_wallet_number ?? 'destination not available'}${order.refund_due_at ? ` · Due ${new Date(order.refund_due_at).toLocaleString()}` : ''}`
                  : order.refund_status === 'awaiting_customer_details'
                    ? 'Waiting for the customer to provide their e-wallet name and number.'
                    : order.refund_status === 'settled'
                      ? `Refund sent. Transfer reference: ${order.refund_transfer_reference ?? 'not available'}`
                      : order.refund_status === 'pending' || order.refund_status === 'completed'
                        ? 'Legacy refund record. Contact support if it still needs processing.'
                        : 'No e-wallet refund is due for this order.'}
              </Text>
            </View>
            {['awaiting_vendor_confirmation', 'awaiting_customer_details', 'pending_vendor'].includes(order.refund_status ?? '') ? (
              <TouchableOpacity
                style={styles.recordRefundButton}
                onPress={() => void openRefundConversation(order)}
                accessibilityRole="button"
              >
                <Feather name="message-circle" size={15} color="#FFFFFF" />
                <Text style={styles.recordRefundButtonText}>Manage refund in Messages</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
      </View>
    );
  };

  const renderBatchSummary = (batch: BatchSummary) => (
    <View key={`${batch.batch_id ?? batch.batch_slot}-${batch.batch_status}`} style={styles.orderCard}>
      <View style={styles.cardTop}>
        <View style={styles.orderIdentity}>
          <Text style={styles.orderNumber}>PICKUP WINDOW</Text>
          <Text style={styles.customerName}>{batch.batch_slot}</Text>
        </View>
        <View style={[styles.statusPill, styles.statusPillSummary]}>
          <Text style={[styles.statusPillText, styles.statusTextSummary]}>
            {batch.batch_status}
          </Text>
        </View>
      </View>
      <Text style={styles.batchMeta}>
        {batch.order_count}{batch.max_orders ? ` of ${batch.max_orders}` : ''} orders
        {batch.pickup_at ? ` · Pickup ${formatDateTime(batch.pickup_at)}` : ''}
      </Text>
      {batch.meetup_location ? (
        <View style={styles.detailLine}>
          <Feather name="map-pin" size={14} color="#78716C" />
          <Text style={styles.detailText}>{batch.meetup_location}</Text>
        </View>
      ) : null}
      {batch.cutoff_time ? (
        <View style={styles.detailLine}>
          <Feather name="clock" size={14} color="#78716C" />
          <Text style={styles.detailText}>Order cutoff {formatDateTime(batch.cutoff_time)}</Text>
        </View>
      ) : null}
      <View style={styles.itemsPanel}>
        <Text style={styles.panelHeading}>PREP TOTALS</Text>
        {Object.entries(batch.item_totals ?? {}).map(([name, quantity]) => (
          <View key={name} style={styles.itemRow}>
            <Text style={styles.itemName}>{name}</Text>
            <Text style={styles.itemPrice}>{quantity} servings</Text>
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#7C2D12" />
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#C2410C', '#9A3412', '#7C2D12']} style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace('/vendor/dashboard');
            }}
            accessibilityLabel="Back to vendor dashboard"
          >
            <Feather name="arrow-left" size={19} color="#9A3412" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>VENDOR OPERATIONS</Text>
            <Text style={styles.title}>Orders</Text>
            <Text style={styles.subtitle}>Manage orders and customer pickups</Text>
          </View>
          <TouchableOpacity
            style={styles.scanButton}
            onPress={openScanner}
            accessibilityLabel="Scan pickup QR code"
          >
            <MaterialCommunityIcons name="qrcode-scan" size={20} color="#FFFFFF" />
            <Text style={styles.scanButtonText}>Scan</Text>
          </TouchableOpacity>
        </LinearGradient>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
        >
          {orderTabs.map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, selected && styles.tabActive]}
                onPress={() => setActiveTab(tab.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
              >
                <Feather
                  name={tab.icon}
                  size={15}
                  color={selected ? '#FFFFFF' : '#78716C'}
                />
                <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>
                  {tab.label}
                </Text>
                <View style={[styles.count, selected && styles.countActive]}>
                  <Text style={[styles.countText, selected && styles.countTextActive]}>
                    {countFor(tab.key)}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.tab, activeTab === 'summary' && styles.tabActive]}
            onPress={() => setActiveTab('summary')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'summary' }}
          >
            <Feather
              name="layers"
              size={15}
              color={activeTab === 'summary' ? '#FFFFFF' : '#78716C'}
            />
            <Text style={[styles.tabLabel, activeTab === 'summary' && styles.tabLabelActive]}>
              Prep totals
            </Text>
            <View style={[styles.count, activeTab === 'summary' && styles.countActive]}>
              <Text style={[styles.countText, activeTab === 'summary' && styles.countTextActive]}>
                {summary.length}
              </Text>
            </View>
          </TouchableOpacity>
        </ScrollView>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void loadOrders();
              }}
              tintColor="#C2410C"
            />
          }
        >
          <View style={styles.overviewCard}>
            <View style={styles.overviewIcon}>
              <Feather name="activity" size={18} color="#C2410C" />
            </View>
            <View style={styles.overviewCopy}>
              <Text style={styles.overviewTitle}>
                {activeOrderCount === 0 ? 'You’re all caught up' : `${activeOrderCount} active orders`}
              </Text>
              <Text style={styles.overviewSubtitle}>
                {countFor('pending')} incoming · {countFor('preparing')} preparing · {countFor('ready')} ready
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setRefreshing(true);
                void loadOrders();
              }}
              style={styles.refreshButton}
              accessibilityLabel="Refresh orders"
            >
              <Feather name="refresh-cw" size={16} color="#9A3412" />
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.errorPanel}>
              <Feather name="alert-circle" size={17} color="#B91C1C" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          {loading ? <ActivityIndicator color="#C2410C" style={styles.loader} /> : null}

          {activeTab === 'cancelled' ? (
            <View style={styles.refundBanner}>
              <Feather name="info" size={16} color="#9A3412" />
              <Text style={styles.refundBannerText}>
                Confirm a customer’s refund request first. After they provide their e-wallet destination,
                send the transfer manually and record its reference here. Wallet refunds are handled automatically.
              </Text>
            </View>
          ) : null}

          {activeTab === 'summary' ? (
            summary.length > 0 ? summary.map(renderBatchSummary) : (
              <View style={styles.emptyState}>
                <View style={styles.emptyIcon}>
                  <Feather name="layers" size={23} color="#C2410C" />
                </View>
                <Text style={styles.emptyTitle}>No prep totals yet</Text>
                <Text style={styles.emptyText}>
                  Pickup-window totals appear here after customers place orders.
                </Text>
              </View>
            )
          ) : null}

          {activeTab === 'completed' ? (
            <View style={styles.historyNotice}>
              <View style={styles.historyIcon}>
                <Feather name="archive" size={19} color="#57534E" />
              </View>
              <View style={styles.historyCopy}>
                <Text style={styles.historyTitle}>
                  {countFor('completed')} completed {countFor('completed') === 1 ? 'order' : 'orders'} archived
                </Text>
                <Text style={styles.historyText}>
                  Completed orders are kept in your records and removed from this work queue.
                </Text>
              </View>
            </View>
          ) : null}

          {activeTab !== 'summary' && activeTab !== 'completed' && !loading && visibleOrders.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Feather name="clipboard" size={23} color="#C2410C" />
              </View>
              <Text style={styles.emptyTitle}>
                No {orderTabs.find((tab) => tab.key === activeTab)?.label.toLowerCase()} orders
              </Text>
              <Text style={styles.emptyText}>New customer orders will appear here automatically.</Text>
            </View>
          ) : null}

          {activeTab !== 'completed' ? visibleOrders.map(renderOrderCard) : null}
        </ScrollView>

        {scannerVisible ? (
          <View style={styles.scanner}>
            {cameraPermission?.granted && !manualEntryVisible ? (
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={scanLocked ? undefined : handleBarcodeScanned}
              />
            ) : null}
            <SafeAreaView style={styles.scannerOverlay}>
              <View style={styles.scannerHeader}>
                <View>
                  <Text style={styles.scannerEyebrow}>TOLEDOGO PICKUP</Text>
                  <Text style={styles.scannerTitle}>
                    {manualEntryVisible ? 'Enter order number' : 'Scan customer QR'}
                  </Text>
                  <Text style={styles.scannerSubtitle}>
                    {manualEntryVisible
                      ? 'Use the code from the customer’s Orders list.'
                      : 'Center the receipt code in the frame.'}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setScannerVisible(false);
                    setScanLocked(false);
                    setManualEntryVisible(false);
                  }}
                  style={styles.scannerClose}
                  accessibilityLabel="Close scanner"
                >
                  <Feather name="x" size={22} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
              {manualEntryVisible ? (
                <View style={styles.manualEntryCard}>
                  <Text style={styles.manualEntryTitle}>Manual pickup lookup</Text>
                  <Text style={styles.manualEntryText}>
                    Ask the customer to open Orders and read the 8-character code after ORD-.
                  </Text>
                  <TextInput
                    style={styles.manualOrderInput}
                    value={manualOrderNumber}
                    onChangeText={setManualOrderNumber}
                    placeholder="ORD-XXXXXXXX"
                    placeholderTextColor="#A8A29E"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                    returnKeyType="search"
                    onSubmitEditing={() => { void findOrderByNumber(); }}
                    accessibilityLabel="Customer order number"
                  />
                  <TouchableOpacity
                    style={[styles.doneButton, scanLocked && styles.manualEntryDisabled]}
                    onPress={() => { void findOrderByNumber(); }}
                    disabled={scanLocked}
                    accessibilityRole="button"
                  >
                    <Text style={styles.doneButtonText}>
                      {scanLocked ? 'Looking up order...' : 'Find order'}
                    </Text>
                  </TouchableOpacity>
                  {cameraPermission?.granted ? (
                    <TouchableOpacity
                      style={styles.manualEntryLink}
                      onPress={() => setManualEntryVisible(false)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.manualEntryLinkText}>Back to QR scanner</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : (
                <>
                  <View style={styles.scanFrame} />
                  <View style={styles.scannerHint}>
                    <Text style={styles.scannerHintText}>
                      Only orders belonging to your kitchen can be confirmed.
                    </Text>
                    <TouchableOpacity
                      style={styles.manualEntryLink}
                      onPress={() => setManualEntryVisible(true)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.manualEntryLinkText}>Enter order number instead</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </SafeAreaView>
          </View>
        ) : null}

        {scannedOrder ? (
          <View style={styles.receiptOverlay}>
            <SafeAreaView style={styles.safeArea}>
              <ScrollView contentContainerStyle={styles.receiptContent}>
                <View style={styles.receiptHeader}>
                  <View>
                    <Text style={styles.receiptEyebrow}>PICKUP CONFIRMED</Text>
                    <Text style={styles.receiptTitle}>Order complete</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setScannedOrder(null)}
                    style={styles.receiptClose}
                    accessibilityLabel="Close receipt"
                  >
                    <Feather name="x" size={20} color="#9A3412" />
                  </TouchableOpacity>
                </View>
                <View style={styles.orderCard}>
                  <Text style={styles.orderNumber}>ORDER #{scannedOrder.id.slice(0, 8).toUpperCase()}</Text>
                  <Text style={styles.customerName}>{scannedOrder.customer_name || 'Customer'}</Text>
                  <Text style={styles.receiptDate}>{formatDateTime(scannedOrder.created_at)}</Text>
                  <View style={styles.itemsPanel}>
                    {(scannedOrder.items ?? []).map((item, index) => (
                      <View key={`${scannedOrder.id}-receipt-${index}`} style={styles.itemRow}>
                        <Text style={styles.itemName}>{item.qty} × {item.name}</Text>
                        <Text style={styles.itemPrice}>
                          PHP {Number(item.price * item.qty).toFixed(2)}
                        </Text>
                      </View>
                    ))}
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Order total</Text>
                      <Text style={styles.totalValue}>
                        PHP {Number(scannedOrder.total).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.successNotice}>
                  <Feather name="check-circle" size={19} color="#047857" />
                  <Text style={styles.successNoticeText}>This pickup has been marked complete.</Text>
                </View>
                <TouchableOpacity style={styles.doneButton} onPress={() => setScannedOrder(null)}>
                  <Text style={styles.doneButtonText}>Done</Text>
                </TouchableOpacity>
              </ScrollView>
            </SafeAreaView>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF9F2' },
  safeArea: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 3 },
  subtitle: { color: 'rgba(255,255,255,0.82)', fontSize: 11, fontWeight: '600', marginTop: 3 },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  scanButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  tabs: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3E8DC',
  },
  tab: {
    minHeight: 39,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: '#FAF7F3',
    borderWidth: 1,
    borderColor: '#F0E8E0',
  },
  tabActive: { backgroundColor: '#9A3412', borderColor: '#9A3412' },
  tabLabel: { color: '#57534E', fontSize: 11, fontWeight: '800' },
  tabLabelActive: { color: '#FFFFFF' },
  count: {
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: '#F0E8E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  countText: { color: '#57534E', fontSize: 9, fontWeight: '900' },
  countTextActive: { color: '#FFFFFF' },
  content: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 35 },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    marginBottom: 14,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1E7DC',
  },
  overviewIcon: {
    width: 39,
    height: 39,
    borderRadius: 13,
    backgroundColor: '#FFF1E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overviewCopy: { flex: 1, marginLeft: 11 },
  overviewTitle: { color: '#292524', fontSize: 14, fontWeight: '900' },
  overviewSubtitle: { color: '#78716C', fontSize: 10, marginTop: 4 },
  refreshButton: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: '#FFF7ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loader: { marginVertical: 28 },
  errorPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 13,
    padding: 12,
    marginBottom: 13,
  },
  errorText: { color: '#B91C1C', fontSize: 12, flex: 1, lineHeight: 17 },
  refundBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 12,
    marginBottom: 12,
    borderRadius: 13,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  refundBannerText: { flex: 1, color: '#9A3412', fontSize: 11, lineHeight: 16 },
  orderCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F1E7DC',
    borderRadius: 18,
    padding: 15,
    marginBottom: 13,
    shadowColor: '#7C2D12',
    shadowOpacity: 0.045,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  orderIdentity: { flex: 1 },
  orderNumber: { color: '#9A3412', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  customerName: { color: '#292524', fontSize: 16, fontWeight: '900', marginTop: 4 },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  statusPillText: { fontSize: 10, fontWeight: '900' },
  detailLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  detailText: { color: '#57534E', fontSize: 11, lineHeight: 16, flex: 1 },
  itemsPanel: {
    backgroundColor: '#FAF7F3',
    borderRadius: 13,
    padding: 12,
    marginTop: 13,
  },
  panelHeading: { color: '#A8A29E', fontSize: 9, fontWeight: '900', letterSpacing: 1, marginBottom: 9 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  itemName: { color: '#44403C', fontSize: 12, fontWeight: '700', flex: 1 },
  itemPrice: { color: '#57534E', fontSize: 11, fontWeight: '700' },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#E7DED4',
    marginTop: 3,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { color: '#57534E', fontSize: 12, fontWeight: '800' },
  totalValue: { color: '#9A3412', fontSize: 16, fontWeight: '900' },
  paymentRow: {
    marginTop: 11,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
  },
  paymentVerifyButton: {
    minHeight: 36,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 10,
    backgroundColor: '#92400E',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  paymentVerifyButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  paymentVerified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  paymentVerifiedText: { color: '#166534', fontSize: 10, fontWeight: '900' },
  paymentRejected: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  paymentRejectedText: { color: '#B91C1C', fontSize: 10, fontWeight: '900' },
  paymentReference: { color: '#78716C', fontSize: 10, marginTop: 5 },
  notePanel: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: '#FFF7ED',
    borderRadius: 12,
    padding: 10,
    marginTop: 10,
  },
  noteCopy: { flex: 1 },
  noteLabel: { color: '#9A3412', fontSize: 8, fontWeight: '900', letterSpacing: 0.8, marginBottom: 3 },
  noteText: { color: '#57534E', fontSize: 11, lineHeight: 16 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 9, marginTop: 14 },
  cancelButton: {
    minHeight: 42,
    minWidth: 78,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E7DED4',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 13,
  },
  cancelButtonText: { color: '#78716C', fontSize: 11, fontWeight: '800' },
  primaryAction: {
    minHeight: 42,
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#15803D',
  },
  primaryActionFull: { flex: 1 },
  primaryActionText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  refundInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    padding: 10,
    marginTop: 12,
    borderRadius: 11,
    backgroundColor: '#FFF7ED',
  },
  refundInfoText: { color: '#9A3412', fontSize: 11, fontWeight: '700', flex: 1, lineHeight: 16 },
  recordRefundButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    marginTop: 10,
    borderRadius: 11,
    backgroundColor: '#15803D',
  },
  recordRefundButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  refundModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
    backgroundColor: 'rgba(28, 25, 23, 0.6)',
  },
  refundModalCard: {
    padding: 20,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
  },
  refundModalEyebrow: { color: '#C2410C', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  refundModalTitle: { color: '#292524', fontSize: 18, fontWeight: '900', marginTop: 6 },
  refundModalText: { color: '#57534E', fontSize: 12, lineHeight: 18, marginTop: 8 },
  refundReferenceInput: {
    minHeight: 46,
    paddingHorizontal: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 11,
    color: '#292524',
    fontSize: 13,
  },
  refundProofButton: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 9,
    borderWidth: 1,
    borderColor: '#FED7AA',
    borderRadius: 11,
    backgroundColor: '#FFF7ED',
  },
  refundProofText: { color: '#9A3412', fontSize: 11, fontWeight: '800' },
  refundProofPreview: { width: '100%', height: 130, marginTop: 9, borderRadius: 11, resizeMode: 'cover' },
  refundModalActions: { flexDirection: 'row', gap: 10, marginTop: 15 },
  refundCancelButton: {
    minHeight: 42,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#F5F5F4',
  },
  refundCancelText: { color: '#57534E', fontSize: 11, fontWeight: '800' },
  refundModalSubmit: { flex: 1, marginTop: 0 },
  batchMeta: { color: '#57534E', fontSize: 11, fontWeight: '700', marginBottom: 3 },
  statusPillSummary: { backgroundColor: '#DBEAFE' },
  statusTextSummary: { color: '#1D4ED8', textTransform: 'capitalize' },
  emptyState: { alignItems: 'center', paddingVertical: 52, paddingHorizontal: 24 },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF1E6',
  },
  emptyTitle: { color: '#292524', fontSize: 16, fontWeight: '900', marginTop: 13 },
  emptyText: { color: '#78716C', fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 5 },
  historyNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 15,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#E7DED4',
    backgroundColor: '#FFFFFF',
  },
  historyIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F4',
  },
  historyCopy: { flex: 1 },
  historyTitle: { color: '#292524', fontSize: 12, fontWeight: '900' },
  historyText: { color: '#78716C', fontSize: 10, lineHeight: 15, marginTop: 4 },
  scanner: { ...StyleSheet.absoluteFill, backgroundColor: '#292524' },
  scannerOverlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  scannerHeader: {
    paddingHorizontal: 20,
    paddingTop: 13,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  scannerEyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  scannerTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 5 },
  scannerSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 },
  scannerClose: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: 'rgba(41,37,36,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanFrame: {
    alignSelf: 'center',
    width: 260,
    height: 260,
    borderWidth: 2,
    borderColor: '#FDBA74',
    borderRadius: 24,
  },
  scannerHint: { alignSelf: 'center', marginBottom: 28, marginHorizontal: 25, padding: 12, borderRadius: 13, backgroundColor: 'rgba(41,37,36,0.75)' },
  scannerHintText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  manualEntryCard: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    padding: 20,
    borderRadius: 18,
    backgroundColor: '#FFF9F2',
  },
  manualEntryTitle: { color: '#292524', fontSize: 18, fontWeight: '900' },
  manualEntryText: { color: '#57534E', fontSize: 12, lineHeight: 18, marginTop: 6 },
  manualOrderInput: {
    minHeight: 48,
    paddingHorizontal: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#E7E5E4',
    borderRadius: 11,
    color: '#292524',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  manualEntryDisabled: { opacity: 0.6 },
  manualEntryLink: { alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 8, marginTop: 6 },
  manualEntryLinkText: { color: '#FED7AA', fontSize: 12, fontWeight: '800' },
  receiptOverlay: { ...StyleSheet.absoluteFill, backgroundColor: '#FFF9F2' },
  receiptContent: { padding: 18, paddingBottom: 30 },
  receiptHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  receiptEyebrow: { color: '#9A3412', fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  receiptTitle: { color: '#292524', fontSize: 23, fontWeight: '900', marginTop: 4 },
  receiptClose: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center' },
  receiptDate: { color: '#78716C', fontSize: 11, marginTop: 8 },
  successNotice: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 13, borderRadius: 13, backgroundColor: '#ECFDF5', marginTop: 12 },
  successNoticeText: { color: '#065F46', fontSize: 12, lineHeight: 17, fontWeight: '800', flex: 1 },
  doneButton: { minHeight: 48, borderRadius: 14, backgroundColor: '#C2410C', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  doneButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});
