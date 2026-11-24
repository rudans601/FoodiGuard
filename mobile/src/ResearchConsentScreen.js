import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, Pressable, SafeAreaView, ScrollView, StatusBar,
  StyleSheet, Text, View,
} from 'react-native';

import { fetchResearchConsentDocument, submitResearchConsent } from './api';
import ParticipantNumberCard from './ParticipantNumberCard';

export function ResearchConsentCompleteScreen({ receipt, onContinue }) {
  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>연구 참여 동의 완료</Text>
        <Text style={styles.title}>참여자 번호가 발급됐어요</Text>
        <Text style={styles.intro}>연구 참여 동의가 서버에 기록됐습니다. 계정을 만들기 전에 번호를 확인해 주세요.</Text>
        <ParticipantNumberCard number={receipt?.participantNumber} />
        <Text style={styles.intro}>개인정보 수집에 별도로 동의하고 계정을 만들면 이 번호가 계정에 연결됩니다. 설문과 참여 철회 요청에도 같은 번호를 사용합니다.</Text>
        <Pressable accessibilityRole="button" onPress={onContinue} style={styles.button}>
          <Text style={styles.buttonText}>계정 만들기 계속</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function ResearchConsentScreen({ onAgree, onDecline, onLogin }) {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchResearchConsentDocument();
      if (!response.document?.text || !response.document?.contentHash) throw new Error('연구 설명문을 확인할 수 없습니다.');
      setDocument(response.document);
    } catch (cause) {
      setError(cause.message || '연구 설명문을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const agree = async () => {
    if (!document || saving) return;
    setSaving(true);
    setError('');
    try {
      const receipt = await submitResearchConsent(document);
      if (!/^FG-\d{4}$/.test(receipt.participantNumber || '') || !receipt.receiptId) {
        throw new Error('연구참여자 번호를 확인할 수 없습니다. 다시 시도해 주세요.');
      }
      onAgree(receipt);
    } catch (cause) {
      if (cause.code === 'RESEARCH_CONSENT_VERSION_STALE') setDocument(null);
      setError(cause.message || '연구 참여 동의를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar barStyle="dark-content" backgroundColor="#FAF7F0" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>연구 참여 결정</Text>
        <Text style={styles.title}>연구대상자를 위한 설명문</Text>
        <Text style={styles.intro}>가입 정보를 입력하기 전에 설명문 전문을 읽고 참여 여부를 결정해 주세요.</Text>
        {loading ? <View style={styles.status}><ActivityIndicator color="#176B46" /><Text>설명문을 불러오고 있어요…</Text></View> : null}
        {document && !loading ? (
          <View style={styles.paper}>
            <Text style={styles.version}>설명문 {document.version}</Text>
            <Text selectable style={styles.body}>{document.text}</Text>
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {error && !document ? <Pressable accessibilityRole="button" onPress={load} style={styles.retry}><Text style={styles.retryText}>다시 시도</Text></Pressable> : null}
        {document && !loading ? (
          <View style={styles.actions}>
            <Text style={styles.prompt}>설명문을 읽고 연구 참여에 동의하시겠습니까?</Text>
            <Pressable accessibilityRole="button" disabled={saving} onPress={agree} style={[styles.button, saving && styles.disabled]}>
              <Text style={styles.buttonText}>{saving ? '동의를 기록하고 있어요…' : '동의합니다'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={saving} onPress={onDecline} style={styles.outline}>
              <Text style={styles.outlineText}>동의하지 않습니다</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onLogin} style={styles.login}>
          <Text style={styles.loginText}>이미 참여 중인가요? 로그인</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#FAF7F0', paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  content: { padding: 22, paddingBottom: 52, width: '100%', maxWidth: 650, alignSelf: 'center' },
  eyebrow: { color: '#176B46', fontWeight: '700', marginBottom: 8 },
  title: { color: '#173B2A', fontSize: 25, fontWeight: '800', marginBottom: 10 },
  intro: { color: '#52695B', fontSize: 15, lineHeight: 23, marginBottom: 20 },
  paper: { backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E4ECE1', padding: 20 },
  version: { color: '#176B46', fontWeight: '700', marginBottom: 14 },
  body: { color: '#263C30', fontSize: 14, lineHeight: 23 },
  status: { padding: 30, alignItems: 'center', gap: 12 },
  error: { color: '#B42318', marginTop: 15, lineHeight: 22 },
  retry: { padding: 14, alignItems: 'center' },
  retryText: { color: '#176B46', fontWeight: '700' },
  actions: { marginTop: 25, gap: 12 },
  prompt: { color: '#173B2A', fontWeight: '700', fontSize: 16, marginBottom: 4 },
  button: { backgroundColor: '#176B46', borderRadius: 14, padding: 17, alignItems: 'center' },
  disabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
  outline: { borderColor: '#176B46', borderWidth: 1, borderRadius: 14, padding: 16, alignItems: 'center' },
  outlineText: { color: '#176B46', fontWeight: '700', fontSize: 16 },
  login: { marginTop: 25, alignItems: 'center', padding: 12 },
  loginText: { color: '#52695B', textDecorationLine: 'underline' },
});
