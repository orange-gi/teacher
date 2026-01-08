import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';

// react-navigation/gesture-handler 在 Web 端可能触发不兼容模块加载；仅在原生端加载
if (Platform.OS !== 'web') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('react-native-gesture-handler');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
