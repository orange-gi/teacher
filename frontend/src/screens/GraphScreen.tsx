import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle, Defs, G, Line, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { apiGet, apiPost } from '../api/client';
import type { GraphEdge, GraphNode, GraphOut } from '../api/types';
import { supabase } from '../supabase/client';
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
    // 让层级更像“学习路径”：按 level 把 y 拉开
    .force('y', forceY((d: any) => 60 + (Number(d.level || 0) * 70) % (h - 120)).strength(0.18))
    .force('x', forceX(w / 2).strength(0.06))
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

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

  const { width } = useWindowDimensions();
  const W = Math.max(340, Math.min(520, Math.floor(width - 24)));
  const H = 620;

  // 交互：拖拽平移 + 按钮缩放（依赖最小；想要 pinch 缩放也可以继续加）
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const panRef = useRef({ x: 0, y: 0 });
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          panRef.current = { x: tx, y: ty };
        },
        onPanResponderMove: (_, g) => {
          setTx(panRef.current.x + g.dx);
          setTy(panRef.current.y + g.dy);
        },
        onPanResponderRelease: () => {},
      }),
    [tx, ty]
  );

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
      // 优先：Supabase（Postgres）
      const { data: concepts, error: e1 } = await supabase
        .from('user_concepts')
        .select('concept_id,name,level,last_seen_at,last_practice_at,mastery_score')
        .eq('user_id', userId);
      const { data: edges, error: e2 } = await supabase
        .from('user_edges')
        .select('source_id,target_id,type')
        .eq('user_id', userId);

      if (!e1 && !e2 && concepts) {
        const now = Date.now();
        const brightnessFrom = (iso?: string | null) => {
          if (!iso) return 0.12;
          const t = new Date(iso).getTime();
          if (!Number.isFinite(t)) return 0.12;
          const days = Math.max(0, (now - t) / 86400000);
          const b = Math.exp(-days / 30);
          return Math.max(0.08, Math.min(1, b));
        };
        const out: GraphOut = {
          nodes: (concepts || []).map((r: any) => ({
            id: r.concept_id,
            name: r.name,
            level: r.level,
            last_practice_at: r.last_practice_at,
            mastery_score: r.mastery_score,
            brightness: brightnessFrom(r.last_practice_at || r.last_seen_at),
          })),
          edges: (edges || []).map((r: any) => ({
            source: r.source_id,
            target: r.target_id,
            type: (r.type || 'PREREQ') as any,
          })),
        };
        setData(out);
      } else {
        // 兜底：走后端（若你不想让前端直连 Supabase，可用这个）
        const out = await apiGet<GraphOut>(`/graph?user_id=${encodeURIComponent(userId)}`);
        setData(out);
      }
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

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!m.has(a)) m.set(a, new Set());
      m.get(a)!.add(b);
    };
    for (const e of data?.edges || []) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return m;
  }, [data]);

  const selectedNode = useMemo(() => {
    if (!selectedId) return null;
    return positioned.find((n) => n.id === selectedId) || null;
  }, [selectedId, positioned]);

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
          <Pressable onPress={() => setScale((s) => Math.max(0.6, +(s - 0.15).toFixed(2)))} style={styles.ghostBtn}>
            <Text style={styles.ghostText}>缩小</Text>
          </Pressable>
          <Pressable onPress={() => setScale((s) => Math.min(2.4, +(s + 0.15).toFixed(2)))} style={styles.ghostBtn}>
            <Text style={styles.ghostText}>放大</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setScale(1);
              setTx(0);
              setTy(0);
            }}
            style={styles.ghostBtn}
          >
            <Text style={styles.ghostText}>重置</Text>
          </Pressable>
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
            如果提示 supabase not available：请在后端配置 APP_SUPABASE_URL/APP_SUPABASE_ANON_KEY，并在 Supabase 执行 /supabase/schema.sql 后再刷新。
          </Text>
        </View>
      ) : data && data.nodes.length ? (
        <>
          <Modal visible={detailOpen} animationType="slide" transparent>
            <View style={styles.overlay}>
              <View style={styles.detailCard}>
                <View style={styles.detailTop}>
                  <Text style={styles.detailTitle}>星星详情</Text>
                  <Pressable onPress={() => setDetailOpen(false)} style={styles.ghostBtn}>
                    <Text style={styles.ghostText}>关闭</Text>
                  </Pressable>
                </View>
                {selectedNode ? (
                  <>
                    <Text style={styles.detailName}>{selectedNode.name}</Text>
                    <Text style={styles.muted}>亮度：{selectedNode.brightness.toFixed(2)}</Text>
                    {selectedNode.last_practice_at ? (
                      <Text style={styles.muted}>最近练习：{new Date(selectedNode.last_practice_at).toLocaleString()}</Text>
                    ) : (
                      <Text style={styles.muted}>最近练习：暂无</Text>
                    )}
                    <Text style={styles.muted}>
                      掌握度：{selectedNode.mastery_score !== null && selectedNode.mastery_score !== undefined ? selectedNode.mastery_score.toFixed(2) : '—'}
                    </Text>

                    <Text style={styles.sectionTitle}>相邻概念</Text>
                    <ScrollView style={{ maxHeight: 220 }}>
                      {[...(adjacency.get(selectedNode.id) || new Set())]
                        .map((id) => nodeIndex.get(id))
                        .filter(Boolean)
                        .map((n) => (
                          <Pressable
                            key={n!.id}
                            onPress={() => {
                              setSelectedId(n!.id);
                            }}
                            style={styles.neiRow}
                          >
                            <View style={[styles.dot, { opacity: n!.brightness }]} />
                            <Text style={styles.neiText} numberOfLines={1}>
                              {n!.name}
                            </Text>
                          </Pressable>
                        ))}
                    </ScrollView>
                  </>
                ) : (
                  <Text style={styles.muted}>未选中星星</Text>
                )}
              </View>
            </View>
          </Modal>

          <View style={styles.canvasWrap} {...panResponder.panHandlers}>
            <Svg width={W} height={H}>
              <Defs>
                <RadialGradient id="neb1" cx="30%" cy="25%" rx="70%" ry="70%">
                  <Stop offset="0%" stopColor="rgba(90,140,255,0.22)" />
                  <Stop offset="55%" stopColor="rgba(30,60,120,0.10)" />
                  <Stop offset="100%" stopColor="rgba(0,0,0,0)" />
                </RadialGradient>
                <RadialGradient id="neb2" cx="70%" cy="65%" rx="75%" ry="75%">
                  <Stop offset="0%" stopColor="rgba(160,120,255,0.14)" />
                  <Stop offset="50%" stopColor="rgba(60,40,120,0.08)" />
                  <Stop offset="100%" stopColor="rgba(0,0,0,0)" />
                </RadialGradient>
              </Defs>

              <Rect x={0} y={0} width={W} height={H} fill="#04060c" />
              <Rect x={0} y={0} width={W} height={H} fill="url(#neb1)" />
              <Rect x={0} y={0} width={W} height={H} fill="url(#neb2)" />

              {Array.from({ length: 110 }).map((_, i) => {
                const x = 6 + hash01(`bg:${i}:x`) * (W - 12);
                const y = 6 + hash01(`bg:${i}:y`) * (H - 12);
                const op = 0.04 + hash01(`bg:${i}:o`) * 0.18;
                const r = 0.6 + hash01(`bg:${i}:r`) * 1.4;
                return <Circle key={`bg-${i}`} cx={x} cy={y} r={r} fill={`rgba(255,255,255,${op})`} />;
              })}

              <G transform={`translate(${tx} ${ty}) scale(${scale})`}>
                {data.edges.map((e, i) => {
                  const a = nodeIndex.get(e.source);
                  const b = nodeIndex.get(e.target);
                  if (!a || !b) return null;
                  const isHot =
                    selectedId &&
                    (e.source === selectedId ||
                      e.target === selectedId ||
                      adjacency.get(selectedId)?.has(e.source) ||
                      adjacency.get(selectedId)?.has(e.target));
                  const base = e.type === 'PREREQ' ? 0.18 : 0.1;
                  const op = isHot ? 0.45 : base;
                  return (
                    <Line
                      key={i}
                      x1={a.x}
                      y1={a.y}
                      x2={b.x}
                      y2={b.y}
                      stroke={`rgba(120,170,255,${op})`}
                      strokeWidth={isHot ? 1.8 : e.type === 'PREREQ' ? 1.2 : 0.8}
                    />
                  );
                })}

                {positioned.map((n) => {
                  const isSel = n.id === selectedId;
                  const isNear = selectedId ? adjacency.get(selectedId)?.has(n.id) : false;
                  const rCore = 2.2 + (n.mastery_score ? Math.min(1, n.mastery_score) * 3.8 : 0);
                  const op = Math.max(0.08, Math.min(1, n.brightness));
                  const glow = isSel ? 0.55 : isNear ? 0.28 : 0.18;
                  const glowR = rCore + (isSel ? 10 : isNear ? 6 : 4);
                  return (
                    <G key={n.id}>
                      <Circle cx={n.x} cy={n.y} r={glowR} fill={`rgba(110,170,255,${glow * op * 0.22})`} />
                      <Circle cx={n.x} cy={n.y} r={rCore + 2.2} fill={`rgba(255,255,255,${op * 0.25})`} />
                      <Circle
                        cx={n.x}
                        cy={n.y}
                        r={rCore}
                        fill={`rgba(255,255,255,${isSel ? 1 : op})`}
                        onPress={() => {
                          setSelectedId(n.id);
                          setDetailOpen(true);
                        }}
                      />
                      {isSel || isNear ? (
                        <SvgText x={n.x + 8} y={n.y - 8} fill="rgba(210,230,255,0.85)" fontSize="11">
                          {n.name.length > 12 ? `${n.name.slice(0, 12)}…` : n.name}
                        </SvgText>
                      ) : null}
                    </G>
                  );
                })}
              </G>
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
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end', padding: 12 },
  detailCard: { backgroundColor: '#0b0f17', borderWidth: 1, borderColor: '#1b2a4a', borderRadius: 16, padding: 12 },
  detailTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailTitle: { color: '#e8eefc', fontWeight: '900', fontSize: 16 },
  detailName: { color: '#d7e6ff', fontWeight: '900', fontSize: 18, marginTop: 8 },
  sectionTitle: { color: '#9bb0dc', marginTop: 12, marginBottom: 6, fontWeight: '800' },
  neiRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#101a33' },
  neiText: { color: '#cfe0ff', fontWeight: '800', flex: 1 },
});

