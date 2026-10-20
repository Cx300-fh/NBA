'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { beijingDate, type Game } from './basketball';
import { connectPredictionGitHub, loadPredictionMonth, predictionMonth, savePrediction, type PredictionMonth } from './predictions';
export function usePredictions() {
  const token = useRef('');
  const alive = useRef(true);
  const writes = useRef(false);
  const revisions = useRef<Record<string, number>>({});
  const tasks = useRef(new Map<string, Promise<void>>());
  const filesRef = useRef<Record<string, PredictionMonth>>({});
  const [files, setFiles] = useState<Record<string, PredictionMonth>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [login, setLogin] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [saving, setSaving] = useState('');
  const [commits, setCommits] = useState<Record<string, string>>({});
  const assign = useCallback((month: string, file: PredictionMonth) => {
    filesRef.current = { ...filesRef.current, [month]: file };
    if (alive.current) setFiles(filesRef.current);
  }, []);
  const reloadMonth = useCallback((month: string, force = true): Promise<void> => {
    if (!force && filesRef.current[month]) return Promise.resolve();
    const pending = tasks.current.get(month);
    if (pending) return pending;
    const revision = (revisions.current[month] || 0) + 1; revisions.current[month] = revision;
    setLoading(v => ({ ...v, [month]: true }));
    const task = (async () => {
      try {
        const result = await loadPredictionMonth(month, token.current);
        if (alive.current && revisions.current[month] === revision) { assign(month, result.file); setErrors(v => ({ ...v, [month]: '' })); }
      } catch (e) {
        if (alive.current && revisions.current[month] === revision) setErrors(v => ({ ...v, [month]: e instanceof Error ? e.message : '竞猜记录暂时无法读取' }));
      } finally { tasks.current.delete(month); if (alive.current) setLoading(v => ({ ...v, [month]: false })); }
    })();
    tasks.current.set(month, task); return task;
  }, [assign]);
  useEffect(() => { alive.current = true; void reloadMonth(beijingDate().slice(0, 7), false); return () => { alive.current = false; token.current = ''; }; }, [reloadMonth]);
  const connect = async (value: string) => {
    const credential = value.trim();
    const account = await connectPredictionGitHub(credential);
    token.current = credential; setLogin(account); setShowConnect(false);
    for (const month of new Set([beijingDate().slice(0, 7), ...Object.keys(filesRef.current), ...Object.keys(revisions.current)])) void reloadMonth(month);
  };
  const disconnect = () => { token.current = ''; setLogin(''); };
  const submit = async (game: Game, pickedTeamId: number, refresh: () => Promise<Game>) => {
    if (!token.current) { setShowConnect(true); throw Error('连接 GitHub 后，请再次点击保存竞猜'); }
    if (writes.current) throw Error('上一条竞猜仍在保存，请稍候');
    writes.current = true; setSaving(game.gameId);
    const month = predictionMonth(game); revisions.current[month] = (revisions.current[month] || 0) + 1;
    try {
      const result = await savePrediction(game, pickedTeamId, token.current, refresh);
      assign(month, result.file); setErrors(v => ({ ...v, [month]: '' })); setCommits(v => ({ ...v, [game.gameId]: result.commitUrl }));
    } finally { writes.current = false; if (alive.current) setSaving(''); }
  };
  return { files, errors, loading, login, saving, commits, showConnect, setShowConnect, reloadMonth, connect, disconnect, submit };
}
export type PredictionStore = ReturnType<typeof usePredictions>;
