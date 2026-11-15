import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Platform, RefreshControl, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../../Services/supabase';
import { hasActiveVendorPro } from '../../constants/vendor-subscriptions';

type Menu = { id: string; name: string; stock_quantity: number };
type Batch = { id: string; name: string; meetup_location?: string | null; starts_at: string; cutoff_at: string; pickup_at: string; pickup_window_end: string; max_orders: number; status: string };
type ScheduleField = 'pickupAt';
type PickerMode = 'date' | 'time';
const tomorrowAt = (hour: number) => { const value = new Date(); value.setDate(value.getDate() + 1); value.setHours(hour, 0, 0, 0); return value; };
const cutoffForPickup = (pickupAt: Date) => new Date(pickupAt.getTime() - 30 * 60 * 1000);
const immediateOrderStart = () => new Date(Date.now() - 60_000).toISOString();
const formatDate = (value: Date) => value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const formatTime = (value: Date) => value.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const webDateValue = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const webTimeValue = (value: Date) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;

export default function VendorBatchesScreen() {
  const router = useRouter();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [menus, setMenus] = useState<Menu[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editingBatchLimit, setEditingBatchLimit] = useState(0);
  const [meetupLocation, setMeetupLocation] = useState('');
  const [batchCapacityLimit, setBatchCapacityLimit] = useState(1);
  const [fulfillmentMode, setFulfillmentMode] = useState<'instore' | 'meetup' | 'both'>('instore');
  const [pickupAt, setPickupAt] = useState(() => tomorrowAt(16));
  const cutoffAt = cutoffForPickup(pickupAt);
  const [picker, setPicker] = useState<{ field: ScheduleField; mode: PickerMode } | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      setError(null);
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) { router.replace('/login'); return; }
      setVendorId(userData.user.id);
      const { data: vendor, error: vendorError } = await supabase.from('vendors').select('fulfillment_mode, subscription_tier, subscription_status, subscription_expires_at').eq('id', userData.user.id).maybeSingle();
      if (vendorError) throw vendorError;
      const isFreePlan = !hasActiveVendorPro(vendor?.subscription_tier, vendor?.subscription_status, vendor?.subscription_expires_at);
      const rawMode = vendor?.fulfillment_mode;
      const mode = isFreePlan ? 'meetup' : (rawMode === 'meetup' || rawMode === 'both' ? rawMode : 'instore');
      setBatchCapacityLimit(isFreePlan ? 1 : 8);
      setFulfillmentMode(mode);
      if (mode === 'instore' || isFreePlan) {
        setMeetupLocation('');
      }
      if (isFreePlan && rawMode !== 'meetup') {
        const { error: fulfillmentError } = await supabase
          .from('vendors')
          .update({ fulfillment_mode: 'meetup' })
          .eq('id', userData.user.id);
        if (fulfillmentError) throw fulfillmentError;
      }
      const { error: syncError } = await supabase.rpc('sync_vendor_batch_statuses');
      if (syncError) throw syncError;
      const [{ data: batchRows, error: batchError }, { data: menuRows, error: menuError }] = await Promise.all([
        supabase.from('vendor_batches').select('id, name, meetup_location, starts_at, cutoff_at, pickup_at, pickup_window_end, max_orders, status').eq('vendor_id', userData.user.id).in('status', ['scheduled', 'open', 'full', 'closed']).order('pickup_at'),
        supabase.from('menus').select('id, name, stock_quantity').eq('vendor_id', userData.user.id).eq('is_available', true),
      ]);
      if (batchError) throw batchError;
      if (menuError) throw menuError;
      setBatches((batchRows ?? []) as Batch[]);
      setMenus((menuRows ?? []) as Menu[]);
    } catch (loadError: any) { setError(loadError.message ?? 'Unable to load batches. Run batch-scheduling.sql first.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, [router]);

  useEffect(() => { let mounted = true; const run = async () => { await loadBatches(); if (!mounted) return; }; run(); return () => { mounted = false; }; }, [loadBatches]);

  const resetBatchForm = () => {
    setEditingBatchId(null);
    setEditingBatchLimit(0);
    setMeetupLocation('');
    setPickupAt(tomorrowAt(16));
    setPicker(null);
  };

  const editBatch = (batch: Batch) => {
    setEditingBatchId(batch.id);
    setEditingBatchLimit(batch.max_orders);
    setMeetupLocation(batch.meetup_location ?? '');
    setPickupAt(new Date(batch.pickup_at));
    setPicker(null);
  };

  const createBatch = async () => {
    if (fulfillmentMode === 'instore') {
      Alert.alert('In-store vendors do not use pickup windows', 'Pickup windows are available for meetup or both fulfillment modes only.');
      return;
    }
    if (!vendorId || (!editingBatchId && !menus.length)) { Alert.alert('Add menu items first', 'A new meetup needs at least one available menu item.'); return; }
    const activeBatchCount = batches.filter((batch) => new Date(batch.pickup_at).getTime() > Date.now()).length;
    if (!editingBatchId && activeBatchCount >= batchCapacityLimit) {
      Alert.alert('Meetup schedule is full', `Your plan allows ${batchCapacityLimit} active meetup ${batchCapacityLimit === 1 ? 'window' : 'windows'} at a time. Wait for one to finish, or cancel one if it has no orders.`);
      return;
    }
    const stockOrderLimit = menus.reduce((total, menu) => total + Math.max(0, Number(menu.stock_quantity) || 0), 0);
    const orderLimit = editingBatchId ? editingBatchLimit : stockOrderLimit;
    if (orderLimit < 1) { Alert.alert('No available stock', 'Add available stock to at least one menu item before scheduling a meetup.'); return; }
    if (!meetupLocation.trim()) { Alert.alert('Meetup location required', 'Add the location customers should use for this batch.'); return; }
    if (cutoffAt <= new Date()) { Alert.alert('Choose a later pickup time', 'Meetup pickup must be at least 30 minutes from now because orders close 30 minutes before pickup.'); return; }
    setSaving(true);
    try {
      const batchValues = {
        batch_name: `Meetup · ${formatDate(pickupAt)} ${formatTime(pickupAt)}`,
        batch_meetup_location: meetupLocation.trim() || null,
        batch_starts_at: immediateOrderStart(),
        batch_cutoff_at: cutoffAt.toISOString(),
        batch_pickup_at: pickupAt.toISOString(),
        batch_max_orders: orderLimit,
      };
      const result = editingBatchId
        ? await supabase.rpc('update_vendor_batch', { target_batch_id: editingBatchId, ...batchValues })
        : await supabase.rpc('create_vendor_batch', batchValues);
      if (result.error) throw result.error;
      const wasEditing = Boolean(editingBatchId);
      resetBatchForm();
      Alert.alert(wasEditing ? 'Meetup updated' : 'Meetup published', wasEditing ? 'The scheduled meetup has been updated.' : 'Customers can order now. Orders close 30 minutes before pickup.');
      await loadBatches();
    } catch (saveError: any) { Alert.alert('Could not create batch', saveError.message); }
    finally { setSaving(false); }
  };

  const cancelBatch = (batch: Batch) => Alert.alert('Cancel meetup?', 'A future meetup can only be cancelled if no orders have been placed.', [
    { text: 'Keep window', style: 'cancel' },
    { text: 'Cancel window', style: 'destructive', onPress: async () => {
      setSaving(true);
      try {
        const { error: cancelError } = await supabase.rpc('cancel_vendor_batch', { target_batch_id: batch.id });
        if (cancelError) throw cancelError;
        Alert.alert('Meetup cancelled', 'The meetup is no longer available to customers.');
        await loadBatches();
      } catch (cancelError: any) {
        Alert.alert('Could not cancel window', cancelError.message);
      } finally {
        setSaving(false);
      }
    } },
  ]);

  const scheduleValues = { pickupAt };
  const updateSchedule = (field: ScheduleField, value: Date) => {
    const next = new Date(scheduleValues[field]);
    if (picker?.mode === 'date') next.setFullYear(value.getFullYear(), value.getMonth(), value.getDate());
    else next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    setPickupAt(next);
    setPicker(null);
  };

  const renderWebPicker = (field: ScheduleField, mode: PickerMode, value: Date) => React.createElement('input', {
    type: mode,
    value: mode === 'date' ? webDateValue(value) : webTimeValue(value),
    onChange: (event: { target: { value: string } }) => {
      if (!event.target.value) return;
      const next = new Date(value);
      if (mode === 'date') { const [year, month, day] = event.target.value.split('-').map(Number); next.setFullYear(year, month - 1, day); }
      else { const [hours, minutes] = event.target.value.split(':').map(Number); next.setHours(hours, minutes, 0, 0); }
      setPickupAt(next);
    },
    style: { width: '100%', minHeight: 42, border: '1px solid #E7D9CC', borderRadius: 11, backgroundColor: '#FFF9F2', color: '#292524', padding: '0 12px', fontSize: 14 },
  });

  const renderScheduleRow = (field: ScheduleField, label: string, value: Date) => <View style={styles.scheduleRow}><Text style={styles.fieldLabel}>Meetup location</Text><TextInput style={styles.input} value={meetupLocation} onChangeText={setMeetupLocation} placeholder="e.g. Toledo City Plaza, main fountain" placeholderTextColor="#A8A29E" /><Text style={styles.fieldLabel}>{label}</Text><View style={styles.pickerButtons}><TouchableOpacity style={styles.pickerButton} onPress={() => setPicker({ field, mode: 'date' })}><Feather name="calendar" size={15} color="#C2410C" /><Text style={styles.pickerText}>{formatDate(value)}</Text></TouchableOpacity><TouchableOpacity style={styles.pickerButton} onPress={() => setPicker({ field, mode: 'time' })}><Feather name="clock" size={15} color="#C2410C" /><Text style={styles.pickerText}>{formatTime(value)}</Text></TouchableOpacity></View>{Platform.OS === 'web' && picker?.field === field ? <View style={styles.webPicker}>{renderWebPicker(field, picker.mode, value)}</View> : null}</View>;

  return <View style={styles.container}><StatusBar barStyle="light-content" backgroundColor="#7C2D12" /><SafeAreaView style={styles.safeArea}><View style={styles.header}><TouchableOpacity style={styles.back} onPress={() => router.replace('/vendor/dashboard')}><Feather name="arrow-left" size={19} color="#292524" /></TouchableOpacity><View style={styles.headerCopy}><Text style={styles.eyebrow}>MEETUP PICKUPS</Text><Text style={styles.title}>Meetup schedule</Text><Text style={styles.subtitle}>Set a place and pickup time for customer orders.</Text></View><Feather name="calendar" size={27} color="#FED7AA" /></View><ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBatches(); }} tintColor="#C2410C" />}>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <View style={styles.form}>
      <Text style={styles.sectionTitle}>{editingBatchId ? 'Edit meetup' : 'Schedule a meetup'}</Text>
      <Text style={styles.helper}>Choose where and when customers meet you. Orders open as soon as you publish and close 30 minutes before pickup.</Text>
      {renderScheduleRow('pickupAt', 'Pickup time', pickupAt)}
      {picker && Platform.OS !== 'web' ? <DateTimePicker value={scheduleValues[picker.field]} mode={picker.mode} display="default" onChange={(_, value) => { if (value) updateSchedule(picker.field, value); else setPicker(null); }} /> : null}
      <Text style={styles.hint}>Orders close {formatDate(cutoffAt)} at {formatTime(cutoffAt)}. Pickup lasts 30 minutes. Available menu stock controls how many portions customers can order. {editingBatchId ? 'Inventory stays unchanged when you edit a meetup.' : `${batches.length} of ${batchCapacityLimit} active meetup windows used on your plan.`}</Text>
      <TouchableOpacity style={styles.button} onPress={createBatch} disabled={saving}>
        {saving ? <ActivityIndicator color="#FFFFFF" /> : <><Feather name={editingBatchId ? 'save' : 'plus-circle'} size={16} color="#FFFFFF" /><Text style={styles.buttonText}>{editingBatchId ? 'Save changes' : 'Publish meetup'}</Text></>}
      </TouchableOpacity>
      {editingBatchId ? <TouchableOpacity onPress={resetBatchForm} disabled={saving} style={{ alignItems: 'center', paddingVertical: 12 }}><Text style={{ color: '#78716C', fontSize: 12, fontWeight: '800' }}>Discard changes</Text></TouchableOpacity> : null}
    </View>
    <Text style={styles.sectionTitle}>Your windows</Text>
    {loading ? <ActivityIndicator color="#C2410C" style={styles.loader} /> : null}
    {!loading && !batches.length ? <Text style={styles.empty}>No windows yet.</Text> : null}
    {batches.map((batch) => <View key={batch.id} style={styles.batch}>
      <View style={styles.batchTop}><Text style={styles.batchName}>{batch.name}</Text><Text style={styles.status}>{batch.status}</Text></View>
      {batch.meetup_location ? <Text style={styles.batchInfo}>{batch.meetup_location}</Text> : null}
      <Text style={styles.batchInfo}>Ordering started {new Date(batch.starts_at).toLocaleString()}</Text>
      <Text style={styles.batchInfo}>Order cutoff {new Date(batch.cutoff_at).toLocaleString()}</Text>
      <Text style={styles.batchInfo}>Meetup {new Date(batch.pickup_at).toLocaleString()} - {new Date(batch.pickup_window_end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text>
      <Text style={styles.batchInfo}>Up to {batch.max_orders} orders, limited by menu stock</Text>
      {batch.status === 'scheduled' || batch.status === 'open' || batch.status === 'closed' ? <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity onPress={() => editBatch(batch)} style={{ flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: '#FFF7ED' }}>
          <Feather name="edit-2" size={14} color="#9A3412" /><Text style={{ color: '#9A3412', fontSize: 11, fontWeight: '800' }}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => cancelBatch(batch)} disabled={saving} style={{ flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10, backgroundColor: '#FEF2F2' }}>
          <Feather name="x-circle" size={14} color="#B91C1C" /><Text style={{ color: '#B91C1C', fontSize: 11, fontWeight: '800' }}>Cancel</Text>
        </TouchableOpacity>
      </View> : null}
    </View>)}
  </ScrollView></SafeAreaView></View>;
}
const styles = StyleSheet.create({ container: { flex: 1, backgroundColor: '#FFF9F2' }, safeArea: { flex: 1 }, header: { padding: 18, backgroundColor: '#7C2D12', flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { width: 39, height: 39, borderRadius: 13, backgroundColor: '#FFEDD5', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1 }, eyebrow: { color: '#FED7AA', fontSize: 9, fontWeight: '900', letterSpacing: 1.3 }, title: { color: '#FFFFFF', fontSize: 24, fontWeight: '900', marginTop: 3 }, subtitle: { color: 'rgba(255,255,255,0.78)', fontSize: 11, marginTop: 3 }, content: { padding: 16, paddingBottom: 35 }, form: { padding: 15, borderRadius: 17, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3E8DC', marginBottom: 20 }, sectionTitle: { color: '#292524', fontSize: 18, fontWeight: '900', marginBottom: 6 }, helper: { color: '#78716C', fontSize: 11, lineHeight: 17, marginBottom: 12 }, input: { minHeight: 44, marginBottom: 12, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: '#E7D9CC', backgroundColor: '#FFF9F2', color: '#292524', fontSize: 12 }, scheduleRow: { marginBottom: 12 }, fieldLabel: { color: '#44403C', fontSize: 12, fontWeight: '800', marginBottom: 6 }, pickerButtons: { flexDirection: 'row', gap: 8 }, pickerButton: { flex: 1, minHeight: 44, paddingHorizontal: 10, borderRadius: 11, borderWidth: 1, borderColor: '#E7D9CC', backgroundColor: '#FFF9F2', flexDirection: 'row', alignItems: 'center', gap: 7 }, pickerText: { color: '#292524', fontSize: 12, flexShrink: 1 }, webPicker: { marginTop: 7 }, hint: { color: '#78716C', fontSize: 11, lineHeight: 17, marginVertical: 5 }, button: { minHeight: 46, marginTop: 8, borderRadius: 12, backgroundColor: '#C2410C', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, buttonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' }, batch: { padding: 14, borderRadius: 15, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F3E8DC', marginBottom: 10 }, batchTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 }, batchName: { color: '#292524', fontSize: 14, fontWeight: '900' }, status: { color: '#C2410C', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' }, batchInfo: { color: '#78716C', fontSize: 11, marginTop: 6 }, loader: { marginVertical: 25 }, empty: { color: '#78716C', textAlign: 'center', paddingVertical: 25 }, error: { color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 11, borderRadius: 10, fontSize: 12, marginBottom: 12 } });
