import React, { useEffect, useRef, useState } from 'react';
import { db } from './firebase';
import { ref, update, remove } from 'firebase/database';
import { POSTIT_COLORS } from './postitTypes';
import type { PostItData } from './postitTypes';


interface PostItProps {
  roomName: string;
  id: string;
  data: PostItData;
}

const WIDTH = 190;
const HEIGHT = 170;

export const PostIt: React.FC<PostItProps> = ({ roomName, id, data }) => {
  const postitRef = ref(db, `rooms/${roomName}/postits/${id}`);

  // 편집 중에는 로컬 초안(draft)을 보여주고, 아닐 때는 서버 값을 그대로 보여준다
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? data.text;
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  const handleTextChange = (value: string) => {
    setDraft(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    // 타이핑마다 쓰지 않고 잠깐 멈추면 저장
    saveTimer.current = window.setTimeout(() => update(postitRef, { text: value }), 400);
  };

  const handleBlur = () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (draft !== null) update(postitRef, { text: draft });
    setDraft(null);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragOffset.current = { x: e.clientX - data.x, y: e.clientY - data.y };
    setDragPos({ x: data.x, y: data.y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragPos) return;
    setDragPos({
      x: Math.max(0, e.clientX - dragOffset.current.x),
      y: Math.max(0, e.clientY - dragOffset.current.y),
    });
  };

  const handlePointerUp = () => {
    if (!dragPos) return;
    update(postitRef, { x: dragPos.x, y: dragPos.y });
    setDragPos(null);
  };

  const cycleColor = () => {
    const next = POSTIT_COLORS[(POSTIT_COLORS.indexOf(data.color) + 1) % POSTIT_COLORS.length];
    update(postitRef, { color: next });
  };

  const handleDelete = () => {
    if (text.trim() && !window.confirm('이 포스트잇을 삭제하시겠습니까?')) return;
    remove(postitRef);
  };

  const pos = dragPos ?? { x: data.x, y: data.y };

  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: WIDTH,
        height: HEIGHT,
        zIndex: dragPos ? 8 : 5,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: data.color,
        borderRadius: '4px',
        boxShadow: dragPos ? '0 12px 24px rgba(0,0,0,0.35)' : '0 4px 10px rgba(0,0,0,0.3)',
        color: '#1a1a1a',
      }}
    >
      {/* 드래그 핸들 */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 6px', backgroundColor: 'rgba(0,0,0,0.08)', cursor: dragPos ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={cycleColor}
            title="색상 변경"
            style={{ width: '14px', height: '14px', borderRadius: '50%', border: '1px solid rgba(0,0,0,0.35)', backgroundColor: data.color, cursor: 'pointer', padding: 0, flexShrink: 0 }}
          />
          <span style={{ fontSize: '10px', opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.author}</span>
        </div>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleDelete}
          title="삭제"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', lineHeight: 1, color: '#1a1a1a', opacity: 0.6, padding: '0 2px' }}
        >
          ✕
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        onFocus={() => setDraft(data.text)}
        onBlur={handleBlur}
        maxLength={300}
        placeholder="내용을 입력하세요"
        style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', background: 'transparent', padding: '8px', fontSize: '13px', lineHeight: 1.4, fontFamily: 'inherit', color: '#1a1a1a' }}
      />
    </div>
  );
};
