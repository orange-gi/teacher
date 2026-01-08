import { NavigationContainer } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GraphScreen } from './src/screens/GraphScreen';
import { TeacherScreen } from './src/screens/TeacherScreen';

const Tab = createMaterialTopTabNavigator();

export default function App() {
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05070d',
  },
});

