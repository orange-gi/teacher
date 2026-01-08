import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GraphScreen } from './src/screens/GraphScreen';
import { TeacherScreen } from './src/screens/TeacherScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <WebTopTabs />
      </View>
    </SafeAreaProvider>
  );
}

function WebTopTabs() {
  const [tab, setTab] = React.useState<'teacher' | 'graph'>('teacher');
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.webTabBar}>
        <Pressable onPress={() => setTab('teacher')} style={[styles.webTab, tab === 'teacher' && styles.webTabActive]}>
          <Text style={styles.webTabText}>Teacher</Text>
        </Pressable>
        <Pressable onPress={() => setTab('graph')} style={[styles.webTab, tab === 'graph' && styles.webTabActive]}>
          <Text style={styles.webTabText}>知识图谱</Text>
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>{tab === 'teacher' ? <TeacherScreen /> : <GraphScreen />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05070d' },
  webTabBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#14213d',
    backgroundColor: '#070b13',
  },
  webTab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1b2a4a',
  },
  webTabActive: { borderColor: '#64b5f6', backgroundColor: '#0b1a33' },
  webTabText: { color: '#e8eefc', fontWeight: '900' },
});

