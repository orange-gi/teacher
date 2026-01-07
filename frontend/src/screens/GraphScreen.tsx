import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import { apiGet, apiPost } from '../api/client';
import type { GraphEdge, GraphNode, GraphOut } from '../api/types';
import { getOrCreateUserId } from '../utils/userId';

type PositionedNode = GraphNode & { x: number; y: number };

function hash01(s: string): number {
  // 0..1 稳定伪随机（用于初始星星位置）
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function buildLayout(nodes: GraphNode[], edges: GraphEdge[], w: number, h: number): PositionedNode[] {
  const margin = 22;
  const init = nodes.map((n) => {
    const rx = hash01(n.id + ':x');
    const ry = hash01(n.id + ':y');
    return {
      ...n,
      x: margin + rx * (w - margin * 2),
      y: margin + ry * (h - margin * 2),
    };
  });

  // d3-force 会直接 mutate node 对象；这里复制一份用于模拟
  const simNodes: any[] = init.map((n) => ({ ...n }));
  const simLinks: any[] = edges
    .filter((e) => nodes.find((n) => n.id === e.source) && nodes.find((n) => n.id === e.target))
    .map((e) => ({ source: e.source, target: e.target, type: e.type }));

  const sim = forceSimulation(simNodes)
    .force('charge', forceManyBody().strength(-40))
    .force('center', forceCenter(w / 2, h / 2))
    .force(
      'link',
      forceLink(simLinks)
        .id((d: any) => d.id)
        .distance((l: any) => (l.type === 'PREREQ' ? 65 : 85))
        .strength(0.6)
    )
    .force('collide', forceCollide().radius((d: any) => 10))
    .stop();

  // 固定 tick 次数：避免长时间计算（移动端更稳）
  for (let i = 0; i < 90; i++) sim.tick();

  return simNodes.map((n) => ({ ...(n as GraphNode), x: n.x, y: n.y }));
}

export function GraphScreen() {
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<GraphOut | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadText, setUploadText] = useState(
    JSON.stringify(
      {
        nodes: [
          { name: 'asyncio 事件循环', level: 1 },
          { name: 'Task 与 gather', level: 2 },
          { name: '超时与取消', level: 3 },
        ],
        edges: [
          { from: 'asyncio 事件循环', to: 'Task 与 gather', type: 'PREREQ' },
          { from: 'Task 与 gather', to: '超时与取消', type: 'PREREQ' },
        ],
      },
      null,
      2
    )
  );

  const W = 360; // 这里用固定画布；可后续改成测量容器尺寸
  const H = 620;

  useEffect(() => {
    getOrCreateUserId().then(setUserId);
  }, []);

  useEffect(() => {
    if (!userId) return;
    refresh();
  }, [userId]);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const out = await apiGet<GraphOut>(`/graph?user_id=${encodeURIComponent(userId)}`);
      setData(out);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  async function upload() {
    setErr(null);
    try {
      const obj = JSON.parse(uploadText);
      const nodes = Array.isArray(obj.nodes) ? obj.nodes : [];
      const edges = Array.isArray(obj.edges) ? obj.edges : [];
      await apiPost(`/graph/upload`, { user_id: userId, nodes, edges });
      setUploadOpen(false);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  const positioned = useMemo(() => {
    if (!data) return [];
    return buildLayout(data.nodes, data.edges, W, H);
  }, [data]);

  const nodeIndex = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    for (const n of positioned) m.set(n.id, n);
    return m;
  }, [positioned]);

  return (
    <View style={styles.page}>
      <Modal visible={uploadOpen} animationType="slide">
        <View style={styles.modalPage}>
          <View style={styles.modalTop}>
            <Text style={styles.title}>上传知识图谱（JSON）</Text>
            <Pressable onPress={() => setUploadOpen(false)} style={styles.ghostBtn}>
              <Text style={styles.ghostText}>关闭</Text>
            </Pressable>
          </View>
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Text style={styles.muted}>格式：nodes[{`{name, level}`}] + edges[{`{from,to,type}`}]</Text>
          <TextInput
            value={uploadText}
            onChangeText={setUploadText}
            style={styles.textarea}
            multiline
            autoCapitalize="none"
          />
          <Pressable onPress={upload} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>上传并合并</Text>
          </Pressable>
        </View>
      </Modal>

      <View style={styles.topbar}>
        <Text style={styles.title}>知识图谱</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={refresh} style={styles.ghostBtn}>
            <Text style={styles.ghostText}>刷新</Text>
          </Pressable>
          <Pressable onPress={() => setUploadOpen(true)} style={styles.ghostBtn}>
            <Text style={styles.ghostText}>上传</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.muted}>加载图谱…</Text>
        </View>
      ) : err ? (
        <View style={styles.card}>
          <Text style={styles.err}>{err}</Text>
          <Text style={styles.muted}>
            如果提示 neo4j not available：先在 backend 目录启动 Neo4j（docker-compose），再刷新。
          </Text>
        </View>
      ) : data && data.nodes.length ? (
        <>
          <View style={styles.canvasWrap}>
            <Svg width={W} height={H}>
              <Rect x={0} y={0} width={W} height={H} fill="#04060c" />

              {/* 边：更暗更细，作为“星座连线” */}
              {data.edges.map((e, i) => {
                const a = nodeIndex.get(e.source);
                const b = nodeIndex.get(e.target);
                if (!a || !b) return null;
                return (
                  <Line
                    key={i}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={e.type === 'PREREQ' ? 'rgba(120,170,255,0.18)' : 'rgba(120,170,255,0.10)'}
                    strokeWidth={e.type === 'PREREQ' ? 1.2 : 0.8}
                  />
                );
              })}

              {/* 星星：brightness -> opacity；mastery_score -> 半径 */}
              {positioned.map((n) => {
                const r = 2.2 + (n.mastery_score ? Math.min(1, n.mastery_score) * 3.8 : 0);
                const op = Math.max(0.08, Math.min(1, n.brightness));
                return (
                  <Circle
                    key={n.id}
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill={`rgba(255,255,255,${op})`}
                  />
                );
              })}
            </Svg>
          </View>

          <ScrollView style={styles.legend} contentContainerStyle={{ paddingBottom: 20 }}>
            <Text style={styles.muted}>
              规则：越近练习/浏览的概念越亮；越久未触达越暗。分数会略微增大星星大小（mastery_score）。
            </Text>
            {positioned
              .slice()
              .sort((a, b) => (b.brightness || 0) - (a.brightness || 0))
              .map((n) => (
                <View key={n.id} style={styles.nodeRow}>
                  <View style={[styles.dot, { opacity: n.brightness }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nodeName}>{n.name}</Text>
                    <Text style={styles.nodeMeta}>
                      亮度 {n.brightness.toFixed(2)}
                      {n.last_practice_at ? ` · 最近练习 ${new Date(n.last_practice_at).toLocaleString()}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
          </ScrollView>
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.muted}>暂无星星：先在 Teacher 页做一次提问生成流程并完成练习，或上传你的图谱。</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#05070d', padding: 12 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  title: { color: '#e8eefc', fontWeight: '900', fontSize: 16 },
  ghostBtn: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#1b2a4a' },
  ghostText: { color: '#cfe0ff', fontWeight: '800', fontSize: 12 },
  primaryBtn: { backgroundColor: '#3b82f6', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  primaryText: { color: '#061024', fontWeight: '900' },
  muted: { color: '#86a0d2', marginTop: 8 },
  err: { color: '#ff7b7b', marginTop: 8 },
  center: { padding: 14, alignItems: 'center', gap: 8 },
  card: { backgroundColor: '#0b0f17', borderWidth: 1, borderColor: '#1b2a4a', borderRadius: 14, padding: 12 },
  canvasWrap: { alignItems: 'center', marginTop: 6 },
  legend: { marginTop: 10 },
  nodeRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#101a33' },
  dot: { width: 10, height: 10, borderRadius: 10, backgroundColor: '#ffffff', marginTop: 4 },
  nodeName: { color: '#d7e6ff', fontWeight: '800' },
  nodeMeta: { color: '#86a0d2', fontSize: 12, marginTop: 2 },
  modalPage: { flex: 1, backgroundColor: '#05070d', padding: 12 },
  modalTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  textarea: {
    marginTop: 10,
    flex: 1,
    backgroundColor: '#0b0f17',
    borderWidth: 1,
    borderColor: '#1b2a4a',
    borderRadius: 12,
    padding: 10,
    color: '#e8eefc',
    fontFamily: 'monospace',
  },
});

