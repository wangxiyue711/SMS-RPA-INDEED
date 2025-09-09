"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

// —— 主题色（与 /main/sms 一致）——
const COLORS = {
  bgSoft: "#f8faef",
  borderSoft: "#e8eae0",
  primary: "#6f8333",
  primary2: "#8fa446",
  primaryHover: "#5e712b",
  textMain: "#43503a",
  textSub: "#666",
};

// TODO: 上线后从登录态拿 uid
const UID = "K8oCZvouLCZ3ssmYwp0ydj0KZB13";

type NameChecks = { kanji: boolean; katakana: boolean; hiragana: boolean; alphabet: boolean };
type GenderAge = { min: number | null; max: number | null; skip: boolean };
type TemplateChecks = { template1: boolean; template2: boolean };
type TargetRules = {
  nameChecks: NameChecks;
  age: { male: GenderAge; female: GenderAge };
  templates: TemplateChecks;
  updatedAt?: any;
};

const DEFAULT_RULES: TargetRules = {
  nameChecks: { kanji: false, katakana: false, hiragana: false, alphabet: false },
  age: { male: { min: null, max: null, skip: false }, female: { min: null, max: null, skip: false } },
  templates: { template1: false, template2: false },
};

// ---------------- 小组件 ----------------
function Checkbox({
  label, checked, onChange, disabled,
}: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 mr-6 cursor-pointer select-none">
      <input
        type="checkbox"
        className="h-4 w-4"
        style={{ accentColor: COLORS.primary }}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={{ color: COLORS.textMain }}>{label}</span>
    </label>
  );
}

function NumberInput({
  value, onChange, placeholder, min = 0, max = 120, disabled,
}: {
  value: number | null; onChange: (v: number | null) => void; placeholder?: string; min?: number; max?: number; disabled?: boolean;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      placeholder={placeholder}
      min={min}
      max={max}
      disabled={disabled}
      className="rounded px-2 py-1 w-20 text-sm"
      style={{
        border: `2px solid ${COLORS.borderSoft}`,
        background: "#fafbf7",
        color: COLORS.textMain,
        outlineColor: COLORS.primary,
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(null);
        const n = Number(raw);
        if (Number.isNaN(n)) return;
        onChange(Math.max(min!, Math.min(max!, n)));
      }}
    />
  );
}

function AgeRow({
  label, data, onChange, disabled,
}: { label: string; data: GenderAge; onChange: (next: GenderAge) => void; disabled?: boolean }) {
  const { min, max, skip } = data;
  const bad = useMemo(() => min != null && max != null && min > max, [min, max]);

  return (
    <div className="flex items-center gap-3 py-2">
      <div className="w-16" style={{ color: COLORS.textMain }}>{label}：</div>
      <NumberInput value={min} onChange={(v) => onChange({ ...data, min: v })} placeholder="18" disabled={disabled || skip} />
      <span className="text-xs" style={{ color: COLORS.textSub }}>歳 ー</span>
      <NumberInput value={max} onChange={(v) => onChange({ ...data, max: v })} placeholder="39" disabled={disabled || skip} />
      <span className="text-xs" style={{ color: COLORS.textSub }}>歳</span>
      <Checkbox label="送信しない" checked={skip} onChange={(v) => onChange({ ...data, skip: v })} disabled={disabled} />
      {bad && <span className="ml-2 text-xs" style={{ color: "#b91c1c" }}>※ 最小値は最大値以下にしてください</span>}
    </div>
  );
}

