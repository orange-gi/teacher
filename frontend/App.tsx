// 由平台分文件实现：
// - App.web.tsx：Web 端（不引入 react-navigation/material-top-tabs，避免白屏）
// - App.native.tsx：iOS/Android（保留原生导航）
export { default } from './App.native';
