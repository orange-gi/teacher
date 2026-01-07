import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { apiGet, apiPost } from '../api/client';
import type { AskOut, LearningNode, SessionCreateOut, SessionListItem, SubmitAnswerOut } from '../api/types';
import { SettingsModal } from '../components/SettingsModal';
import { getOrCreateUserId } from '../utils/userId';

type PlanState = {
  outline: string;
  nodes: LearningNode[];
  unlockedOrder: number;
};

function isWide(): boolean {
  return Dimensions.get('window').width >= 860;
}

export function TeacherScreen() {
  const [userId, setUserId] = useState<string>('');
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [sessionId, setSessionId] = useState<string>('');
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [question, setQuestion] = useState('');
  const [topicHint, setTopicHint] = useState('asyncio / multiprocessing / 并发实战');

  const [asking, setAsking] = useState(false);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<number>(0); // 0=大纲，1..N=节点
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastGrade, setLastGrade] = useState<SubmitAnswerOut | null>(null);

  const [err, setErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    getOrCreateUserId().then(setUserId);
  }, []);

  useEffect(() => {
    if (!userId) return;
    refreshSessions();
  }, [userId]);

  useEffect(() => {
    if (!userId || !sessionId) return;
    loadPlan(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, userId]);

  async function loadPlan(sid: string) {
    setLoadingPlan(true);
    setErr(null);
    try {
      const out = await apiGet<any>(`/sessions/${encodeURIComponent(sid)}/plan?user_id=${encodeURIComponent(userId)}`);
      setPlan({ outline: out.plan.outline, nodes: out.plan.nodes, unlockedOrder: out.unlocked_order });
      setSelectedOrder(0);
      setAnswer('');
      setLastGrade(null);
    } catch {
      // 没有计划时保持为空（需要用户再提问生成）
      setPlan(null);
    } finally {
      setLoadingPlan(false);
    }
  }

  async function refreshSessions() {
    setLoadingSessions(true);
    setErr(null);
    try {
      const list = await apiGet<SessionListItem[]>(`/sessions?user_id=${encodeURIComponent(userId)}`);
      setSessions(list);
      if (!sessionId && list[0]) setSessionId(list[0].session_id);
      if (list.length === 0) {
        const created = await apiPost<SessionCreateOut>(`/sessions?user_id=${encodeURIComponent(userId)}`);
        setSessionId(created.session_id);
        const list2 = await apiGet<SessionListItem[]>(`/sessions?user_id=${encodeURIComponent(userId)}`);
        setSessions(list2);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoadingSessions(false);
    }
  }

  async function newSession() {
    setErr(null);
    try {
      const created = await apiPost<SessionCreateOut>(`/sessions?user_id=${encodeURIComponent(userId)}`);
      setSessionId(created.session_id);
      const list2 = await apiGet<SessionListItem[]>(`/sessions?user_id=${encodeURIComponent(userId)}`);
      setSessions(list2);
      setPlan(null);
      setSelectedOrder(0);
      setAnswer('');
      setLastGrade(null);
      setQuestion('');
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  const nodeByOrder = useMemo(() => {
    const map = new Map<number, LearningNode>();
    for (const n of plan?.nodes || []) map.set(n.order, n);
    return map;
  }, [plan]);

  const currentNode: LearningNode | null = useMemo(() => {
    if (!plan) return null;
    if (selectedOrder === 0) return null;
    return nodeByOrder.get(selectedOrder) || null;
  }, [plan, selectedOrder, nodeByOrder]);

  async function ask() {
    if (!sessionId) return;
    if (!question.trim()) return;
    setAsking(true);
    setErr(null);
    setLastGrade(null);
    setAnswer('');
    try {
      const out = await apiPost<AskOut>(`/sessions/${encodeURIComponent(sessionId)}/ask`, {
        user_id: userId,
        question: question.trim(),
        topic_hint: topicHint.trim() || null,
      });
      setPlan({ outline: out.plan.outline, nodes: out.plan.nodes, unlockedOrder: out.unlocked_order });
      setSelectedOrder(0);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setAsking(false);
    }
  }

  async function submit() {
    if (!sessionId || !currentNode) return;
    if (!answer.trim()) return;
    setSubmitting(true);
    setErr(null);
    try {
      const out = await apiPost<SubmitAnswerOut>(
        `/sessions/${encodeURIComponent(sessionId)}/nodes/${encodeURIComponent(currentNode.node_id)}/submit`,
        { user_id: userId, answer: answer.trim() }
      );
      setLastGrade(out);
      setPlan((p) => (p ? { ...p, unlockedOrder: out.unlocked_order } : p));
      if (out.grade.passed) {
        // 自动切到下一个（如果存在）
        const next = currentNode.order + 1;
        if (nodeByOrder.get(next)) setSelectedOrder(next);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const wide = isWide();

  const Sidebar = (
    <View style={styles.sidebar}>
      <View style={styles.sidebarHeader}>
        <Text style={styles.sidebarTitle}>提问记录</Text>
        <Pressable onPress={newSession} style={styles.smallBtn}>
          <Text style={styles.smallBtnText}>新建</Text>
        </Pressable>
      </View>

      {loadingSessions ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.muted}>加载会话…</Text>
        </View>
      ) : (
        <ScrollView>
          {sessions.map((s) => {
            const active = s.session_id === sessionId;
            return (
              <Pressable
                key={s.session_id}
                onPress={() => {
                  setSessionId(s.session_id);
                  setSidebarOpen(false);
                  // plan 会由 useEffect 自动拉取
                }}
                style={[styles.sessionItem, active && styles.sessionItemActive]}
              >
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {s.title || '会话'}
                </Text>
                <Text style={styles.sessionMeta} numberOfLines={1}>
                  {new Date(s.updated_at).toLocaleString()}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );

  return (
    <View style={styles.page}>
      <SettingsModal visible={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {!wide ? (
        <Modal visible={sidebarOpen} animationType="slide" transparent>
          <View style={styles.overlay}>
            <View style={styles.sidebarModal}>
              <View style={styles.sidebarModalTop}>
                <Text style={styles.sidebarTitle}>提问记录</Text>
                <Pressable onPress={() => setSidebarOpen(false)} style={styles.ghostBtn}>
                  <Text style={styles.ghostText}>关闭</Text>
                </Pressable>
              </View>
              {Sidebar}
            </View>
          </View>
        </Modal>
      ) : null}

      {wide ? Sidebar : null}

      <View style={styles.main}>
        <View style={styles.topbar}>
          {!wide ? (
            <Pressable onPress={() => setSidebarOpen(true)} style={styles.ghostBtn}>
              <Text style={styles.ghostText}>历史</Text>
            </Pressable>
          ) : (
            <View />
          )}
          <Text style={styles.topTitle}>Teacher</Text>
          <Pressable onPress={() => setSettingsOpen(true)} style={styles.ghostBtn}>
            <Text style={styles.ghostText}>设置</Text>
          </Pressable>
        </View>

        {err ? <Text style={styles.err}>{err}</Text> : null}

        <View style={styles.askBox}>
          <TextInput
            value={topicHint}
            onChangeText={setTopicHint}
            style={styles.topicInput}
            autoCapitalize="none"
            placeholder="主题（可选）"
            placeholderTextColor="#6e7ea6"
          />
          <TextInput
            value={question}
            onChangeText={setQuestion}
            style={styles.questionInput}
            placeholder="输入你的问题：例如“我总写不好 asyncio 的超时与取消，帮我做一个知行结合的学习流程”"
            placeholderTextColor="#6e7ea6"
            multiline
          />
          <Pressable onPress={ask} disabled={asking || !question.trim()} style={[styles.primaryBtn, (asking || !question.trim()) && { opacity: 0.5 }]}>
            <Text style={styles.primaryText}>{asking ? '生成中…' : '提问生成流程'}</Text>
          </Pressable>
        </View>

        {plan ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.flowBar}>
              <Pressable onPress={() => setSelectedOrder(0)} style={[styles.flowChip, selectedOrder === 0 && styles.flowChipActive]}>
                <Text style={styles.flowChipText}>大纲</Text>
              </Pressable>
              {plan.nodes.map((n) => {
                const locked = n.order > plan.unlockedOrder;
                const active = selectedOrder === n.order;
                return (
                  <Pressable
                    key={n.node_id}
                    onPress={() => !locked && setSelectedOrder(n.order)}
                    style={[styles.flowChip, active && styles.flowChipActive, locked && { opacity: 0.4 }]}
                  >
                    <Text style={styles.flowChipText}>
                      {locked ? '🔒 ' : ''}{n.order}. {n.title}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 30 }}>
              {selectedOrder === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>学习大纲</Text>
                  <Text style={styles.cardBody}>{plan.outline}</Text>
                  <Text style={styles.muted}>提示：完成每个节点练习并达到通过分数，会自动解锁下一节点。</Text>
                </View>
              ) : currentNode ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>
                    {currentNode.order}. {currentNode.title}
                  </Text>

                  <Text style={styles.sectionTitle}>知（目标）</Text>
                  <Text style={styles.cardBody}>{currentNode.knowledge_goal}</Text>

                  <Text style={styles.sectionTitle}>行（练习）</Text>
                  <Text style={styles.cardBody}>{currentNode.practice_task}</Text>

                  <Text style={styles.sectionTitle}>提示代码（不同场景，可迁移）</Text>
                  <View style={styles.codeBox}>
                    <Text style={styles.codeText}>{currentNode.hint_code}</Text>
                  </View>

                  <Text style={styles.sectionTitle}>你的回答</Text>
                  <TextInput
                    value={answer}
                    onChangeText={setAnswer}
                    style={styles.answerInput}
                    multiline
                    placeholder="贴代码/写思路都可以；建议写出可验证输出/耗时/顺序"
                    placeholderTextColor="#6e7ea6"
                  />
                  <Pressable
                    onPress={submit}
                    disabled={submitting || !answer.trim()}
                    style={[styles.primaryBtn, (submitting || !answer.trim()) && { opacity: 0.5 }]}
                  >
                    <Text style={styles.primaryText}>{submitting ? '批改中…' : `提交并评分（≥${currentNode.pass_score} 解锁）`}</Text>
                  </Pressable>

                  {lastGrade && lastGrade.node_id === currentNode.node_id ? (
                    <View style={styles.gradeBox}>
                      <Text style={styles.gradeTitle}>
                        评分：{lastGrade.grade.score} / 100（{lastGrade.grade.passed ? '通过' : '未通过'}）
                      </Text>
                      <Text style={styles.cardBody}>{lastGrade.grade.feedback}</Text>
                      {lastGrade.grade.strengths?.length ? (
                        <>
                          <Text style={styles.sectionTitle}>亮点</Text>
                          {lastGrade.grade.strengths.map((s, i) => (
                            <Text key={i} style={styles.bullet}>- {s}</Text>
                          ))}
                        </>
                      ) : null}
                      {lastGrade.grade.improvements?.length ? (
                        <>
                          <Text style={styles.sectionTitle}>改进</Text>
                          {lastGrade.grade.improvements.map((s, i) => (
                            <Text key={i} style={styles.bullet}>- {s}</Text>
                          ))}
                        </>
                      ) : null}
                      <Text style={styles.muted}>已解锁到：{plan.unlockedOrder}</Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>该节点未找到</Text>
                </View>
              )}
            </ScrollView>
          </>
        ) : (
          <View style={styles.empty}>
            {loadingPlan ? (
              <View style={styles.center}>
                <ActivityIndicator />
                <Text style={styles.muted}>加载该会话的流程…</Text>
              </View>
            ) : (
              <Text style={styles.muted}>
                1) 选择/新建会话 → 2) 输入问题 → 3) 生成流程 → 4) 做练习解锁节点 → 5) 到知识图谱页看你的“星空”
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, flexDirection: 'row', backgroundColor: '#05070d' },
  sidebar: { width: 280, borderRightWidth: 1, borderRightColor: '#14213d', backgroundColor: '#070b13' },
  sidebarHeader: { padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sidebarTitle: { color: '#e8eefc', fontWeight: '800' },
  sessionItem: { padding: 12, borderTopWidth: 1, borderTopColor: '#101a33' },
  sessionItemActive: { backgroundColor: '#0b1224' },
  sessionTitle: { color: '#d7e6ff', fontWeight: '700' },
  sessionMeta: { color: '#86a0d2', fontSize: 11, marginTop: 4 },
  main: { flex: 1, padding: 12 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  topTitle: { color: '#e8eefc', fontWeight: '900', fontSize: 16 },
  err: { color: '#ff7b7b', marginBottom: 10 },
  askBox: { backgroundColor: '#0b0f17', borderWidth: 1, borderColor: '#1b2a4a', borderRadius: 14, padding: 12 },
  topicInput: {
    backgroundColor: '#0f1726',
    borderWidth: 1,
    borderColor: '#1b2a4a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#e8eefc',
    marginBottom: 10,
  },
  questionInput: {
    minHeight: 80,
    backgroundColor: '#0f1726',
    borderWidth: 1,
    borderColor: '#1b2a4a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#e8eefc',
    marginBottom: 10,
  },
  primaryBtn: { backgroundColor: '#3b82f6', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  primaryText: { color: '#061024', fontWeight: '900' },
  flowBar: { marginTop: 12, maxHeight: 44 },
  flowChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1b2a4a',
    backgroundColor: '#0b0f17',
  },
  flowChipActive: { borderColor: '#64b5f6', backgroundColor: '#0b1a33' },
  flowChipText: { color: '#d7e6ff', fontSize: 12, fontWeight: '700' },
  content: { marginTop: 10 },
  card: { backgroundColor: '#0b0f17', borderWidth: 1, borderColor: '#1b2a4a', borderRadius: 14, padding: 12 },
  cardTitle: { color: '#e8eefc', fontWeight: '900', fontSize: 15, marginBottom: 8 },
  cardBody: { color: '#cfe0ff', lineHeight: 20 },
  sectionTitle: { color: '#9bb0dc', marginTop: 12, marginBottom: 6, fontWeight: '800' },
  codeBox: { backgroundColor: '#070b13', borderWidth: 1, borderColor: '#14213d', borderRadius: 12, padding: 10 },
  codeText: { color: '#c9d7ff', fontFamily: 'monospace', fontSize: 12, lineHeight: 16 },
  answerInput: {
    minHeight: 120,
    backgroundColor: '#0f1726',
    borderWidth: 1,
    borderColor: '#1b2a4a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#e8eefc',
  },
  gradeBox: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#14213d' },
  gradeTitle: { color: '#e8eefc', fontWeight: '900', marginBottom: 6 },
  bullet: { color: '#cfe0ff', lineHeight: 18 },
  muted: { color: '#86a0d2', marginTop: 8 },
  empty: { padding: 14 },
  center: { padding: 14, alignItems: 'center', gap: 8 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: '#16284a' },
  smallBtnText: { color: '#cfe0ff', fontWeight: '800', fontSize: 12 },
  ghostBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#1b2a4a' },
  ghostText: { color: '#cfe0ff', fontWeight: '800', fontSize: 12 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 },
  sidebarModal: { backgroundColor: '#070b13', borderRadius: 16, borderWidth: 1, borderColor: '#1b2a4a', overflow: 'hidden' },
  sidebarModalTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
});

