import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'llm_coach_user_id_v1';

function uuidv4(): string {
  // 不依赖额外库的轻量 UUID（够用：设备级匿名ID）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateUserId(): Promise<string> {
  const existing = await AsyncStorage.getItem(KEY);
  if (existing) return existing;
  const id = uuidv4();
  await AsyncStorage.setItem(KEY, id);
  return id;
}

