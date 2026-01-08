import 'react-native-gesture-handler';

import { NavigationContainer } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GraphScreen } from './src/screens/GraphScreen';
import { TeacherScreen } from './src/screens/TeacherScreen';

const Tab = createMaterialTopTabNavigator();

export default function App() {
  // Web 端：material-top-tabs 依赖的 pager/tab-view 兼容性不稳定，容易出现白屏。
  // 这里用“自定义顶部栏 + 条件渲染”保证 Web 一定可用；原生端继续用导航组件。
  if (Platform.OS === 'web') {
    return (
      <SafeAreaProvider>
        <View style={styles.container}>
          <StatusBar style="light" />
          <WebTopTabs />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <View style={styles.container}>
          <StatusBar style="light" />
          <Tab.Navigator
            screenOptions={{
              tabBarStyle: { backgroundColor: '#070b13', borderBottomColor: '#14213d', borderBottomWidth: 1 },
              tabBarIndicatorStyle: { backgroundColor: '#64b5f6', height: 3 },
              tabBarActiveTintColor: '#e8eefc',
              tabBarInactiveTintColor: '#86a0d2',
              tabBarLabelStyle: { fontWeight: '900' },
            }}
          >
            <Tab.Screen name="Teacher" component={TeacherScreen} />
            <Tab.Screen name="知识图谱" component={GraphScreen} />
          </Tab.Navigator>
        </View>
      </NavigationContainer>
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
      <View style={{ flex: 1 }}>
        {tab === 'teacher' ? <TeacherScreen /> : <GraphScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05070d',
  },
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
  webTabActive: {
    borderColor: '#64b5f6',
    backgroundColor: '#0b1a33',
  },
  webTabText: { color: '#e8eefc', fontWeight: '900' },
});
