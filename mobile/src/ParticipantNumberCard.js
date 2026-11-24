import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export default function ParticipantNumberCard({ number }) {
  const [message, setMessage] = useState('');
  if (!number) return null;

  const copy = async () => {
    try {
      const copied = await Clipboard.setStringAsync(number);
      setMessage(copied ? '번호를 복사했어요.' : '번호를 복사하지 못했어요.');
    } catch {
      setMessage('번호를 복사하지 못했어요.');
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>연구참여자 번호</Text>
      <Text selectable style={styles.number}>{number}</Text>
      <Text style={styles.hint}>설문에는 이 번호만 입력해 주세요.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="연구참여자 번호 복사" onPress={copy} style={styles.copyButton}>
        <Text style={styles.copyText}>번호 복사</Text>
      </Pressable>
      {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DDEADC', borderRadius: 18, padding: 20, marginVertical: 14 },
  label: { color: '#52695B', fontSize: 14, fontWeight: '700' },
  number: { color: '#173B2A', fontSize: 30, fontWeight: '800', letterSpacing: 2, marginTop: 8 },
  hint: { color: '#52695B', fontSize: 13, marginTop: 8 },
  copyButton: { alignSelf: 'flex-start', backgroundColor: '#176B46', borderRadius: 10, paddingHorizontal: 17, paddingVertical: 11, marginTop: 16 },
  copyText: { color: '#FFFFFF', fontWeight: '700' },
  message: { color: '#176B46', marginTop: 10 },
});
