import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { fetchConsentDocuments, grantAiConsent } from './api';
import { DocumentBody } from './ConsentScreen';

export default function AiConsentSheet({ userId, onClose, onSaved, onUnauthorized }) {
  const [document, setDocument] = useState(null);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    setChecked(false);
    try {
      const response = await fetchConsentDocuments();
      const current = response.documents?.find((item) => item.type === 'AI_EXPLANATION');
      if (!current) throw new Error('AI 동의 문서를 불러올 수 없습니다.');
      setDocument(current);
    } catch (error) {
      setMessage(error.message || 'AI 동의 문서를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!checked || !document || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await grantAiConsent(userId, document);
      onSaved(response.user);
    } catch (error) {
      if (error.status === 401) {
        onUnauthorized();
      } else if (error.code === 'CONSENT_VERSION_STALE') {
        await load();
        setMessage('동의 문서가 바뀌었습니다. 새 내용을 읽고 다시 선택해 주세요.');
      } else {
        setMessage(error.message || 'AI 동의를 저장하지 못했습니다.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.backdrop}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>AI 설명 기능 동의</Text>
              <Text style={styles.subtitle}>내용을 확인하고 선택해 주세요.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="AI 동의 닫기" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={22} color="#173B2A" />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {loading ? <ActivityIndicator color="#176B46" style={styles.loading} /> : null}
            {document && !loading ? <>
              <Text style={styles.documentTitle}>{document.title}</Text>
              <Text style={styles.summary}>{document.summary}</Text>
              <DocumentBody document={document} />
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={document.checkboxLabel}
                accessibilityState={{ checked }}
                aria-checked={checked}
                onPress={() => setChecked((current) => !current)}
                style={[styles.checkboxRow, checked && styles.checkboxRowChecked]}
              >
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
                </View>
                <Text style={styles.checkboxText}>{document.checkboxLabel}</Text>
              </Pressable>
            </> : null}
            {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
            {!document && !loading ? <Pressable accessibilityRole="button" onPress={load} style={styles.retry}><Text style={styles.retryText}>다시 불러오기</Text></Pressable> : null}
          </ScrollView>
          <View style={styles.footer}>
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: !checked || loading || saving }} disabled={!checked || loading || saving} onPress={save} style={[styles.action, (!checked || loading || saving) && styles.actionDisabled]}>
              <Text style={styles.actionText}>{saving ? '저장 중…' : '동의하고 계속하기'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.decline}>
              <Text style={styles.declineText}>동의하지 않고 돌아가기</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 30, elevation: 30, backgroundColor: 'rgba(10,30,19,0.65)' },
  safe: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '90%', backgroundColor: '#FAF7F0', borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: '#E4ECE1' },
  headerCopy: { flex: 1 },
  title: { color: '#173B2A', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#73847A', fontSize: 12, marginTop: 4 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#FFFFFF' },
  content: { padding: 20, paddingBottom: 30 },
  loading: { marginVertical: 40 },
  documentTitle: { color: '#173B2A', fontSize: 17, fontWeight: '900', marginBottom: 8 },
  summary: { color: '#43584A', fontSize: 13, lineHeight: 20, marginBottom: 18 },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, padding: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D7E5D5', borderRadius: 16 },
  checkboxRowChecked: { borderColor: '#3F8F55', backgroundColor: '#E9F6E8' },
  checkbox: { width: 23, height: 23, borderRadius: 12, borderWidth: 1.5, borderColor: '#B8C8BB', alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { borderColor: '#3F8F55', backgroundColor: '#3F8F55' },
  checkboxText: { flex: 1, color: '#173B2A', fontSize: 13, fontWeight: '800', lineHeight: 19 },
  error: { color: '#C74B45', fontSize: 12, fontWeight: '700', marginTop: 15 },
  retry: { alignSelf: 'flex-start', padding: 12, backgroundColor: '#E9F6E8', borderRadius: 10 },
  retryText: { color: '#176B46', fontWeight: '800' },
  footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: '#E4ECE1' },
  action: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#176B46' },
  actionDisabled: { opacity: 0.45 },
  actionText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  decline: { alignItems: 'center', paddingTop: 14 },
  declineText: { color: '#73847A', fontSize: 12, fontWeight: '800' },
});
