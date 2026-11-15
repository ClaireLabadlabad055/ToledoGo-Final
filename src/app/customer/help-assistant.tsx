import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

const faqs = [
  {
    title: 'How do I place an order?',
    keywords: ['order', 'buy', 'purchase', 'checkout', 'menu', 'food'],
    answer: 'Open Explore, choose a kitchen, select an available menu item, and follow the checkout steps. The kitchen receives your order after it is submitted.',
  },
  {
    title: 'Where can I check my order status?',
    keywords: ['status', 'track', 'tracking', 'pending', 'preparing', 'ready', 'order update'],
    answer: 'Open the Orders tab to see your order status. ToledoGo shows updates such as Pending, Preparing, Ready, Completed, or Cancelled.',
  },
  {
    title: 'Where do I pick up my order?',
    keywords: ['pickup', 'pick up', 'meetup', 'meet-up', 'location', 'where', 'landmark'],
    answer: 'Open the order in your Orders tab and check its pickup details. Meet-up orders include the location details provided for that order.',
  },
  {
    title: 'How do I contact the kitchen?',
    keywords: ['contact', 'message', 'talk', 'call', 'vendor', 'kitchen'],
    answer: 'Open the kitchen or your order details to find the available contact or messaging options. For a specific order, contact that kitchen directly.',
  },
  {
    title: 'How do payments and refunds work?',
    keywords: ['payment', 'pay', 'gcash', 'maya', 'cash', 'refund', 'money'],
    answer: 'Payment options depend on the kitchen and the checkout choices shown for your order. If an order is cancelled, check its refund status in Orders for the latest information.',
  },
  {
    title: 'Can I cancel an order?',
    keywords: ['cancel', 'cancellation', 'stop order'],
    answer: 'Cancellation availability depends on the order status and ToledoGo rules. Open the order to see whether a cancellation action is available; contact the kitchen if you need help.',
  },
];

const getFaqAnswer = (question: string) => {
  const normalized = question.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ');
  const tokens = new Set(normalized.split(/\s+/).filter((token) => token.length > 2));
  let bestMatch: typeof faqs[number] | null = null;
  let bestScore = 0;

  for (const faq of faqs) {
    const score = faq.keywords.reduce((total, keyword) => {
      const normalizedKeyword = keyword.toLowerCase();
      return total + (normalized.includes(normalizedKeyword) ? (normalizedKeyword.includes(' ') ? 2 : 1) : 0)
        + (tokens.has(normalizedKeyword) ? 1 : 0);
    }, 0);
    if (score > bestScore) {
      bestMatch = faq;
      bestScore = score;
    }
  }

  return bestScore > 0 && bestMatch
    ? bestMatch.answer
    : 'I couldn’t match that to a ToledoGo FAQ. Check your Orders tab or contact the kitchen directly for help with a specific order.';
};