// ---------------- 页面 ----------------
export default function TargetSettingsPage() {
  const [rules, setRules] = useState<TargetRules>(DEFAULT_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ref = doc(db, "user_configs", UID);
        const snap = await getDoc(ref);
        if (!mounted) return;
        if (snap.exists()) {
          setRules(normalize({ ...DEFAULT_RULES, ...(snap.data() as any).target_rules }));
        }
      } finally {
        mounted && setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const canSave = useMemo(() => {
    if (saving || loading) return false;
    const m = rules.age.male, f = rules.age.female;
    const okM = m.skip || m.min == null || m.max == null || m.min <= m.max;
    const okF = f.skip || f.min == null || f.max == null || f.min <= f.max;
    return okM && okF;
  }, [saving, loading, rules]);

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await setDoc(
        doc(db, "user_configs", UID),
        { target_rules: { ...rules, updatedAt: serverTimestamp() } },
        { merge: true }
      );
      setSavedTick(Date.now());
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">読み込み中…</div>;

  return (
    <div className="p-6" style={{ background: COLORS.bgSoft }}>
      {/* 卡片 */}
      <div
        className="rounded-2xl bg-white"
        style={{ border: `1px solid ${COLORS.borderSoft}`, boxShadow: "0 8px 32px rgba(111,131,51,0.10)" }}
      >
        {/* 头部 */}
        <div className="px-6 py-4" style={{ borderBottom: `1px solid ${COLORS.borderSoft}` }}>
          <h2 className="m-0 text-lg font-semibold" style={{ color: COLORS.primary }}>🔎 対象設定</h2>
          <p className="mt-1 text-sm" style={{ color: COLORS.textSub }}>
            SMS を送信する対象者を設定してください
          </p>
        </div>

        {/* 内容 */}
        <div className="px-6 py-5 space-y-8">
          {/* A. 名前判定 */}
          <section>
            <div className="font-semibold mb-3 inline-flex items-center gap-2" style={{ color: "#374151" }}>
              <span
                className="inline-block text-xs px-2 py-[2px] rounded-full text-white"
                style={{ background: COLORS.primary }}
              >A</span>
              名前判定
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Checkbox label="漢字名" checked={rules.nameChecks.kanji}
                onChange={(v) => setRules({ ...rules, nameChecks: { ...rules.nameChecks, kanji: v } })} />
              <Checkbox label="カタカナ名" checked={rules.nameChecks.katakana}
                onChange={(v) => setRules({ ...rules, nameChecks: { ...rules.nameChecks, katakana: v } })} />
              <Checkbox label="ひらがな名" checked={rules.nameChecks.hiragana}
                onChange={(v) => setRules({ ...rules, nameChecks: { ...rules.nameChecks, hiragana: v } })} />
              <Checkbox label="アルファベット名" checked={rules.nameChecks.alphabet}
                onChange={(v) => setRules({ ...rules, nameChecks: { ...rules.nameChecks, alphabet: v } })} />
            </div>
          </section>

          {/* B. 性別 / 年齢 */}
          <section>
            <div className="font-semibold mb-3" style={{ color: "#374151" }}>🧍 性別 / 年齢</div>
            <div className="space-y-2">
              <AgeRow
                label="男性"
                data={rules.age.male}
                onChange={(next) => setRules({ ...rules, age: { ...rules.age, male: next } })}
              />
              <AgeRow
                label="女性"
                data={rules.age.female}
                onChange={(next) => setRules({ ...rules, age: { ...rules.age, female: next } })}
              />
            </div>
          </section>

          {/* C. テンプレート */}
          <section>
            <div className="font-semibold mb-3" style={{ color: "#374151" }}>📄 テンプレート</div>
            <div className="flex flex-wrap items-center gap-6">
              <Checkbox
                label="🌐 テンプレート1"
                checked={rules.templates.template1}
                onChange={(v) => setRules({ ...rules, templates: { ...rules.templates, template1: v } })}
              />
              <Checkbox
                label="🌐 テンプレート2"
                checked={rules.templates.template2}
                onChange={(v) => setRules({ ...rules, templates: { ...rules.templates, template2: v } })}
              />
            </div>
          </section>
        </div>

        {/* 底部 */}
        <div className="px-6 py-5" style={{ borderTop: `1px solid ${COLORS.borderSoft}` }}>
          <button
            onClick={save}
            disabled={!canSave}
            className="w-full sm:w-[520px] mx-auto block rounded-lg px-4 py-3 text-white font-semibold transition"
            style={{
              width: "100%",
              background: canSave
                ? `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primary2} 100%)`
                : "#cbd5e1",
              cursor: canSave ? "pointer" : "not-allowed",
              boxShadow: canSave ? "0 6px 16px rgba(111,131,51,0.25)" : "none",
            }}
            
            title={canSave ? "対象設定を保存" : "入力内容を確認してください"}
          >
            💾 対象設定を保存
          </button>

          <div id="targetStatus" className="mt-3 text-sm" style={{ minHeight: 20, color: COLORS.textSub }}>
            {savedTick > 0 && <span style={{ color: COLORS.primary }}>✅ 対象設定が保存されました！</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function normalize(r: TargetRules): TargetRules {
  const clamp = (v: number | null) => (v == null ? null : Math.max(0, Math.min(120, v)));
  const male = { min: clamp(r.age?.male?.min ?? null), max: clamp(r.age?.male?.max ?? null), skip: !!r.age?.male?.skip };
  const female = { min: clamp(r.age?.female?.min ?? null), max: clamp(r.age?.female?.max ?? null), skip: !!r.age?.female?.skip };
  return {
    nameChecks: {
      kanji: !!r.nameChecks?.kanji, katakana: !!r.nameChecks?.katakana,
      hiragana: !!r.nameChecks?.hiragana, alphabet: !!r.nameChecks?.alphabet,
    },
    age: { male, female },
    templates: { template1: !!r.templates?.template1, template2: !!r.templates?.template2 },
  };
}
