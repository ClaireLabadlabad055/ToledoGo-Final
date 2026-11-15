import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useRouter } from 'expo-router';
import { supabase } from '../../Services/supabase';
import { hasActiveVendorPro } from '../../constants/vendor-subscriptions';

type PosMenuItem = {
  id: string;
  name: string;
  price: number;
  category?: string | null;
  is_available?: boolean | null;
};

type CartItem = PosMenuItem & {
  quantity: number;
};

export default function VendorPosScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [menus, setMenus] = useState<PosMenuItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cashReceived, setCashReceived] = useState('');
  const [dailyRevenue, setDailyRevenue] = useState(0);
  const [dailyOrders, setDailyOrders] = useState(0);
  const [receipt, setReceipt] = useState<{
    items: CartItem[];
    subtotal: number;
    cashReceived: number;
    changeDue: number;
    timestamp: string;
  } | null>(null);

  const loadDailySales = async (vendorId: string) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();

    const { data, error } = await supabase
      .from('orders')
      .select('total')
      .eq('vendor_id', vendorId)
      .eq('status', 'completed')
      .gte('created_at', startOfDay)
      .lt('created_at', endOfDay);

    if (error) throw error;
    const completedOrders = data ?? [];
    const todayRevenue = completedOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    setDailyRevenue(todayRevenue);
    setDailyOrders(completedOrders.length);
  };

  useEffect(() => {
    const loadPos = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          router.replace('/login');
          return;
        }

        const { data: vendorData, error: vendorError } = await supabase
          .from('vendors')
          .select('subscription_tier, subscription_status, subscription_expires_at')
          .eq('id', userData.user.id)
          .maybeSingle();

        if (vendorError) throw vendorError;
        if (!vendorData || !hasActiveVendorPro(vendorData.subscription_tier, vendorData.subscription_status, vendorData.subscription_expires_at)) {
          Alert.alert('Pro feature', 'Quick POS is available on the Pro / Storefront plan only.');
          router.replace('/vendor/dashboard');
          return;
        }

        const { data: menuRows, error: menuError } = await supabase
          .from('menus')
          .select('id, name, price, category, is_available')
          .eq('vendor_id', userData.user.id)
          .eq('is_available', true)
          .order('created_at', { ascending: false });

        if (menuError) throw menuError;
        setMenus((menuRows ?? []) as PosMenuItem[]);
        await loadDailySales(userData.user.id);
      } catch (error: any) {
        Alert.alert('Could not load POS', error.message ?? 'Please try again.');
      } finally {
        setLoading(false);
      }
    };

    loadPos();
  }, [router]);

  const addToCart = (menu: PosMenuItem) => {
    setCart((current) => {
      const match = current.find((item) => item.id === menu.id);
      if (match) {
        return current.map((item) => item.id === menu.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...current, { ...menu, quantity: 1 }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((current) =>
      current
        .map((item) =>
          item.id === id ? { ...item, quantity: Math.max(0, item.quantity + delta) } : item,
        )
        .filter((item) => item.quantity > 0),
    );
  };

  const subtotal = useMemo(
    () => cart.reduce((total, item) => total + item.price * item.quantity, 0),
    [cart],
  );

  const cashValue = Number(cashReceived || 0);
  const changeDue = cashValue > 0 ? Math.max(0, cashValue - subtotal) : 0;

  const completeSale = async () => {
    if (!cart.length) {
      Alert.alert('No items in cart', 'Add at least one item before completing the sale.');
      return;
    }

    if (cashValue < subtotal) {
      Alert.alert('Payment needed', 'Cash received must be at least the order total.');
      return;
    }

    try {
      const { data: sessionUser } = await supabase.auth.getUser();
      if (!sessionUser.user) {
        Alert.alert('Session expired', 'Please sign in again to complete the sale.');
        router.replace('/login');
        return;
      }

      const { data: sale, error } = await supabase.rpc('create_vendor_pos_sale', {
        p_items: cart.map((item) => ({ id: item.id, qty: item.quantity })),
        p_cash_received: cashValue,
      });

      if (error) throw error;
      const savedSale = Array.isArray(sale) ? sale[0] : sale;
      if (!savedSale?.order_id || savedSale.order_total == null) {
        throw new Error('The POS service did not return a saved sale.');
      }
      const savedTotal = Number(savedSale.order_total);

      const saleReceipt = {
        items: cart,
        subtotal: savedTotal,
        cashReceived: cashValue,
        changeDue: Math.max(0, cashValue - savedTotal),
        timestamp: new Date().toLocaleString(),
      };

      setReceipt(saleReceipt);
      setCart([]);
      setCashReceived('');

      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        try {
          await loadDailySales(userData.user.id);
        } catch (refreshError: any) {
          Alert.alert(
            'Sale recorded',
            `The sale was saved, but today’s totals could not refresh: ${refreshError.message ?? 'Please reopen Quick POS.'}`
          );
        }
      }
    } catch (error: any) {
      Alert.alert('Could not save sale', error.message ?? 'Please try again.');
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#7C2D12" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/vendor/dashboard')}>
            <Feather name="arrow-left" size={20} color="#9A3412" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>PRO POS</Text>
            <Text style={styles.title}>Quick sales</Text>
            <Text style={styles.subtitle}>Fast checkout for in-store transactions</Text>
          </View>
          <View style={styles.headerPill}>
            <MaterialCommunityIcons name="cash-register" size={20} color="#FFF7ED" />
          </View>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color="#C2410C" size="large" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.summaryStrip}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Today</Text>
                <Text style={styles.summaryValue}>{dailyOrders} sales</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Revenue</Text>
                <Text style={styles.summaryValue}>PHP {dailyRevenue.toFixed(2)}</Text>
              </View>
            </View>

            <View style={styles.menuPanel}>
              <Text style={styles.sectionLabel}>Menu items</Text>
              {menus.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Feather name="box" size={30} color="#C2410C" />
                  <Text style={styles.emptyTitle}>No active items yet</Text>
                  <Text style={styles.emptyText}>Add or enable menu items to start selling.</Text>
                </View>
              ) : (
                menus.map((menu) => (
                  <TouchableOpacity key={menu.id} style={styles.menuCard} onPress={() => addToCart(menu)}>
                    <View style={styles.menuInfo}>
                      <Text style={styles.menuName}>{menu.name}</Text>
                      <Text style={styles.menuMeta}>{menu.category || 'Menu item'}</Text>
                    </View>
                    <View style={styles.menuPriceWrap}>
                      <Text style={styles.menuPrice}>PHP {Number(menu.price).toFixed(2)}</Text>
                      <Feather name="plus-circle" size={18} color="#C2410C" />
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </View>

            <View style={styles.checkoutPanel}>
              <Text style={styles.sectionLabel}>Current sale</Text>

              {cart.length === 0 ? (
                <View style={styles.emptyCart}>
                  <Text style={styles.emptyCartText}>Cart is empty</Text>
                </View>
              ) : (
                cart.map((item) => (
                  <View key={item.id} style={styles.cartRow}>
                    <View style={styles.cartCopy}>
                      <Text style={styles.cartName}>{item.name}</Text>
                      <Text style={styles.cartPrice}>PHP {Number(item.price).toFixed(2)}</Text>
                    </View>

                    <View style={styles.qtyControls}>
                      <TouchableOpacity style={styles.qtyButton} onPress={() => changeQty(item.id, -1)}>
                        <Feather name="minus" size={14} color="#C2410C" />
                      </TouchableOpacity>
                      <Text style={styles.qtyText}>{item.quantity}</Text>
                      <TouchableOpacity style={styles.qtyButton} onPress={() => changeQty(item.id, 1)}>
                        <Feather name="plus" size={14} color="#C2410C" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}

              <View style={styles.summaryBox}>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Subtotal</Text>
                  <Text style={styles.summaryValue}>PHP {subtotal.toFixed(2)}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Cash received</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={cashReceived}
                    onChangeText={setCashReceived}
                    placeholder="0.00"
                    placeholderTextColor="#A8A29E"
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Change due</Text>
                  <Text style={styles.summaryValue}>PHP {changeDue.toFixed(2)}</Text>
                </View>
              </View>

              <TouchableOpacity style={styles.completeButton} onPress={completeSale}>
                <Text style={styles.completeButtonText}>Complete sale</Text>
              </TouchableOpacity>
            </View>

            {receipt ? (
              <View style={styles.receiptCard}>
                <View style={styles.receiptHeader}>
                  <Text style={styles.receiptTitle}>Receipt</Text>
                  <TouchableOpacity onPress={() => setReceipt(null)}>
                    <Feather name="x" size={18} color="#292524" />
                  </TouchableOpacity>
                </View>
                <Text style={styles.receiptTime}>{receipt.timestamp}</Text>
                {receipt.items.map((item) => (
                  <View key={`${item.id}-${item.quantity}`} style={styles.receiptRow}>
                    <Text style={styles.receiptItem}>{item.quantity}x {item.name}</Text>
                    <Text style={styles.receiptPrice}>PHP {(item.price * item.quantity).toFixed(2)}</Text>
                  </View>
                ))}
                <View style={styles.receiptDivider} />
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Subtotal</Text>
                  <Text style={styles.receiptPrice}>PHP {receipt.subtotal.toFixed(2)}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Cash</Text>
                  <Text style={styles.receiptPrice}>PHP {receipt.cashReceived.toFixed(2)}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Change</Text>
                  <Text style={styles.receiptPrice}>PHP {receipt.changeDue.toFixed(2)}</Text>
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF9F2' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    backgroundColor: '#7C2D12',
    gap: 10,
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
  eyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', marginTop: 3 },
  subtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 3 },
  headerPill: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 40 },
  summaryStrip: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryItem: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3E8DC',
    borderRadius: 14,
    padding: 12,
  },
  summaryLabel: { color: '#78716C', fontSize: 10, fontWeight: '800' },
  summaryValue: { color: '#292524', fontSize: 15, fontWeight: '900', marginTop: 6 },
  menuPanel: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3E8DC', borderRadius: 20, padding: 14 },
  checkoutPanel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#F3E8DC',
    borderRadius: 20,
    padding: 14,
    marginTop: 16,
  },
  sectionLabel: { color: '#292524', fontSize: 15, fontWeight: '900', marginBottom: 12 },
  menuCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FCD9AD',
    marginBottom: 10,
  },
  menuInfo: { flex: 1 },
  menuName: { color: '#292524', fontSize: 14, fontWeight: '800' },
  menuMeta: { color: '#78716C', fontSize: 10, marginTop: 3 },
  menuPriceWrap: { alignItems: 'flex-end' },
  menuPrice: { color: '#7C2D12', fontSize: 12, fontWeight: '900' },
  emptyBox: { alignItems: 'center', paddingVertical: 20 },
  emptyTitle: { color: '#292524', fontSize: 14, fontWeight: '900', marginTop: 10 },
  emptyText: { color: '#78716C', fontSize: 11, marginTop: 4, textAlign: 'center' },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3E8DC',
  },
  cartCopy: { flex: 1 },
  cartName: { color: '#292524', fontSize: 13, fontWeight: '800' },
  cartPrice: { color: '#78716C', fontSize: 11, marginTop: 3 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyButton: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#FFF1E6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: { color: '#292524', fontSize: 13, fontWeight: '900' },
  summaryBox: { marginTop: 12, backgroundColor: '#FFF9F2', borderRadius: 14, borderWidth: 1, borderColor: '#F3E8DC', padding: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  amountInput: {
    minWidth: 100,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E7D9CC',
    backgroundColor: '#FFFFFF',
    color: '#292524',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  completeButton: {
    marginTop: 6,
    backgroundColor: '#C2410C',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  emptyCart: { alignItems: 'center', paddingVertical: 18 },
  emptyCartText: { color: '#78716C', fontSize: 12, fontWeight: '700' },
  receiptCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#F3E8DC',
    padding: 14,
    marginTop: 18,
  },
  receiptHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  receiptTitle: { color: '#292524', fontSize: 18, fontWeight: '900' },
  receiptTime: { color: '#78716C', fontSize: 10, marginBottom: 10 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 6 },
  receiptItem: { flex: 1, color: '#292524', fontSize: 12, fontWeight: '700' },
  receiptPrice: { color: '#292524', fontSize: 12, fontWeight: '800' },
  receiptDivider: { height: 1, backgroundColor: '#F3E8DC', marginVertical: 10 },
  receiptLabel: { color: '#78716C', fontSize: 11, fontWeight: '700' },
});
