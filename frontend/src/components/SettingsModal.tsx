import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiGet, apiPost } from '../api/client';
import type { LLMConfigOut } from '../api/types';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function SettingsModal({ visible, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState('https://api.openai.com');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [temperature, setTemperature] = useState('0.2');
  const [masked, setMasked] = useState('');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setErr(null);
    apiGet<LLMConfigOut>('/config/llm')
      .then((c) => {
        setBaseUrl(c.base_url);
        setModel(c.model);
        setTemperature(String(c.temperature));
        setMasked(c.api_key_masked || '');
        setApiKey('');
      })
      .catch((e: any) => setErr(e?.message || String(e)))
      .finally(() => setLoading(false));
  }, [visible]);

  const canSave = useMemo(() => {
    return Boolean(baseUrl.trim()) && Boolean(model.trim()) && Boolean(temperature.trim());
  }, [baseUrl, model, temperature]);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      const t = Number(temperature);
      const out = await apiPost<LLMConfigOut>('/config/llm', {
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(), // 允许空：表示“继续使用已有 key”
        model: model.trim(),
        temperature: Number.isFinite(t) ? t : 0.2,
      });
      setMasked(out.api_key_masked || '');
      setApiKey('');
      onClose();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>LLM 设置</Text>
            <Pressable onPress={onClose} style={styles.ghostBtn}>
              <Text style={styles.ghostText}>关闭</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator />
              <Text style={styles.muted}>读取配置中…</Text>
            </View>
          ) : (
            <>
              {err ? <Text style={styles.err}>{err}</Text> : null}

              <Text style={styles.label}>Base URL</Text>
              <TextInput value={baseUrl} onChangeText={setBaseUrl} style={styles.input} autoCapitalize="none" />

              <Text style={styles.label}>Model</Text>
              <TextInput value={model} onChangeText={setModel} style={styles.input} autoCapitalize="none" />

              <Text style={styles.label}>Temperature</Text>
              <TextInput value={temperature} onChangeText={setTemperature} style={styles.input} keyboardType="numeric" />

              <Text style={styles.label}>API Key（只保存到后端）</Text>
              <Text style={styles.muted}>
                当前：{masked ? masked : '未配置'}（若不想更改，留空即可）
              </Text>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
                placeholder="sk-…"
                placeholderTextColor="#666"
              />

              <View style={styles.footer}>
                <Pressable onPress={onClose} style={styles.ghostBtn}>
                  <Text style={styles.ghostText}>取消</Text>
                </Pressable>
                <Pressable
                  onPress={save}
                  disabled={!canSave || saving}
                  style={[styles.primaryBtn, (!canSave || saving) && { opacity: 0.5 }]}
                >
                  <Text style={styles.primaryText}>{saving ? '保存中…' : '保存'}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', padding: 16, justifyContent: 'center' },
  card: { backgroundColor: '#0b0f17', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#1b2a4a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: '#e8eefc', fontSize: 18, fontWeight: '700' },
  label: { color: '#b7c4e6', marginTop: 10, marginBottom: 6, fontSize: 12 },
  input: {
    backgroundColor: '#0f1726',
    borderWidth: 1,
    borderColor: '#1b2a4a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#e8eefc',
  },
  muted: { color: '#9bb0dc', fontSize: 12, marginTop: 4 },
  err: { color: '#ff7b7b', marginTop: 6 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  primaryBtn: { backgroundColor: '#3b82f6', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10 },
  primaryText: { color: '#061024', fontWeight: '800' },
  ghostBtn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: '#1b2a4a' },
  ghostText: { color: '#cfe0ff', fontWeight: '700' },
  center: { paddingVertical: 18, alignItems: 'center', gap: 8 },
});