export default function CustomerHelpAssistantScreen() {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [askedQuestion, setAskedQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const canAsk = useMemo(() => question.trim().length > 0, [question]);

  const askQuestion = () => {
    const submittedQuestion = question.trim();
    if (!submittedQuestion) return;
    setAskedQuestion(submittedQuestion);
    setAnswer(getFaqAnswer(submittedQuestion));
    setQuestion('');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF9F2" />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
            <Feather name="arrow-left" size={20} color="#7C2D12" />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>TOLEDOGO SUPPORT</Text>
            <Text style={styles.title}>Help assistant</Text>
          </View>
          <Feather name="help-circle" size={23} color="#C2410C" />
        </View>

        <ScrollView style={styles.contentScroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.introCard}>
            <Text style={styles.introTitle}>What can I help with?</Text>
            <Text style={styles.introText}>Ask about ordering, order status, pickup, payments, or contacting a kitchen.</Text>
          </View>

          <TouchableOpacity
            style={styles.complaintButton}
            onPress={() => router.push('/customer/complaint')}
          >
            <Feather name="flag" size={17} color="#9A3412" />
            <View style={styles.complaintCopy}>
              <Text style={styles.complaintTitle}>Submit a complaint</Text>
              <Text style={styles.complaintText}>Report an app, account, payment, or service issue.</Text>
            </View>
            <Feather name="chevron-right" size={17} color="#9A3412" />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.complaintButton}
            onPress={() => router.push('/customer/feedback')}
          >
            <Feather name="star" size={17} color="#9A3412" />
            <View style={styles.complaintCopy}>
              <Text style={styles.complaintTitle}>Share feedback</Text>
              <Text style={styles.complaintText}>Rate your ToledoGo experience and leave a comment.</Text>
            </View>
            <Feather name="chevron-right" size={17} color="#9A3412" />
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>COMMON QUESTIONS</Text>
          {faqs.map((faq) => (
            <TouchableOpacity
              key={faq.title}
              style={styles.faqButton}
              onPress={() => {
                setAskedQuestion(faq.title);
                setAnswer(faq.answer);
              }}
            >
              <Text style={styles.faqText}>{faq.title}</Text>
              <Feather name="chevron-right" size={17} color="#9A3412" />
            </TouchableOpacity>
          ))}

          {askedQuestion ? (
            <View style={styles.conversation}>
              <Text style={styles.questionLabel}>YOUR QUESTION</Text>
              <Text style={styles.questionText}>{askedQuestion}</Text>
              <Text style={styles.answerLabel}>TOLEDOGO HELP</Text>
              <Text style={styles.answerText}>{answer}</Text>
              <Text style={styles.disclaimer}>Answers use ToledoGo’s built-in help information. No question is sent to an AI provider.</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={question}
            onChangeText={setQuestion}
            placeholder="Type a question..."
            placeholderTextColor="#A8A29E"
            returnKeyType="send"
            onSubmitEditing={askQuestion}
            maxLength={240}
          />
          <TouchableOpacity style={[styles.sendButton, !canAsk && styles.sendButtonDisabled]} onPress={askQuestion} disabled={!canAsk} accessibilityLabel="Ask a question">
            <Feather name="send" size={17} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFF9F2' },
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#F1E7DD' },
  backButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF1E8' },
  headerCopy: { flex: 1 },
  eyebrow: { color: '#C2410C', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#292524', fontSize: 21, fontWeight: '900', marginTop: 2 },
  contentScroll: { flex: 1 },
  content: { padding: 18, paddingBottom: 24 },
  introCard: { padding: 18, borderRadius: 19, backgroundColor: '#7C2D12', marginBottom: 22 },
  introTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  introText: { color: '#FFEDD5', fontSize: 12, lineHeight: 18, marginTop: 6 },
  complaintButton: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginBottom: 22, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FED7AA' },
  complaintCopy: { flex: 1 },
  complaintTitle: { color: '#7C2D12', fontSize: 13, fontWeight: '900' },
  complaintText: { color: '#78716C', fontSize: 10, lineHeight: 15, marginTop: 3 },
  sectionLabel: { color: '#9A3412', fontSize: 10, fontWeight: '900', letterSpacing: 1, marginBottom: 9 },
  faqButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, marginBottom: 8, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#F1E7DD' },
  faqText: { color: '#292524', fontSize: 13, fontWeight: '700', flex: 1, paddingRight: 10 },
  conversation: { padding: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FED7AA', marginTop: 15 },
  questionLabel: { color: '#9A3412', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  questionText: { color: '#292524', fontSize: 14, fontWeight: '700', marginTop: 5, marginBottom: 15 },
  answerLabel: { color: '#166534', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  answerText: { color: '#44403C', fontSize: 13, lineHeight: 20, marginTop: 5 },
  disclaimer: { color: '#78716C', fontSize: 10, lineHeight: 15, marginTop: 12 },
  composer: { flexDirection: 'row', gap: 9, padding: 13, borderTopWidth: 1, borderTopColor: '#F1E7DD', backgroundColor: '#FFFFFF', flexShrink: 0 },
  input: { flex: 1, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: '#E7D9CC', paddingHorizontal: 13, color: '#292524', fontSize: 13, backgroundColor: '#FFFCF9' },
  sendButton: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#C2410C' },
  sendButtonDisabled: { opacity: 0.45 },
});
